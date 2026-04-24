/**
 * RemoteF 客户端 - 后台服务脚本入口
 * 负责 WebSocket 连接、插件管理和消息路由
 */

import wsClient from './ws-client.js';
import pluginManager from './plugin-manager.js';
import storage from './storage.js';
import clientApi from './api.js';
import {
  broadcastToPopup,
  handlePluginList,
  handlePluginPush,
  setupMessageHandlers,
  registerPluginHandler
} from './messenger.js';

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'background') {
    handleBackgroundMessage(message, sender, sendResponse);
    return true;
  }
});

async function handleBackgroundMessage(message, sender, sendResponse) {

  console.log('[Background] 收到消息:', message, '来自:', sender);

  const { type, payload } = message;

  switch (type) {
    case 'get_plugins_with_code': {
      try {
        const meta = await storage.getPluginMeta();
        const pluginNames = Object.keys(meta);
        const plugins = [];
        for (const name of pluginNames) {
          const code = await storage.getPluginCode(name);
          const data = await storage.getPluginData(name);
          // 提取客户端 manifest 中的 matches 配置
          const matches = data?.manifest?.matches || null;
          plugins.push({ name, code, matches });
        }
        sendResponse({ plugins });
      } catch (err) {
        sendResponse({ plugins: [], error: err.message });
      }
      return true;
    }

    case 'get_plugin_code': {
      try {
        const code = await storage.getPluginCode(payload.pluginName);
        sendResponse({ code });
      } catch (err) {
        sendResponse({ code: null, error: err.message });
      }
      return true;
    }

    case 'get_current_tab_id': {
      // 从 sender.tab 直接拿 ID，比 tabs.query 更可靠
      sendResponse({ tabId: sender?.tab?.id ?? null });
      return true;
    }

    case 'execute_plugin': {
      // 在 MAIN 世界执行插件代码（绕过 CSP）
      try {
        const { pluginName, pluginCode, tabId } = payload;

        const results = await new Promise((resolve, reject) => {
          chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: executePluginInMainWorld,
            args: [pluginName, pluginCode]
          }, (results) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(results?.[0]?.result);
            }
          });
        });

        sendResponse(results || { success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    case 'to_plugin_message': {
      try {
        const { pluginName, message, tabId } = payload;
        const results = await new Promise((resolve, reject) => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: toPluginMessage,
            args: [pluginName, message]
          }, (results) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(results?.[0]?.result);
            }
          });
        });
        sendResponse(results || { success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    case 'plugin_to_server': {
      // 客户端插件 → 服务端
      // 转发为 WebSocket 消息
      wsClient.send({
        type: 'plugin_message',
        payload
      });
      sendResponse({ success: true });
      return true;
    }

    case 'plugin_loaded': {
      console.log('[Background] 插件已加载:', payload.pluginName);
      sendResponse({ success: true });
      return true;
    }

    case 'api_request': {
      // 客户端插件通过 API 发起的请求（获取连接状态等）
      handleApiRequest(payload, sendResponse);
      return true;
    }

    case 'input_dispatch': {
      // 系统级输入事件：通过 CDP Input.dispatch 发送，isTrusted: true
      handleInputDispatch(payload, sender, sendResponse);
      return true;
    }

    case 'register_plugin_handler': {
      console.log('[Background] 注册插件消息处理器:', payload);
      registerPluginHandler(payload.tabId, payload.plugins);
    }
  }
}

/**
 * 处理来自 MAIN 世界插件的 API 请求
 * 插件通过 window.postMessage → content script → chrome.runtime.sendMessage 发起
 */
