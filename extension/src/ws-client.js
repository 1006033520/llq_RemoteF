/**
 * RemoteF WebSocket 客户端
 * 处理服务端连接、消息收发、自动重连
 */

import storage from './storage.js';
import pluginManager from './plugin-manager.js';

// ===== WebSocket 客户端类 =====
export class WSClient {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.isConnected = false;
    this.clientId = null;
    this.messageHandlers = new Map();
  }

  // ===== 连接管理 =====

  async connect() {
    console.log('[WSClient] connect() 被调用');
    const config = await storage.getConfig();

    if (!config.serverUrl) {
      console.log('[WSClient] 未配置服务端地址');
      this.updateBadge('配置', 'gray');
      return;
    }

    if (!config.clientName) {
      config.clientName = `Client-${Date.now().toString(36)}`;
      await storage.saveConfig(config);
      console.log('[WSClient] 生成并保存客户端名称:', config.clientName);
    }

    let wsUrl = config.serverUrl.trim();
    if (!wsUrl.startsWith('http://') && !wsUrl.startsWith('https://')) {
      wsUrl = 'http://' + wsUrl;
    }
    wsUrl = wsUrl.replace(/^http/, 'ws') + '/ws';

    console.log('[WSClient] 正在连接 WebSocket:', wsUrl);

    if (this.ws) {
      console.log('[WSClient] 关闭旧连接');
      this.ws.close();
      this.ws = null;
    }

    this.ws = new WebSocket(wsUrl);
    console.log('[WSClient] WebSocket 对象已创建');

    this.setupHandlers(config);
  }

  setupHandlers(config) {
    this.ws.onopen = () => {
      console.log('[WSClient] WebSocket 连接打开!');
      this.isConnected = true;
      clearTimeout(this.reconnectTimer);

      this.send({
        type: 'register',
        payload: {
          name: config.clientName,
          version: config.clientVersion,
          platform: 'chrome-extension',
          extensions: pluginManager.getNames()
        }
      });

      this.updateBadge('已连接', 'green');
      this.emit('connection_changed', { connected: true });
    };

    this.ws.onclose = (event) => {
      console.log('[WSClient] WebSocket 连接关闭:', event.code, event.reason);
      this.isConnected = false;
      this.ws = null;
      this.clientId = null;

      this.updateBadge('未连接', 'red');
      this.emit('connection_changed', { connected: false });

      if (!event.wasClean && event.code !== 1000) {
        console.log('[WSClient] 准备重连...');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WSClient] WebSocket 错误:', error);
      this.updateBadge('错误', 'red');
    };

    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[WSClient] 收到消息:', message.type);

        // 查找并调用消息处理器
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          await handler(message.payload || {}, message);
        }
      } catch (err) {
        console.error('[WSClient] 消息处理错误:', err);
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.clientId = null;
    clearTimeout(this.reconnectTimer);
    this.updateBadge('未连接', 'gray');
    this.emit('connection_changed', { connected: false });
  }

  // ===== 消息发送 =====

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.log('[WSClient] WebSocket 未连接，无法发送:', message.type);
    }
  }

  // ===== 消息处理注册 =====

  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  offMessage(type) {
    this.messageHandlers.delete(type);
  }

  // ===== 事件系统 =====

  emit(event, data) {
    const handler = this.messageHandlers.get('_' + event);
    if (handler) {
      handler(data);
    }
  }

  on(event, handler) {
    this.messageHandlers.set('_' + event, handler);
  }

  // ===== 状态更新 =====

  updateBadge(text, color) {
    const colors = {
      green: '#4CAF50',
      red: '#f44336',
      gray: '#9e9e9e',
      blue: '#2196F3',
      yellow: '#FFC107'
    };

    chrome.action.setBadgeText({ text: text || '' });
    chrome.action.setBadgeBackgroundColor({ color: colors[color] || colors.gray });
  }

  // ===== 状态查询 =====

  getStatus() {
    return {
      isConnected: this.isConnected,
      clientId: this.clientId
    };
  }
}

export default new WSClient();
