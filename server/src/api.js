/**
 * RemoteF 服务端插件 API
 * 
 * 提供统一的 API 接口给服务端插件调用。
 * 插件通过 ctx.api.xxx() 使用。
 * 
 * 核心原则：插件只能与同名客户端插件通讯，pluginName 由系统自动绑定，不可指定。
 * 
 * 能力：
 *   - 发送消息给指定客户端的同名插件
 *   - 广播消息给所有/部分客户端的同名插件
 *   - 获取在线客户端列表和详情
 *   - 注册消息处理器（只接收同名客户端插件的消息）
 *   - 服务端连接状态查询
 *   - 插件存储操作
 */

export class ServerAPI {
  /**
   * @param {object} options
   * @param {import('./plugin-manager.js').PluginManager} options.pluginManager
   */
  constructor(options = {}) {
    this.pluginManager = options.pluginManager;
    this.sendToClientFn = options.sendToClient;
    this.broadcastFn = options.broadcast;
    this.getClientInfoFn = options.getClientInfo;
    this.getAllClientsFn = options.getAllClients;

    // 插件消息处理器注册表（pluginName → handler）
    this.messageHandlers = new Map();

    // 插件存储（内存级，可扩展为持久化）
    this.stores = new Map();

    // 请求-响应等待表
    this.pendingRequests = new Map();
    this.requestTimeout = 30000;
  }

  /**
   * 注入依赖（延迟绑定，因为 wsServer 在 pluginManager 之后创建）
   * @param {object} deps
   */
  inject(deps) {
    if (deps.sendToClient) this.sendToClientFn = deps.sendToClient;
    if (deps.broadcast) this.broadcastFn = deps.broadcast;
    if (deps.getClientInfo) this.getClientInfoFn = deps.getClientInfo;
    if (deps.getAllClients) this.getAllClientsFn = deps.getAllClients;
  }

  // ===== 连接状态 =====

  /**
   * 获取服务端连接状态概览
   * @returns {{ onlineClients: number, totalPlugins: number, uptime: number }}
   */
  getConnectionStatus() {
    const clients = this.getAllClientsFn ? this.getAllClientsFn() : [];
    return {
      onlineClients: clients.filter(c => c.isOnline).length,
      totalClients: clients.length,
      totalPlugins: this.pluginManager ? this.pluginManager.list().length : 0,
      uptime: process.uptime()
    };
  }

  // ===== 消息发送 =====

  /**
   * 发送消息给指定客户端的同名插件
   * pluginName 由系统自动绑定，插件无法指定其他插件名
   * @param {string} clientId - 客户端 ID
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   * @returns {boolean} 是否发送成功
   */
  sendToClient(clientId, pluginName, message) {
    if (!this.sendToClientFn) {
      console.error('[ServerAPI] sendToClient 函数未注入');
      return false;
    }

    this.sendToClientFn(clientId, 'plugin_message', {
      pluginName,
      message
    });
    return true;
  }

  /**
   * 发送消息给指定客户端的同名插件并等待响应
   * @param {string} clientId - 客户端 ID
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   * @param {number} [timeout=30000] - 超时时间
   * @returns {Promise<object>} 客户端响应
   */
  sendToClientWithResponse(clientId, pluginName, message, timeout) {
    return new Promise((resolve, reject) => {
      if (!this.sendToClientFn) {
        reject(new Error('sendToClient 函数未注入'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const actualTimeout = timeout || this.requestTimeout;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时 (${actualTimeout}ms)`));
      }, actualTimeout);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      this.sendToClientFn(clientId, 'plugin_message', {
        pluginName,
        message: { ...message, __requestId: requestId }
      });
    });
  }

  /**
   * 广播消息给所有在线客户端的同名插件
   * pluginName 由系统自动绑定
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   * @param {Function} [filter] - 过滤函数 (ws, clientId) => boolean
   */
  broadcast(pluginName, message, filter) {
    if (!this.broadcastFn) {
      console.error('[ServerAPI] broadcast 函数未注入');
      return;
    }

    this.broadcastFn('plugin_message', {
      pluginName,
      message
    }, filter);
  }

  /**
   * 广播消息给安装了本插件的所有客户端
   * @param {string} pluginName - 由系统注入的插件名（内部使用）
   * @param {object} message - 消息内容
   */
  broadcastToPluginClients(pluginName, message) {
    if (!this.pluginManager) return;

    const plugin = this.pluginManager.get(pluginName);
    if (!plugin) return;

    for (const clientId of plugin.enabled) {
      this.sendToClient(clientId, pluginName, message);
    }
  }

  // ===== 客户端信息 =====

  /**
   * 获取所有在线客户端列表
   * @returns {Array<{clientId: string, name: string, platform: string, isOnline: boolean}>}
   */
  getClients() {
    if (!this.getAllClientsFn) return [];
    return this.getAllClientsFn();
  }

  /**
   * 获取指定客户端信息
   * @param {string} clientId - 客户端 ID
   * @returns {object|null}
   */
  getClientInfo(clientId) {
    if (!this.getClientInfoFn) return null;
    return this.getClientInfoFn(clientId);
  }

  /**
   * 检查客户端是否在线
   * @param {string} clientId - 客户端 ID
   * @returns {boolean}
   */
  isClientOnline(clientId) {
    const info = this.getClientInfo(clientId);
    return info?.isOnline || false;
  }

  // ===== 消息处理 =====

  /**
   * 注册插件消息处理器（只接收同名客户端插件的消息）
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {function} handler - 处理函数 (clientId, message) => void
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
   * 处理来自客户端的插件消息（只分发给同名插件处理器）
   * @param {string} pluginName - 插件名
   * @param {string} clientId - 客户端 ID
   * @param {object} message - 消息内容
   */
  handleClientMessage(pluginName, clientId, message) {
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
    const handler = this.messageHandlers.get(pluginName);
    if (handler) {
      try {
        handler(clientId, message);
      } catch (err) {
        console.error(`[ServerAPI] 插件 ${pluginName} 消息处理错误:`, err);
      }
    }
  }

  // ===== 插件存储 =====

  /**
   * 获取插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   * @returns {any}
   */
  getStorage(pluginName, key) {
    const store = this.stores.get(pluginName);
    if (!store) return null;
    return store[key] ?? null;
  }

  /**
   * 设置插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   * @param {any} value - 存储值
   */
  setStorage(pluginName, key, value) {
    if (!this.stores.has(pluginName)) {
      this.stores.set(pluginName, {});
    }
    this.stores.get(pluginName)[key] = value;
  }

  /**
   * 删除插件存储数据
   * @param {string} pluginName - 插件名（由系统注入）
   * @param {string} key - 存储键
   */
  removeStorage(pluginName, key) {
    const store = this.stores.get(pluginName);
    if (store) {
      delete store[key];
    }
  }

  /**
   * 获取插件整个存储对象
   * @param {string} pluginName - 插件名（由系统注入）
   * @returns {object}
   */
  getStore(pluginName) {
    return this.stores.get(pluginName) || {};
  }

  // ===== 清理 =====

  /**
   * 清理指定插件的所有注册和存储
   * @param {string} pluginName - 插件名
   */
  cleanup(pluginName) {
    this.messageHandlers.delete(pluginName);
    this.stores.delete(pluginName);
  }
}

export default new ServerAPI();
