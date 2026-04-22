/**
 * RemoteF 消息通信模块
 * 处理 popup、options 等扩展页面与 background 的通信
 */

import pluginManager from './plugin-manager.js';
import wsClient from './ws-client.js';
import storage from './storage.js';

// ===== Popup 通信 =====
const popupListeners = new Set();

export function broadcastToPopup(message) {
  chrome.runtime.sendMessage({ type: 'popup_update', payload: message }).catch(() => {
    // Popup 可能未打开，忽略错误
  });

  popupListeners.forEach(listener => {
    try {
      listener(message);
    } catch {
      popupListeners.delete(listener);
    }
  });
}

export function addPopupListener(listener) {
  popupListeners.add(listener);
  return () => popupListeners.delete(listener);
}

// ===== 插件同步 =====

export async function handlePluginList(plugins) {
  console.log('[RemoteF] 收到插件列表:', plugins);
  broadcastToPopup({ type: 'plugin_list', plugins });

  const localMeta = await storage.getPluginMeta();
  console.log('[RemoteF] 开始同步插件...');

  for (const serverPlugin of plugins) {
    const localVersion = localMeta[serverPlugin.name]?.version;

    if (localVersion && localVersion === serverPlugin.version) {
      console.log(`[RemoteF] 已安装: ${serverPlugin.name} v${serverPlugin.version}`);
    } else {
      const action = localVersion ? '更新' : '安装';
      const versionInfo = localVersion ? ` (${localVersion} -> ${serverPlugin.version})` : '';
      console.log(`[RemoteF] 需要${action}: ${serverPlugin.name}${versionInfo}`);
      requestPluginInstall(serverPlugin.name);
    }
  }
}

export function requestPluginInstall(pluginName) {
  wsClient.send({ type: 'plugin_install', payload: { pluginName } });
}

export async function handlePluginPush(payload) {
  const { pluginName, module } = payload;
  console.log('[RemoteF] 收到插件内容:', pluginName);

  const result = await pluginManager.install(pluginName, module, (msg) => wsClient.send(msg));

  wsClient.send({
    type: 'plugin_install_result',
    payload: { pluginName, ...result }
  });
}

export function handlePluginMessage(payload) {
  const { pluginName, message } = payload;
  const handler = pluginManager.getContextHandler(pluginName);

  if (handler) {
    try {
      handler(message);
    } catch (err) {
      console.error(`[RemoteF] 插件消息处理错误 (${pluginName}):`, err);
    }
  } else {
    console.log(`[RemoteF] 未找到插件处理器: ${pluginName}`);
  }
}

// ===== Chrome API 消息处理 =====

export function setupMessageHandlers() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[RemoteF] 收到 API 消息:', msg.type);

    switch (msg.type) {
      case 'get_status': {
        const plugins = pluginManager.getAll();
        sendResponse({
          isConnected: wsClient.isConnected,
          clientId: wsClient.clientId,
          plugins
        });
        break;
      }

      case 'get_plugins':
        sendResponse({ plugins: pluginManager.getAll() });
        break;

      case 'get_plugin_status':
        sendResponse({
          status: pluginManager.getStatus(msg.pluginName),
          error: pluginManager.getError(msg.pluginName)
        });
        break;

      case 'connect':
        wsClient.connect().then(() => sendResponse({ success: true }));
        break;

      case 'disconnect':
        wsClient.disconnect();
        sendResponse({ success: true });
        break;

      case 'run_plugin': {
        pluginManager.run(msg.pluginName, (m) => wsClient.send(m), msg.config || {}).then(result => {
          send({ success: true, ...result });
        });
        break;
      }

      case 'stop_plugin': {
        pluginManager.stop(msg.pluginName).then(result => {
          sendResponse({ success: true, ...result });
        });
        break;
      }

      case 'install_plugin':
        requestPluginInstall(msg.pluginName);
        sendResponse({ success: true });
        break;

      case 'uninstall_plugin':
        pluginManager.uninstall(msg.pluginName).then(() => sendResponse({ success: true }));
        break;

      case 'popup_subscribe': {
        addPopupListener(sendResponse);
        return true;
      }
    }

    return false;
  });
}

// 修复：确保 send 在 run_plugin case 中正确使用
function send(message) {
  wsClient.send(message);
}

export default {
  broadcastToPopup,
  addPopupListener,
  handlePluginList,
  requestPluginInstall,
  handlePluginPush,
  handlePluginMessage,
  setupMessageHandlers
};
