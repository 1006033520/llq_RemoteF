/**
 * RemoteF 插件运行时
 * 
 * 架构设计：
 * 1. 插件代码在 MAIN 世界执行（绕过 CSP）
 * 2. 通过 window.postMessage 桥接 MAIN ↔ ISOLATED 通信
 * 3. Content script (ISOLATED) 中转消息到 background → 服务端
 */

// 创建插件运行时管理器
const RemoteFRuntime = {
  plugins: new Map(),
  currentUrl: '',
  tabId: null,

  /**
   * 检查 URL 是否匹配给定的 match patterns
   * 支持标准 Chrome match patterns 格式：
   *   - <all_urls>         → 匹配所有
   *   - *://*.example.com/* → 通配符域名
   *   - https://example.com/* → 精确域名
   * @param {string} url - 待检测的 URL
   * @param {string[]|null} patterns - match patterns 数组，null 或空数组表示匹配所有
   * @returns {boolean}
   */
  matchUrl(url, patterns) {
    // 未配置 matches 或空数组 → 所有网站生效
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
      return true;
    }

    for (const pattern of patterns) {
      if (pattern === '<all_urls>') return true;
      if (this._matchPattern(url, pattern)) return true;
    }
    return false;
  },

  /**
   * 单个 match pattern 匹配
   * 格式: <scheme>://<host>/<path>
   * scheme: * | http | https
   * host: * | *.domain | domain
   * path: /path/* | /path
   */
  _matchPattern(url, pattern) {
    try {
      const parsed = new URL(url);
      // 解析 pattern: scheme://host/path
      const match = pattern.match(/^(\*|https?):\/\/(.*?)\/(.*)$/);
      if (!match) return false;

      const [, scheme, host, path] = match;

      // scheme 匹配
      if (scheme !== '*' && parsed.protocol.replace(':', '') !== scheme) return false;

      // host 匹配（需处理端口）
      if (host !== '*') {
        // 分离 pattern 中的 host 和 port
        const [patternHost, patternPort] = host.split(':');

        // 端口匹配
        if (patternPort) {
          const urlPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
          if (urlPort !== patternPort) return false;
        }

        // 主机名匹配
        if (patternHost.startsWith('*.')) {
          // *.example.com → 匹配 example.com 及其所有子域
          const domain = patternHost.slice(2);
          if (parsed.hostname !== domain && !parsed.hostname.endsWith('.' + domain)) return false;
        } else {
          if (parsed.hostname !== patternHost) return false;
        }
      }

      // path 匹配（支持末尾 * 通配）
      const urlPath = parsed.pathname + parsed.search;
      const pathRegex = new RegExp('^' + path.replace(/\*/g, '.*') + '$');
      if (!pathRegex.test(urlPath)) return false;

      return true;
    } catch {
      return false;
    }
  },

  /**
   * 初始化
   */
  async init() {
    console.log('[RemoteF Runtime] 初始化...');

    this.currentUrl = window.location.href;
    this.tabId = await this.getCurrentTabId();
    this.watchNavigation();
    this.setupMessageBridge();

    // 向 background 请求插件列表并执行
    await this.loadPlugins();

    // 向 background 注册本 tab 的插件列表（用于路由服务端→客户端消息）
    this.setupOnMessage();

    console.log('[RemoteF Runtime] 初始化完成');
  },


  setupOnMessage() {
    console.log(`[RemoteF Runtime] 注册插件消息处理器: ${this.tabId}`, Array.from(this.plugins.keys()));
    if(this.plugins.size === 0) {
      console.warn(`[RemoteF Runtime] 当前没有插件 ${this.tabId}`);
      return;
    }
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'register_plugin_handler',
      payload: { tabId: this.tabId, plugins: Array.from(this.plugins.keys()) }
    });

  },

  /**
   * 设置 MAIN ↔ ISOLATED 消息桥接
   * MAIN 世界的插件通过 window.postMessage 发消息
   * ISOLATED 的 content script 监听并转发到 background
   */
  setupMessageBridge() {
    window.addEventListener('message', (event) => {
      // 只处理来自本窗口的 RemoteF 消息
      if (event.source !== window) return;
      if (event.data?.source !== 'remotef-main') return;

      console.log(`[RemoteF Runtime] 收到 MAIN 世界消息: ${this.tabId}`, event.data);

      const { type, payload } = event.data;

      switch (type) {
        case 'plugin_message':
          // 插件发消息给同名服务端，通过 background → WebSocket
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'plugin_to_server',
            payload
          });
          break;

        case 'api_request':
          // 插件 API 请求，通过 background 处理后返回结果
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'api_request',
            payload
          }, (result) => {
            if (chrome.runtime.lastError) {
              console.error('[RemoteF Runtime] API 请求错误:', chrome.runtime.lastError.message);
              return;
            }
            // 将结果通过 postMessage 返回给 MAIN 世界
            window.postMessage({
              source: 'remotef-isolated',
              type: 'api_response',
              payload: { method: payload.method, result }
            }, '*');
          });
          break;

        case 'input_dispatch':
          // 系统级输入事件，通过 CDP 发送（isTrusted: true）
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'input_dispatch',
            payload
          }, (result) => {
            if (chrome.runtime.lastError) {
              console.error('[RemoteF Runtime] 输入事件错误:', chrome.runtime.lastError.message);
              // 返回错误给 MAIN 世界
              window.postMessage({
                source: 'remotef-isolated',
                type: 'input_dispatch_response',
                payload: { requestId: payload.requestId, result: { success: false, error: chrome.runtime.lastError.message } }
              }, '*');
              return;
            }
            // 返回结果给 MAIN 世界
            window.postMessage({
              source: 'remotef-isolated',
              type: 'input_dispatch_response',
              payload: { requestId: payload.requestId, result }
            }, '*');
          });
          break;

        case 'plugin_log':
          // 插件日志（从 MAIN 世界转发到控制台）
          console[payload.level || 'log'](`[${payload.pluginName}]`, ...payload.args);
          break;
      }
    });
  },

  /**
   * 从 background 获取插件列表并执行
   * 根据 manifest.matches 配置过滤：只在匹配的网站上运行
   */
  async loadPlugins() {
    console.log('[RemoteF Runtime] 加载插件...');

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ target: 'background', type: 'get_plugins_with_code' }, async (response) => {
        if (chrome.runtime.lastError) {
          console.error('[RemoteF Runtime] 获取插件失败:', chrome.runtime.lastError.message);
          resolve();
          return;
        }

        const plugins = response?.plugins || [];
        const currentUrl = window.location.href;
        console.log(`[RemoteF Runtime] 获取到插件: ${plugins.length}, 当前URL: ${currentUrl}`);

        for (const plugin of plugins) {
          // 检查当前 URL 是否匹配插件的 matches 配置
          if (!this.matchUrl(currentUrl, plugin.matches)) {
            console.log(`[RemoteF Runtime] ${plugin.name}: URL 不匹配，跳过 (matches: ${JSON.stringify(plugin.matches)})`);
            continue;
          }
          await this.loadAndRunPlugin(plugin.name, plugin.code);

          this.plugins.set(plugin.name, { ready: true });
        }
        resolve();
      });
    });
  },

  /**
   * 加载并运行单个插件
   */
  async loadAndRunPlugin(pluginName, pluginCode) {
    if (!pluginCode) {
      console.log(`[RemoteF Runtime] ${pluginName}: 无代码，跳过`);
      return;
    }

    console.log(`[RemoteF Runtime] 加载插件: ${pluginName}`);

    try {
      // 通过 background 在 MAIN 世界执行插件代码
      const tabId = await this.getCurrentTabId();

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          target: 'background',
          type: 'execute_plugin',
          payload: { pluginName, pluginCode, tabId }
        }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (response?.success) {
        console.log(`[RemoteF Runtime] ${pluginName}: 执行成功`);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (err) {
      console.error(`[RemoteF Runtime] ${pluginName}: 加载失败:`, err.message);
    }
  },

  async toPluginMessage(pluginName, message) {
    console.log(`[RemoteF Runtime] 发送消息给插件: ${pluginName}`);

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          target: 'background',
          type: 'to_plugin_message',
          payload: { pluginName, message, tabId: this.tabId }
        }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (response?.success) {
        console.log(`[RemoteF Runtime] 发送消息给 ${pluginName}: 执行成功`);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (err) {
      console.error(`[RemoteF Runtime] 发送消息给 ${pluginName}: 失败:`, err.message);
    }
  },

  /**
   * 获取当前标签页 ID（通过 background 获取）
   */
  async getCurrentTabId() {
    if (this._cachedTabId) return this._cachedTabId;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { target: 'background', type: 'get_current_tab_id' },
        (response) => {
          this._cachedTabId = response?.tabId ?? null;
          resolve(this._cachedTabId);
        }
      );
    });
  },

  /**
   * 监听 SPA 页面导航
   */
  watchNavigation() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const self = this;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      self.onNavigation();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      self.onNavigation();
    };

    window.addEventListener('popstate', () => this.onNavigation());
    window.addEventListener('hashchange', () => this.onNavigation());
  },

  onNavigation() {
    const newUrl = window.location.href;
    if (newUrl === this.currentUrl) return;

    console.log(`[RemoteF Runtime] 页面导航: ${this.currentUrl} -> ${newUrl}`);
    this.currentUrl = newUrl;
    this.loadPlugins();
  },

  /**
   * 处理来自 background 的消息（服务端 → 客户端）
   */
  async handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'plugin_rerun': {
        const code = await this.getPluginCode(payload.pluginName);
        this.loadAndRunPlugin(payload.pluginName, code);
        break;
      }
      case 'to_plugin_message': {
        this.toPluginMessage(payload.pluginName, payload.message);
        break;
      }
    }
  }
};

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'content') return;
  RemoteFRuntime.handleMessage(message);
  sendResponse({ success: true });
});

// 导出到全局
window.RemoteFRuntime = RemoteFRuntime;

// 页面加载完成后自动初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => RemoteFRuntime.init());
} else {
  RemoteFRuntime.init();
}

console.log('[RemoteF] 插件运行时已初始化');