function handleApiRequest(payload, sendResponse) {
  const { method, params } = payload;

  switch (method) {
    case 'getConnectionStatus': {
      sendResponse(clientApi.getConnectionStatus());
      break;
    }

    case 'getClientId': {
      storage.getClientId().then(id => sendResponse({ clientId: id }));
      break;
    }

    case 'getInstalledPlugins': {
      clientApi.getInstalledPlugins().then(plugins => sendResponse({ plugins }));
      break;
    }

    case 'getStorage': {
      const { pluginName, key } = params;
      clientApi.getStorage(pluginName, key).then(value => sendResponse({ value }));
      break;
    }

    case 'setStorage': {
      const { pluginName, key, value } = params;
      clientApi.setStorage(pluginName, key, value).then(() => sendResponse({ success: true }));
      break;
    }

    case 'removeStorage': {
      const { pluginName, key } = params;
      clientApi.removeStorage(pluginName, key).then(() => sendResponse({ success: true }));
      break;
    }

    default: {
      sendResponse({ error: `Unknown API method: ${method}` });
    }
  }
}

/**
 * 处理系统级输入事件（CDP Input.dispatch）
 * 通过 Chrome DevTools Protocol 发送输入事件，产生 isTrusted: true 的事件
 * 网页、滑块、防刷机制无法区分与真人操作的差异
 * 
 * 支持的事件类型：
 *   - mouse: Input.dispatchMouseEvent (mousePressed, mouseReleased, mouseMoved, mouseWheel)
 *   - touch: Input.dispatchTouchEvent (touchStart, touchEnd, touchMove, touchCancel)
 *   - key:   Input.dispatchKeyEvent (keyDown, keyUp, rawKeyDown, char)
 * 
 * 使用示例（插件代码中）：
 *   // 点击 (100, 200)
 *   await ctx.input.dispatch('mouse', { type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1 });
 *   await ctx.input.dispatch('mouse', { type: 'mouseReleased', x: 100, y: 200, button: 'left', clickCount: 1 });
 *   // 触摸滑动
 *   await ctx.input.dispatch('touch', { type: 'touchStart', touchPoints: [{ x: 100, y: 200 }] });
 *   await ctx.input.dispatch('touch', { type: 'touchMove', touchPoints: [{ x: 200, y: 300 }] });
 *   await ctx.input.dispatch('touch', { type: 'touchEnd', touchPoints: [] });
 *   // 按键
 *   await ctx.input.dispatch('key', { type: 'keyDown', key: 'Enter' });
 *   await ctx.input.dispatch('key', { type: 'keyUp', key: 'Enter' });
 */
async function handleInputDispatch(payload, sender, sendResponse) {
  const { eventType, params } = payload;

  // 获取当前 tab
  let tabId = sender.tab?.id;
  if (!tabId) {
    const tabs = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    tabId = tabs[0]?.id;
  }

  if (!tabId) {
    sendResponse({ success: false, error: '无法获取当前标签页' });
    return;
  }

  // CDP 方法名映射
  const cdpMethods = {
    mouse: 'Input.dispatchMouseEvent',
    touch: 'Input.dispatchTouchEvent',
    key: 'Input.dispatchKeyEvent'
  };

  const cdpMethod = cdpMethods[eventType];
  if (!cdpMethod) {
    sendResponse({ success: false, error: `不支持的输入类型: ${eventType}，支持: mouse, touch, key` });
    return;
  }

  try {
    // 附加 debugger（如果尚未附加）
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (msg.includes('Already attached') || msg.includes('already attached')) {
            resolve();
          } else {
            reject(new Error(msg));
          }
        } else {
          resolve();
        }
      });
    });

    // 发送 CDP 命令
    const result = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, cdpMethod, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });

    sendResponse({ success: true, result });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * 在 MAIN 世界执行插件代码
 * 这个函数运行在页面的主上下文，不受 CSP 限制
 */
