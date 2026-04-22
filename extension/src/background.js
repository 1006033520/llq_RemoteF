/**
 * RemoteF 客户端 - 后台服务脚本入口
 * 负责 WebSocket 连接、插件管理和消息路由
 */

import wsClient from './ws-client.js';
import pluginManager from './plugin-manager.js';
import storage from './storage.js';
import {
  broadcastToPopup,
  handlePluginList,
  handlePluginPush,
  handlePluginMessage,
  setupMessageHandlers
} from './messenger.js';

// ===== 初始化消息处理器 =====

function initMessageHandlers() {
  // 连接状态变化
  wsClient.on('connection_changed', (data) => {
    broadcastToPopup({ type: 'connection_changed', payload: data });
  });

  // 服务端消息处理
  wsClient.onMessage('connected', (payload) => {
    console.log('[RemoteF] 连接成功:', payload);
  });

  wsClient.onMessage('registered', (payload) => {
    console.log('[RemoteF] 已注册:', payload);
    wsClient.send({ type: 'plugin_list' });
  });

  wsClient.onMessage('plugin_list', (payload) => {
    // 处理两种可能的格式：直接是数组 或 { plugins: [...] }
    const plugins = Array.isArray(payload) ? payload : (payload.plugins || []);
    handlePluginList(plugins);
  });

  wsClient.onMessage('plugin_push', async (payload) => {
    await handlePluginPush(payload);
  });

  wsClient.onMessage('plugin_message', (payload) => {
    handlePluginMessage(payload);
  });

  wsClient.onMessage('plugin_run_request', async (payload) => {
    const { pluginName, config } = payload;
    const result = await pluginManager.run(pluginName, (msg) => wsClient.send(msg), config);
    wsClient.send({
      type: 'plugin_run_result',
      payload: { pluginName, ...result }
    });
  });

  // 插件状态同步到 popup
  pluginManager.on('statusChanged', (data) => {
    broadcastToPopup({ type: 'plugin_status_changed', payload: data });
  });

  pluginManager.on('installed', (data) => {
    broadcastToPopup({ type: 'plugin_installed', pluginName: data.pluginName });
  });

  pluginManager.on('uninstalled', (data) => {
    broadcastToPopup({ type: 'plugin_uninstalled', pluginName: data.pluginName });
  });

  pluginManager.on('error', (data) => {
    broadcastToPopup({ type: 'plugin_error', payload: data });
  });
}

// ===== 初始化 =====

(async function init() {
  console.log('[RemoteF] 初始化...');

  // 初始化消息处理器
  initMessageHandlers();
  setupMessageHandlers();

  // 恢复插件
  await pluginManager.restore((msg) => wsClient.send(msg));

  // 自动连接
  const config = await storage.getConfig();
  if (config.autoConnect && config.serverUrl) {
    console.log('[RemoteF] 自动连接...');
    wsClient.connect();
  }

  console.log('[RemoteF] 初始化完成');
})();
