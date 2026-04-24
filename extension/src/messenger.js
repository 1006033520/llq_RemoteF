/**
 * RemoteF 消息通信模块
 * 处理 popup、options 等扩展页面与 background 的通信
 */

import wsClient from './ws-client.js';
import storage from './storage.js';
import pluginManager from './plugin-manager.js';

// ===== Popup 通信 =====
const popupListeners = new Set();

const tabsPluginMap = new Map(); // tabId → Set(pluginName)

// ===== Tab 生命周期监听：自动清理失效的 tabId =====

// Tab 被关闭时清理
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabsPluginMap.has(tabId)) {
    tabsPluginMap.delete(tabId);
    console.log('[RemoteF Messenger] Tab 关闭，清理插件映射:', tabId);
  }
});

// Tab 发生导航时清理（旧 content script 已卸载，新 content script 会在 init() 时重新注册）
chrome.webNavigation.onCommitted.addListener((details) => {
  const { tabId, frameId } = details;
  // 只处理主 frame（忽略 iframe）
  if (frameId !== 0) return;
  // 页面刷新/导航时清理，tabId 保持不变，新 content script 加载后会重新注册
  if (tabsPluginMap.has(tabId)) {
    tabsPluginMap.delete(tabId);
    console.log('[RemoteF Messenger] Tab 导航，清理插件映射:', tabId);
  }
});

export function registerPluginHandler(tabId, pluginNames) {
  tabsPluginMap.set(tabId, pluginNames);
}

export function findPluginTag(pluginName) {
  const tabIds = [];
  for (const [tabId, plugins] of tabsPluginMap.entries()) {
    if (plugins == pluginName) {
      tabIds.push(tabId);
    }
  }
  return tabIds;
}

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

      // 插件由服务端控制运行，客户端无权限停止/删除插件

      case 'popup_subscribe': {
        addPopupListener(sendResponse);
        return true;
      }
    }

    return false;
  });
}


export default {
  broadcastToPopup,
  addPopupListener,
  handlePluginList,
  requestPluginInstall,
  handlePluginPush,
  setupMessageHandlers,
  findPluginTag,
  registerPluginHandler,
};
