/**
 * RemoteF Server - WebSocket 服务器
 */

import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

export class WsServer {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.wss = null;
    this.clients = new Map();
    this.clientsByName = new Map();
  }

  start(path = '/ws') {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', async (ws, req) => {
      const clientId = uuidv4();
      ws.clientId = clientId;
      ws.isAlive = true;
      this.clients.set(clientId, ws);

      console.log(`[WS] 新连接: ${clientId}`);

      // 心跳
      ws.on('pong', () => { ws.isAlive = true; });

      // 消息处理
      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log(`[WS] ${clientId}: ${msg.type}`);
          await this.handleMessage(ws, clientId, msg);
        } catch (err) {
          console.error(`[WS] 错误: ${err.message}`);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      ws.on('error', (err) => {
        console.error(`[WS] 错误 ${clientId}: ${err.message}`);
      });

      // 发送欢迎消息
      this.sendToClient(clientId, 'connected', {
        clientId,
        message: 'Connected to RemoteF server'
      });

      // 通知插件有新客户端连接
      await this.pluginManager.notifyClientEvent('connect', clientId);
    });

    this.path = path;
  }

  async handleMessage(ws, clientId, message) {
    const { type, payload } = message;

    switch (type) {
      case 'register':
        await this.handleRegister(ws, clientId, payload);
        break;
      case 'plugin_list':
        await this.handlePluginList(ws, clientId);
        break;
      case 'plugin_install':
        await this.handlePluginInstall(ws, clientId, payload);
        break;
      case 'plugin_uninstall':
        await this.handlePluginUninstall(ws, clientId, payload);
        break;
      case 'plugin_message':
        await this.handlePluginMessage(clientId, payload);
        break;
      default:
        if (payload?.pluginName) {
          await this.pluginManager.handlePluginMessage(payload.pluginName, clientId, message);
        }
        break;
    }
  }

  async handleRegister(ws, clientId, payload) {
    const { name, version, platform, extensions } = payload;

    ws.clientName = name || 'Unknown';
    ws.clientVersion = version;
    ws.platform = platform;
    ws.extensions = extensions || [];

    if (name) {
      this.clientsByName.set(name, clientId);
    }

    console.log(`[REGISTER] ${ws.clientName} (${clientId})`);

    // 发送注册确认
    this.sendToClient(clientId, 'registered', {
      success: true,
      serverVersion: '1.0.0',
      clientId
    });
  }

  async handlePluginList(ws, clientId) {
    console.log(`[LIST] ${clientId} 请求插件列表`);

    const plugins = this.pluginManager.list();
    this.sendToClient(clientId, 'plugin_list', {
      plugins
    });

    console.log(`[LIST] 返回 ${plugins.length} 个插件`);
  }

  async handlePluginInstall(ws, clientId, payload) {
    const { pluginName } = payload;
    console.log(`[INSTALL] ${clientId} 请求安装 ${pluginName}`);

    const plugin = this.pluginManager.get(pluginName);
    if (!plugin) {
      console.log(`[INSTALL] ❌ 插件不存在: ${pluginName}`);
      this.sendToClient(clientId, 'plugin_install_result', {
        pluginName,
        success: false,
        error: 'Plugin not found'
      });
      return;
    }

    const clientModule = this.pluginManager.getClientModule(pluginName);
    if (!clientModule) {
      console.log(`[INSTALL] ❌ 无客户端模块: ${pluginName}`);
      this.sendToClient(clientId, 'plugin_install_result', {
        pluginName,
        success: false,
        error: 'No client module'
      });
      return;
    }

    // 发送插件
    this.sendToClient(clientId, 'plugin_push', {
      pluginName,
      module: clientModule
    });

    console.log(`[INSTALL] ✅ ${pluginName} -> ${clientId}`);

    // 通知服务端插件
    if (plugin.serverModule?.onEnable) {
      try {
        await plugin.serverModule.onEnable(
          this.pluginManager.createContext(clientId, ws)
        );
      } catch (err) {
        console.error(`[INSTALL] onEnable 错误: ${err.message}`);
      }
    }
  }

  async handlePluginUninstall(ws, clientId, payload) {
    const { pluginName } = payload;
    console.log(`[UNINSTALL] ${clientId} 卸载 ${pluginName}`);

    const plugin = this.pluginManager.get(pluginName);
    // 通知服务端插件
    if (plugin?.serverModule?.onDisable) {
      try {
        await plugin.serverModule.onDisable(
          this.pluginManager.createContext(clientId, ws)
        );
      } catch (err) {
        console.error(`[UNINSTALL] onDisable 错误: ${err.message}`);
      }
    }
  }

  async handlePluginMessage(clientId, payload) {
    const { pluginName, message } = payload;
    console.log(`[MSG] ${pluginName} <- ${clientId}:`, message);

    await this.pluginManager.handlePluginMessage(pluginName, clientId, {
      type: 'message',
      message
    });
  }

  async handleDisconnect(clientId) {
    const ws = this.clients.get(clientId);
    this.clients.delete(clientId);

    if (ws?.clientName) {
      this.clientsByName.delete(ws.clientName);
    }

    console.log(`[DISCONNECT] ${clientId}`);
    this.broadcast('client_update', {
      action: 'offline',
      clientId,
      name: ws?.clientName
    });

    await this.pluginManager.notifyClientEvent('disconnect', clientId);
  }

  sendToClient(clientId, type, payload) {
    const ws = this.clients.get(clientId);
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    }
  }

  broadcast(type, payload, filter) {
    const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
    for (const [id, ws] of this.clients) {
      if (ws.readyState === 1 && (!filter || filter(ws, id))) {
        ws.send(msg);
      }
    }
  }

  broadcastToPlugin(pluginName, type, payload) {
    // 发送给所有在线客户端，由客户端自行判断插件是否已安装
    for (const [clientId, ws] of this.clients) {
      if (ws.readyState === 1) {
        this.sendToClient(clientId, type, payload);
      }
    }
  }

  getClientInfo(clientId) {
    const ws = this.clients.get(clientId);
    if (!ws) return null;
    return {
      clientId,
      name: ws.clientName,
      version: ws.clientVersion,
      platform: ws.platform,
      extensions: ws.extensions,
      isOnline: ws.isAlive
    };
  }

  getAllClients() {
    return Array.from(this.clients.keys()).map(id => this.getClientInfo(id)).filter(Boolean);
  }

  stop() {
    this.broadcast('server_shutdown', { message: 'Server is shutting down' });
    for (const ws of this.clients.values()) {
      ws.close();
    }
    this.wss?.close();
  }

  getServer() {
    return this.wss;
  }
}