function executePluginInMainWorld(pluginName, pluginCode) {
  try {
    // 插件通过 window.postMessage 与 content script 通信
    // 提供 ctx 上下文对象
    const ctx = {
      pluginName,

      // 发送消息到服务端（通过 postMessage → content script → background → WebSocket）
      sendMessage(message) {
        window.postMessage({
          source: 'remotef-main',
          type: 'plugin_message',
          payload: { pluginName, message }
        }, '*');
      },

      // 插件 API（通过 postMessage → content script → chrome.runtime.sendMessage → background）
      // 核心原则：插件只能与同名服务端插件通讯，pluginName 由系统自动绑定
      api: {
        /**
         * 发送消息给同名服务端插件
         * pluginName 由系统自动注入，插件无法指定其他插件名
         */
        sendMessage(message) {
          window.postMessage({
            source: 'remotef-main',
            type: 'plugin_message',
            payload: { pluginName, message }
          }, '*');
        },

        /**
         * 获取连接状态（异步）
         */
        getConnectionStatus() {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'getConnectionStatus', params: {} }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'getConnectionStatus') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        },

        /**
         * 获取客户端 ID（异步）
         */
        getClientId() {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'getClientId', params: {} }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'getClientId') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result?.clientId);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        },

        /**
         * 获取已安装插件列表（异步）
         */
        getInstalledPlugins() {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'getInstalledPlugins', params: {} }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'getInstalledPlugins') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result?.plugins || []);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        },

        /**
         * 获取插件存储（异步）
         */
        getStorage(key) {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'getStorage', params: { pluginName, key } }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'getStorage') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result?.value);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        },

        /**
         * 设置插件存储（异步）
         */
        setStorage(key, value) {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'setStorage', params: { pluginName, key, value } }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'setStorage') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        },

        /**
         * 删除插件存储（异步）
         */
        removeStorage(key) {
          return new Promise((resolve) => {
            window.postMessage({
              source: 'remotef-main',
              type: 'api_request',
              payload: { method: 'removeStorage', params: { pluginName, key } }
            }, '*');
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated' && event.data?.type === 'api_response') {
                if (event.data.payload?.method === 'removeStorage') {
                  window.removeEventListener('message', handler);
                  resolve(event.data.payload.result);
                }
              }
            };
            window.addEventListener('message', handler);
          });
        }
      },

      // DOM 工具
      utils: {
        injectStyle(css) {
          const style = document.createElement('style');
          style.textContent = css;
          style.id = `remotef-${pluginName}-style`;
          (document.head || document.documentElement).appendChild(style);
          return style;
        },

        injectScript(code) {
          const script = document.createElement('script');
          script.textContent = code;
          (document.head || document.documentElement).appendChild(script);
          return script;
        }
      },

      /**
       * 系统级输入事件 API
       * 通过 CDP (Chrome DevTools Protocol) 发送输入事件
       * 产生 isTrusted: true 的事件，网页/滑块/防刷机制无法区分与真人操作的差异
       * 
       * 支持类型：
       *   - 'mouse': 鼠标事件 (点击、移动、滚轮)
       *   - 'touch': 触摸事件 (触摸开始/移动/结束)
       *   - 'key':   键盘事件 (按键按下/抬起)
       */
      input: {
        /**
         * 发送系统级输入事件
         * @param {string} eventType - 输入类型: 'mouse' | 'touch' | 'key'
         * @param {object} params - CDP 事件参数（不同类型参数不同）
         * @returns {Promise<{success: boolean, result?: object, error?: string}>}
         * 
         * @example
         * // 鼠标点击 (100, 200)
         * await ctx.input.dispatch('mouse', { type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1 });
         * await ctx.input.dispatch('mouse', { type: 'mouseReleased', x: 100, y: 200, button: 'left', clickCount: 1 });
         * 
         * // 鼠标移动
         * await ctx.input.dispatch('mouse', { type: 'mouseMoved', x: 200, y: 300 });
         * 
         * // 鼠标滚轮
         * await ctx.input.dispatch('mouse', { type: 'mouseWheel', x: 100, y: 200, deltaX: 0, deltaY: -120 });
         * 
         * // 触摸滑动
         * await ctx.input.dispatch('touch', { type: 'touchStart', touchPoints: [{ x: 100, y: 200 }] });
         * await ctx.input.dispatch('touch', { type: 'touchMove', touchPoints: [{ x: 200, y: 300 }] });
         * await ctx.input.dispatch('touch', { type: 'touchEnd', touchPoints: [] });
         * 
         * // 按键
         * await ctx.input.dispatch('key', { type: 'keyDown', key: 'Enter' });
         * await ctx.input.dispatch('key', { type: 'keyUp', key: 'Enter' });
         * 
         * // 组合键 (Ctrl+C)
         * await ctx.input.dispatch('key', { type: 'keyDown', key: 'Control' });
         * await ctx.input.dispatch('key', { type: 'keyDown', key: 'c' });
         * await ctx.input.dispatch('key', { type: 'keyUp', key: 'c' });
         * await ctx.input.dispatch('key', { type: 'keyUp', key: 'Control' });
         */
        dispatch(eventType, params) {
          return new Promise((resolve) => {
            const requestId = `input_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

            // 设置一次性监听器接收响应
            const handler = (event) => {
              if (event.source !== window) return;
              if (event.data?.source === 'remotef-isolated'
                && event.data?.type === 'input_dispatch_response'
                && event.data.payload?.requestId === requestId) {
                window.removeEventListener('message', handler);
                resolve(event.data.payload.result);
              }
            };
            window.addEventListener('message', handler);

            // 超时保护（10秒）
            setTimeout(() => {
              window.removeEventListener('message', handler);
              resolve({ success: false, error: '输入事件超时' });
            }, 10000);

            // 发送到 content script → background → CDP
            window.postMessage({
              source: 'remotef-main',
              type: 'input_dispatch',
              payload: { eventType, params, requestId }
            }, '*');
          });
        },

        /**
         * 便捷方法：点击指定坐标
         * @param {number} x - X 坐标
         * @param {number} y - Y 坐标
         * @param {object} [options] - 选项
         * @param {string} [options.button='left'] - 鼠标按钮: 'left' | 'middle' | 'right'
         * @param {number} [options.clickCount=1] - 点击次数（2=双击）
         * @param {number} [options.delay=50] - 按下与释放之间的延迟（毫秒）
         * @returns {Promise<{success: boolean}>}
         */
        async click(x, y, options = {}) {
          const { button = 'left', clickCount = 1, delay = 50 } = options;
          const down = await this.dispatch('mouse', { type: 'mousePressed', x, y, button, clickCount });
          if (!down.success) return down;
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
          return this.dispatch('mouse', { type: 'mouseReleased', x, y, button, clickCount });
        },

        /**
         * 便捷方法：鼠标移动（带可选插值步骤，模拟真人轨迹）
         * @param {number} fromX - 起始 X
         * @param {number} fromY - 起始 Y
         * @param {number} toX - 目标 X
         * @param {number} toY - 目标 Y
         * @param {object} [options] - 选项
         * @param {number} [options.steps=5] - 插值步数
         * @param {number} [options.stepDelay=16] - 每步延迟（毫秒）
         * @returns {Promise<{success: boolean}>}
         */
        async move(fromX, fromY, toX, toY, options = {}) {
          const { steps = 5, stepDelay = 16 } = options;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(fromX + (toX - fromX) * t);
            const y = Math.round(fromY + (toY - fromY) * t);
            const result = await this.dispatch('mouse', { type: 'mouseMoved', x, y });
            if (!result.success) return result;
            if (i < steps && stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
          }
          return { success: true };
        },

        /**
         * 便捷方法：触摸滑动（模拟真人手指滑动）
         * @param {number} fromX - 起始 X
         * @param {number} fromY - 起始 Y
         * @param {number} toX - 目标 X
         * @param {number} toY - 目标 Y
         * @param {object} [options] - 选项
         * @param {number} [options.steps=10] - 插值步数
         * @param {number} [options.stepDelay=16] - 每步延迟（毫秒）
         * @returns {Promise<{success: boolean}>}
         */
        async swipe(fromX, fromY, toX, toY, options = {}) {
          const { steps = 10, stepDelay = 16 } = options;

          // touchStart
          const start = await this.dispatch('touch', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
          if (!start.success) return start;

          // touchMove with interpolation
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(fromX + (toX - fromX) * t);
            const y = Math.round(fromY + (toY - fromY) * t);
            const result = await this.dispatch('touch', { type: 'touchMove', touchPoints: [{ x, y }] });
            if (!result.success) return result;
            if (i < steps && stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
          }

          // touchEnd
          return this.dispatch('touch', { type: 'touchEnd', touchPoints: [] });
        },

        /**
         * 便捷方法：按键输入
         * @param {string} key - 按键名称 (如 'Enter', 'Tab', 'Escape', 'a' 等)
         * @param {object} [options] - 选项
         * @param {number} [options.delay=50] - 按下与释放之间的延迟（毫秒）
         * @returns {Promise<{success: boolean}>}
         */
        async press(key, options = {}) {
          const { delay = 50 } = options;
          const down = await this.dispatch('key', { type: 'keyDown', key });
          if (!down.success) return down;
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
          return this.dispatch('key', { type: 'keyUp', key });
        },

        /**
         * 便捷方法：输入文本（逐字符输入）
         * @param {string} text - 要输入的文本
         * @param {object} [options] - 选项
         * @param {number} [options.delay=50] - 每个字符之间的延迟（毫秒）
         * @returns {Promise<{success: boolean}>}
         */
        async type(text, options = {}) {
          const { delay = 50 } = options;
          for (const char of text) {
            const down = await this.dispatch('key', { type: 'keyDown', key: char });
            if (!down.success) return down;
            const up = await this.dispatch('key', { type: 'keyUp', key: char });
            if (!up.success) return up;
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
          }
          return { success: true };
        }
      }
    };

    // 执行插件代码
    // transformModuleCode 已将 module.exports = 替换为 var __plugin__ =
    // 所以执行后 __plugin__ 就是插件对象
    const wrappedCode = `(function() {
      ${pluginCode}
      if (typeof __plugin__ !== 'undefined') {
        return __plugin__;
      }
      return null;
    })()`;

    const plugin = (0, eval)(wrappedCode); // 间接 eval 在全局作用域执行

    if (plugin && typeof plugin === 'object') {
      // 保存到全局
      window.__remotef_plugins = window.__remotef_plugins || {};
      window.__remotef_plugins[pluginName] = plugin;

      // 调用 init
      if (typeof plugin.init === 'function') {
        plugin.init(ctx);
      }

      // 调用 run
      if (typeof plugin.run === 'function') {
        plugin.run(ctx, plugin.config);
      }

      console.log(`[RemoteF] 插件 ${pluginName} 执行完成，已注入 MAIN 世界`, plugin);

      return { success: true, hasInit: typeof plugin.init === 'function', hasRun: typeof plugin.run === 'function' };
    }
    return { success: true, hasFactory: false };
  } catch (err) {
    console.error('[RemoteF Plugin Execute] Error:', err);
    return { success: false, error: err.message };
  }
}

function toPluginMessage(pluginName, message) {
  try {
    window.__remotef_plugins[pluginName].onMessage(message);
  } catch (err) {
    console.error(`[RemoteF] 插件 ${pluginName} 处理消息时出错:`, err);
  }
}

// ===== 初始化消息处理器 =====

function initMessageHandlers() {
  wsClient.on('connection_changed', (data) => {
    broadcastToPopup({ type: 'connection_changed', payload: data });
  });

  wsClient.onMessage('connected', (payload) => {
    console.log('[RemoteF] 连接成功:', payload);
  });

  wsClient.onMessage('registered', (payload) => {
    console.log('[RemoteF] 已注册:', payload);
    wsClient.send({ type: 'plugin_list' });
  });

  wsClient.onMessage('plugin_list', (payload) => {
    const plugins = Array.isArray(payload) ? payload : (payload.plugins || []);
    handlePluginList(plugins);
  });

  wsClient.onMessage('plugin_push', async (payload) => {
    await handlePluginPush(payload);
  });

  wsClient.onMessage('plugin_message', (payload) => {
    // 插件消息统一由 content script（ISOLATED 世界）分发到 RemoteFRuntime.contexts
    // background 只负责转发，不处理业务逻辑
    clientApi.handleServerMessage(payload);
  });
}


// ===== 初始化 =====

(async function init() {
  console.log('[RemoteF] 初始化...');

  initMessageHandlers();
  setupMessageHandlers();

  await pluginManager.restore((msg) => wsClient.send(msg));

  const config = await storage.getConfig();
  if (config.autoConnect && config.serverUrl) {
    console.log('[RemoteF] 自动连接...');
    wsClient.connect();
  }

  console.log('[RemoteF] 初始化完成');
})();
