/**
 * RemoteF 客户端插件 API
 * 
 * 提供统一的 API 接口给客户端插件调用。
 * 插件在 MAIN 世界通过 ctx.api.xxx() 使用。
 * 
 * 核心原则：插件只能与同名服务端插件通讯，pluginName 由系统自动绑定，不可指定。
 * 
 * 消息链路：
 *   MAIN 世界 (ctx.api) → window.postMessage → ISOLATED (plugin-runtime.js)
 *     → chrome.runtime.sendMessage → background → WebSocket → 服务端
 */

import wsClient from './ws-client.js';
import storage from './storage.js';
import { findPluginTag } from './messenger.js';

/**
 * 客户端 API 类
 * 在 background.js 中实例化，通过消息桥接提供给 MAIN 世界的插件使用
 */
export class ClientAPI {
  constructor() {
    // 消息处理器注册表（插件名 → handler）
    this.messageHandlers = new Map();
    // 请求-响应等待表（requestId → { resolve, reject, timer }）
    this.pendingRequests = new Map();
    // 请求超时时间（毫秒）
    this.requestTimeout = 30000;
  }

  // ===== 连接状态 =====

  /**
   * 获取 WebSocket 连接状态
   * @returns {{ connected: boolean, clientId: string|null, serverUrl: string|null }}
   */
  getConnectionStatus() {
    return {
      connected: wsClient.isConnected,
      clientId: wsClient.clientId,
      serverUrl: wsClient.ws?.url || null
    };
  }

  /**
   * 获取客户端唯一 ID
   * @returns {Promise<string>}
   */
  async getClientId() {
    return storage.getClientId();
  }

  // ===== 插件与服务端通讯 =====

  /**
   * 发送消息给同名的服务端插件
   * pluginName 由系统自动绑定，插件无法指定或冒充其他插件
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   * @returns {boolean} 是否发送成功
   */
  sendMessage(pluginName, message) {
    if (!wsClient.isConnected) {
      console.warn('[ClientAPI] 未连接，无法发送消息');
      return false;
    }

    wsClient.send({
      type: 'plugin_message',
      payload: { pluginName, message }
    });
    return true;
  }

  /**
   * 发送消息给同名服务端插件并等待响应
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   * @param {number} [timeout=30000] - 超时时间（毫秒）
   * @returns {Promise<object>} 服务端响应
   */
  sendMessageWithResponse(pluginName, message, timeout) {
    return new Promise((resolve, reject) => {
      if (!wsClient.isConnected) {
        reject(new Error('未连接到服务端'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const actualTimeout = timeout || this.requestTimeout;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时 (${actualTimeout}ms)`));
      }, actualTimeout);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      wsClient.send({
        type: 'plugin_message',
        payload: {
          pluginName,
          message: { ...message, __requestId: requestId }
        }
      });
    });
  }

  /**
   * 注册消息处理器（只接收发给本插件的消息）
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {function} handler - 消息处理函数 (message) => void
   */
  onMessage(pluginName, handler) {
    this.messageHandlers.set(pluginName, handler);
  }

  /**
   * 取消消息处理器
   * @param {string} pluginName - 插件名
   */
  offMessage(pluginName) {
    this.messageHandlers.delete(pluginName);
  }

  /**
   * 处理来自服务端的插件消息（只分发给同名插件）
   * @param {object} payload - { pluginName, message }
   */
  handleServerMessage(payload) {
    const { pluginName, message } = payload;

    // 检查是否是请求-响应的回复
    if (message?.__requestId) {
      const pending = this.pendingRequests.get(message.__requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.__requestId);
        pending.resolve(message);
        return;
      }
    }

    // 只分发给同名插件处理器
    // const handler = this.messageHandlers.get(pluginName);
    // if (handler) {
    //   try {
    //     handler(message);
    //   } catch (err) {
    //     console.error(`[ClientAPI] 插件 ${pluginName} 消息处理错误:`, err);
    //   }
    // }

    const tagIds = findPluginTag(pluginName);
    if (tagIds.length === 0) {
      console.warn(`[ClientAPI] 未找到插件标签，无法分发消息: ${pluginName}`);
      return;
    }
    
     tagIds.forEach(tabId => {
      chrome.tabs.sendMessage(tabId, {
        type: 'to_plugin_message',
        target: 'content',
        payload: { pluginName, message }
      }).catch(err => {
        console.error(`[ClientAPI] 发送消息给 ${pluginName} 失败:`, err);
      });
    });
  }

  // ===== 存储操作 =====

  /**
   * 获取插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   * @returns {Promise<any>}
   */
  async getStorage(pluginName, key) {
    const data = await storage.get(`plugin_storage_${pluginName}`);
    return data?.[key] ?? null;
  }

  /**
   * 设置插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   * @param {any} value - 存储值
   */
  async setStorage(pluginName, key, value) {
    const data = (await storage.get(`plugin_storage_${pluginName}`)) || {};
    data[key] = value;
    await storage.set(`plugin_storage_${pluginName}`, data);
  }

  /**
   * 删除插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   */
  async removeStorage(pluginName, key) {
    const data = (await storage.get(`plugin_storage_${pluginName}`)) || {};
    delete data[key];
    await storage.set(`plugin_storage_${pluginName}`, data);
  }

  // ===== 插件信息 =====

  /**
   * 获取已安装插件列表
   * @returns {Promise<Array>}
   */
  async getInstalledPlugins() {
    const meta = await storage.getPluginMeta();
    return Object.entries(meta).map(([name, info]) => ({
      name,
      version: info.version,
      installedAt: info.installedAt
    }));
  }

  // ===== 清理 =====

  /**
   * 清理指定插件的所有注册和存储
   * @param {string} pluginName - 插件名
   */
  cleanup(pluginName) {
    this.messageHandlers.delete(pluginName);
  }
}

export default new ClientAPI();
