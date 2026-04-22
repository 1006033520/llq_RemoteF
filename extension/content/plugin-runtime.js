/**
 * RemoteF 插件运行时
 * 在页面上下文中运行插件代码
 */

// 创建插件运行时管理器
const RemoteFRuntime = {
  plugins: new Map(),
  messageHandlers: new Set(),

  /**
   * 注册插件
   */
  registerPlugin(pluginName, module) {
    if (this.plugins.has(pluginName)) {
      console.log(`[RemoteF Runtime] 插件 ${pluginName} 已存在，跳过注册`);
      return;
    }

    console.log(`[RemoteF Runtime] 注册插件: ${pluginName}`);

    try {
      // 创建沙箱上下文
      const context = this.createContext(pluginName);

      // 执行插件代码
      if (typeof module === 'function') {
        module(context);
      } else if (typeof module === 'object' && module) {
        // 如果是对象，直接作为插件实例
        this.plugins.set(pluginName, {
          manifest: module.manifest,
          instance: module,
          context
        });

        // 调用初始化
        if (module.init) {
          module.init(context);
        }
      }

      console.log(`[RemoteF Runtime] 插件 ${pluginName} 注册成功`);
    } catch (err) {
      console.error(`[RemoteF Runtime] 插件 ${pluginName} 注册失败:`, err);
    }
  },

  /**
   * 卸载插件
   */
  unregisterPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;

    try {
      if (plugin.instance && plugin.instance.destroy) {
        plugin.instance.destroy();
      }
    } catch (err) {
      console.error(`[RemoteF Runtime] 插件 ${pluginName} 销毁失败:`, err);
    }

    this.plugins.delete(pluginName);
    console.log(`[RemoteF Runtime] 插件 ${pluginName} 已卸载`);
  },

  /**
   * 运行插件
   */
  async runPlugin(pluginName, config = {}) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      console.error(`[RemoteF Runtime] 插件 ${pluginName} 未注册`);
      return { success: false, error: 'Plugin not found' };
    }

    try {
      if (plugin.instance && plugin.instance.run) {
        const result = await plugin.instance.run(plugin.context, config);
        return { success: true, result };
      }
      return { success: false, error: 'No run function' };
    } catch (err) {
      console.error(`[RemoteF Runtime] 插件 ${pluginName} 运行失败:`, err);
      return { success: false, error: err.message };
    }
  },

  /**
   * 创建沙箱上下文
   */
  createContext(pluginName) {
    const self = this;

    return {
      pluginName,

      // DOM 操作
      document: window.document,
      window: window,

      // 日志
      console: {
        log: (...args) => console.log(`[${pluginName}]`, ...args),
        error: (...args) => console.error(`[${pluginName}]`, ...args),
        warn: (...args) => console.warn(`[${pluginName}]`, ...args),
        info: (...args) => console.info(`[${pluginName}]`, ...args)
      },

      // 消息系统
      onMessage(callback) {
        self.messageHandlers.add({ pluginName, callback });
      },
      sendMessage(message) {
        // 发送到 background script
        chrome.runtime.sendMessage({
          type: 'plugin_to_server',
          payload: {
            pluginName,
            message
          }
        });
      },

      // 存储
      storage: {
        async get(key) {
          const result = await chrome.storage.local.get(`plugin_${pluginName}_${key}`);
          return result[`plugin_${pluginName}_${key}`];
        },
        async set(key, value) {
          await chrome.storage.local.set({
            [`plugin_${pluginName}_${key}`]: value
          });
        },
        async remove(key) {
          await chrome.storage.local.remove(`plugin_${pluginName}_${key}`);
        }
      },

      // 工具函数
      utils: {
        // 等待元素出现
        waitForSelector(selector, timeout = 5000) {
          return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
              const el = document.querySelector(selector);
              if (el) {
                observer.disconnect();
                resolve(el);
              }
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true
            });

            setTimeout(() => {
              observer.disconnect();
              reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
          });
        },

        // 监听网络请求
        watchFetch(callback) {
          const originalFetch = window.fetch;
          window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            callback({
              url: args[0],
              options: args[1],
              response: response.clone()
            });
            return response;
          };

          return () => {
            window.fetch = originalFetch;
          };
        },

        // 注入脚本
        injectScript(code) {
          const script = document.createElement('script');
          script.textContent = code;
          script.id = `remotef-${pluginName}-injected`;
          document.head.appendChild(script);
          return script;
        },

        // 注入样式
        injectStyle(css) {
          const style = document.createElement('style');
          style.textContent = css;
          style.id = `remotef-${pluginName}-style`;
          document.head.appendChild(style);
          return style;
        }
      },

      // 配置
      config: {},
      setConfig(config) {
        this.config = { ...this.config, ...config };
      },

      // 获取当前标签页信息
      async getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
      }
    };
  },

  /**
   * 处理来自 background 的消息
   */
  handleMessage(message) {
    const { type, payload } = message;

    switch (type) {
      case 'plugin_run':
        this.runPlugin(payload.pluginName, payload.config);
        break;

      case 'plugin_message':
        // 分发给对应插件
        for (const handler of this.messageHandlers) {
          if (handler.pluginName === payload.pluginName) {
            handler.callback(payload.message);
          }
        }
        break;

      case 'plugin_unload':
        this.unregisterPlugin(payload.pluginName);
        break;
    }
  }
};

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'content') {
    RemoteFRuntime.handleMessage(message);
    sendResponse({ success: true });
  }
});

// 导出到全局
window.RemoteFRuntime = RemoteFRuntime;

console.log('[RemoteF] 插件运行时已初始化');
