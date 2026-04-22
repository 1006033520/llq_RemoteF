/**
 * RemoteF 服务端入口
 * 负责启动 HTTP API 服务器和 WebSocket 服务器
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { PluginManager } from './plugin-manager.js';
import { ApiServer } from './api-server.js';

const CONFIG = {
  HTTP_PORT: process.env.PORT || 3000,
  WS_PATH: '/ws',
  PLUGINS_DIR: './plugins'
};

class RemoteFServer {
  constructor() {
    this.pluginManager = new PluginManager(CONFIG.PLUGINS_DIR);
    this.apiServer = new ApiServer(this.pluginManager);
    this.clients = new Map();
    this.clientsByName = new Map();
  }

  async start() {
    // 创建 Express 应用
    const app = express();
    app.use(cors());
    app.use(express.json());

    // 创建 HTTP 服务器
    this.server = http.createServer(app);

    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ server: this.server, path: CONFIG.WS_PATH });

    // WebSocket 事件处理
    this.wss.on('connection', async (ws) => {
      const clientId = uuidv4();
      ws.clientId = clientId;
      ws.isAlive = true;
      this.clients.set(clientId, ws);

      console.log(`🔌 客户端连接: ${clientId}`);

      // 心跳
      ws.on('pong', () => { ws.isAlive = true; });

      // 消息处理
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, clientId, message);
        } catch (err) {
          console.error('消息解析失败:', err);
        }
      });

      // 断开
      ws.on('close', () => {
        this.handleDisconnect(clientId);
      });

      // 发送欢迎
      this.sendToClient(clientId, 'connected', {
        clientId,
        message: 'Connected to RemoteF server'
      });

      // 通知插件
      await this.pluginManager.notifyClientEvent('connect', clientId);
    });

    // 设置 API 路由
    this.setupRoutes(app);

    // 加载插件
    await this.pluginManager.loadAll();

    // 启动服务器
    this.server.listen(CONFIG.HTTP_PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════╗
║              RemoteF Server Started             ║
╠═══════════════════════════════════════════════════╣
║  HTTP API:   http://localhost:${CONFIG.HTTP_PORT}              ║
║  WebSocket:  ws://localhost:${CONFIG.HTTP_PORT}${CONFIG.WS_PATH}       ║
║  Admin UI:   http://localhost:${CONFIG.HTTP_PORT}/admin         ║
╚═══════════════════════════════════════════════════╝
      `);

      console.log(`📦 已加载插件: ${this.pluginManager.list().length} 个`);
      this.pluginManager.list().forEach(p => {
        console.log(`   - ${p.name} v${p.version}`);
      });

      console.log('\n🟢 等待客户端连接...\n');
    });

    // 心跳检测
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  setupRoutes(app) {
    // 健康检查
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', time: new Date().toISOString() });
    });

    // 获取插件列表
    app.get('/api/plugins', (req, res) => {
      res.json({ success: true, data: this.pluginManager.list() });
    });

    // 获取客户端列表
    app.get('/api/clients', (req, res) => {
      const clients = Array.from(this.clients.entries()).map(([id, ws]) => ({
        clientId: id,
        name: ws.clientName || 'Unknown',
        platform: ws.platform,
        isOnline: ws.isAlive
      }));
      res.json({ success: true, data: clients });
    });

    // 安装插件到指定客户端
    app.post('/api/clients/:clientId/plugins', (req, res) => {
      const { clientId } = req.params;
      const { pluginName } = req.body;
      const clientModule = this.pluginManager.getClientModule(pluginName);

      if (!clientModule) {
        return res.json({ success: false, error: 'Plugin not found' });
      }

      this.sendToClient(clientId, 'plugin_push', {
        pluginName,
        module: clientModule
      });

      res.json({ success: true, message: 'Plugin sent' });
    });

    // 触发客户端执行插件
    app.post('/api/clients/:clientId/plugins/:pluginName/run', (req, res) => {
      const { clientId, pluginName } = req.params;
      const { config } = req.body;

      this.sendToClient(clientId, 'plugin_run', { pluginName, config: config || {} });
      res.json({ success: true, message: 'Run request sent' });
    });

    // 管理界面
    app.get('/admin', (req, res) => {
      res.send(this.generateAdminUI());
    });

    app.get('/admin/clients', (req, res) => {
      res.json(Array.from(this.clients.entries()).map(([id, ws]) => ({
        clientId: id,
        name: ws.clientName || 'Unknown',
        platform: ws.platform,
        isOnline: ws.isAlive
      })));
    });

    app.get('/admin/plugins', (req, res) => {
      res.json(this.pluginManager.list());
    });
  }

  async handleMessage(ws, clientId, message) {
    const { type, payload } = message;

    switch (type) {
      case 'register':
        ws.clientName = payload.name;
        ws.platform = payload.platform;
        console.log(`📱 客户端注册: ${ws.clientName} (${clientId})`);
        this.sendToClient(clientId, 'registered', { success: true, plugins: this.pluginManager.list() });
        break;

      case 'plugin_list':
        this.sendToClient(clientId, 'plugin_list', { plugins: this.pluginManager.list() });
        break;

      case 'plugin_install':
        const module = this.pluginManager.getClientModule(payload.pluginName);
        if (module) {
          this.sendToClient(clientId, 'plugin_push', { pluginName: payload.pluginName, module });
        }
        break;

      case 'plugin_run_result':
        console.log(`📨 插件 ${payload.pluginName} 结果:`, payload.success ? '成功' : '失败');
        break;
    }
  }

  handleDisconnect(clientId) {
    const ws = this.clients.get(clientId);
    this.clients.delete(clientId);
    if (ws?.clientName) {
      this.clientsByName.delete(ws.clientName);
    }
    console.log(`🔴 客户端断开: ${clientId}`);
    this.pluginManager.notifyClientEvent('disconnect', clientId);
  }

  sendToClient(clientId, type, payload) {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    }
  }

  generateAdminUI() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>RemoteF 管理</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 1rem; padding: 1.5rem; margin-bottom: 1rem; }
    .card h2 { margin-bottom: 1rem; font-size: 1.1rem; }
    .item { background: #0f172a; padding: 1rem; border-radius: 0.5rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; }
    .status { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 0.5rem; }
    .online { background: #22c55e; }
    .offline { background: #6b7280; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 0.5rem; cursor: pointer; background: #3b82f6; color: white; }
    .btn:hover { background: #2563eb; }
    .refresh { margin-top: 1rem; color: #64748b; font-size: 0.8rem; }
    .empty { text-align: center; padding: 2rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔌 RemoteF 管理界面</h1>
    <div class="card">
      <h2>客户端</h2>
      <div id="clients"></div>
    </div>
    <div class="card">
      <h2>插件</h2>
      <div id="plugins"></div>
    </div>
    <div class="refresh" id="time"></div>
  </div>
  <script>
    async function load() {
      const [clients, plugins] = await Promise.all([
        fetch('/admin/clients').then(r => r.json()),
        fetch('/admin/plugins').then(r => r.json())
      ]);

      document.getElementById('clients').innerHTML = clients.length
        ? clients.map(c => '<div class="item"><span><span class="status ' + (c.isOnline ? 'online' : 'offline') + '"></span>' + c.name + '</span><span style="color:#64748b">' + c.platform + '</span></div>').join('')
        : '<div class="empty">暂无连接</div>';

      document.getElementById('plugins').innerHTML = plugins.length
        ? plugins.map(p => '<div class="item"><span>' + p.name + '</span><span style="color:#64748b">v' + p.version + '</span></div>').join('')
        : '<div class="empty">暂无插件</div>';

      document.getElementById('time').textContent = '更新: ' + new Date().toLocaleTimeString();
    }
    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
  }

  stop() {
    this.wss?.close();
    this.server?.close();
    console.log('Server stopped.');
  }
}

// 启动
const server = new RemoteFServer();
server.start();

process.on('SIGINT', () => { server.stop(); process.exit(0); });
process.on('SIGTERM', () => { server.stop(); process.exit(0); });
