/**
 * HTTP API 服务器
 * 提供管理界面和 REST API
 */

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ApiServer {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.app = express();
    this.server = null;
    this.wsServer = null;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());

    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', time: new Date().toISOString() });
    });

    // ===== 管理 API =====

    // 获取所有插件
    this.app.get('/api/plugins', (req, res) => {
      res.json({
        success: true,
        data: this.pluginManager.list()
      });
    });

    // 获取单个插件详情
    this.app.get('/api/plugins/:name', (req, res) => {
      const plugin = this.pluginManager.get(req.params.name);
      if (!plugin) {
        return res.status(404).json({ success: false, error: 'Plugin not found' });
      }

      res.json({
        success: true,
        data: {
          ...plugin.manifest,
          status: plugin.status,
          enabledClients: Array.from(plugin.enabled)
        }
      });
    });

    // 获取插件的客户端模块
    this.app.get('/api/plugins/:name/client', (req, res) => {
      const clientModule = this.pluginManager.getClientModule(req.params.name);
      if (!clientModule) {
        return res.status(404).json({ success: false, error: 'Client module not found' });
      }

      res.json({
        success: true,
        data: clientModule
      });
    });

    // 安装插件（从目录）
    this.app.post('/api/plugins/install', async (req, res) => {
      try {
        const { source } = req.body;
        const plugin = await this.pluginManager.installPlugin(source, 'directory');
        res.json({ success: true, data: plugin });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 卸载插件
    this.app.delete('/api/plugins/:name', async (req, res) => {
      const result = await this.pluginManager.unloadPlugin(req.params.name);
      res.json({ success: result });
    });

    // ===== 客户端管理 API =====

    // 获取所有客户端
    this.app.get('/api/clients', (req, res) => {
      const clients = this.wsServer?.getAllClients() || [];
      res.json({
        success: true,
        data: clients
      });
    });

    // 获取单个客户端详情
    this.app.get('/api/clients/:clientId', (req, res) => {
      const client = this.wsServer?.getClientInfo(req.params.clientId);
      if (!client) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }

      // 获取该客户端安装的插件
      const installedPlugins = [];
      for (const [name, plugin] of this.pluginManager.plugins) {
        if (plugin.enabled.has(req.params.clientId)) {
          installedPlugins.push(name);
        }
      }

      res.json({
        success: true,
        data: {
          ...client,
          installedPlugins
        }
      });
    });

    // 触发客户端安装插件
    this.app.post('/api/clients/:clientId/plugins', (req, res) => {
      const { pluginName } = req.body;
      this.wsServer?.sendToClient(req.params.clientId, 'plugin_install_request', { pluginName });
      res.json({ success: true, message: 'Install request sent' });
    });

    // ===== 管理界面 =====
    this.app.get('/admin', (req, res) => {
      res.send(this.generateAdminUI());
    });

    this.app.get('/admin/clients', (req, res) => {
      res.json(this.wsServer?.getAllClients() || []);
    });

    this.app.get('/admin/plugins', (req, res) => {
      res.json(this.pluginManager.list());
    });

    // 插件入口页
    this.app.get('/admin/plugin/:name', (req, res) => {
      const plugin = this.pluginManager.get(req.params.name);
      if (!plugin) {
        return res.status(404).send('Plugin not found');
      }

      const pageFile = plugin.manifest.server?.page;
      if (!pageFile) {
        return res.status(404).send('Plugin has no entry page');
      }

      const pagePath = path.join(plugin.path, pageFile);
      if (!fs.existsSync(pagePath)) {
        return res.status(404).send('Plugin page file not found');
      }

      res.sendFile(pagePath);
    });

    // 插件入口页 API 数据
    this.app.get('/admin/plugin/:name/data', (req, res) => {
      const plugin = this.pluginManager.get(req.params.name);
      if (!plugin) {
        return res.status(404).json({ error: 'Plugin not found' });
      }

      const onlineClients = this.wsServer ? Array.from(this.wsServer.clients?.entries?.() || [])
        .filter(([, ws]) => ws.isAlive && plugin.enabled.has(ws.clientId))
        .map(([id, ws]) => ({
          clientId: ws.clientId || id,
          name: ws.clientName || 'Unknown',
          platform: ws.platform
        })) : [];

      res.json({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        status: plugin.status,
        enabledClients: Array.from(plugin.enabled),
        onlineClients
      });
    });

    // 插件静态资源
    this.app.get('/admin/plugin/:name/assets/*', (req, res) => {
      const plugin = this.pluginManager.get(req.params.name);
      if (!plugin) {
        return res.status(404).send('Plugin not found');
      }

      const assetPath = path.join(plugin.path, 'assets', req.params[0]);
      if (!fs.existsSync(assetPath)) {
        return res.status(404).send('Asset not found');
      }

      res.sendFile(assetPath);
    });
  }

  /**
   * 设置 WebSocket 服务器引用（用于 API 获取客户端信息）
   */
  setWsServer(wsServer) {
    this.wsServer = wsServer;
  }

  /**
   * 生成管理界面 HTML
   */
  generateAdminUI() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RemoteF 管理界面</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 2rem; color: #f8fafc; }
    h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #f8fafc; }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid #334155;
      padding-bottom: 1rem;
    }
    .tab {
      padding: 0.75rem 1.5rem;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .tab:hover { background: #1e293b; color: #e2e8f0; }
    .tab.active { background: #3b82f6; color: white; }

    .card {
      background: #1e293b;
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .status.online { background: #166534; color: #86efac; }
    .status.offline { background: #7f1d1d; color: #fca5a5; }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }

    .client-list, .plugin-list {
      display: grid;
      gap: 1rem;
    }
    .client-item, .plugin-item {
      background: #0f172a;
      padding: 1rem;
      border-radius: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .client-info h3 { font-size: 1rem; margin-bottom: 0.25rem; }
    .client-info p { font-size: 0.8rem; color: #64748b; }

    .actions { display: flex; gap: 0.5rem; }
    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 0.5rem;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s;
    }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-secondary { background: #475569; color: white; }
    .btn-secondary:hover { background: #64748b; }

    .refresh-time {
      text-align: center;
      color: #64748b;
      font-size: 0.8rem;
      margin-top: 2rem;
    }

    .empty {
      text-align: center;
      padding: 3rem;
      color: #64748b;
    }

    #clients-panel, #plugins-panel { display: none; }
    #clients-panel.active, #plugins-panel.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔌 RemoteF 管理界面</h1>

    <div class="tabs">
      <button class="tab active" data-panel="clients">🖥️ 客户端</button>
      <button class="tab" data-panel="plugins">📦 插件</button>
    </div>

    <div id="clients-panel" class="active">
      <div class="card">
        <div class="card-header">
          <h2>已连接客户端</h2>
          <button class="btn btn-secondary" onclick="refreshClients()">🔄 刷新</button>
        </div>
        <div class="client-list" id="client-list">
          <div class="empty">暂无连接</div>
        </div>
      </div>
    </div>

    <div id="plugins-panel">
      <div class="card">
        <div class="card-header">
          <h2>可用插件</h2>
          <button class="btn btn-secondary" onclick="refreshPlugins()">🔄 刷新</button>
        </div>
        <div class="plugin-list" id="plugin-list">
          <div class="empty">暂无插件</div>
        </div>
      </div>
    </div>

    <div class="refresh-time" id="refresh-time"></div>
  </div>

  <script>
    let clients = [];
    let plugins = [];

    // Tab 切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('[id$="-panel"]').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.panel + '-panel').classList.add('active');
      });
    });

    async function refreshClients() {
      try {
        const res = await fetch('/admin/clients');
        clients = await res.json();
        renderClients();
      } catch (err) {
        console.error('刷新客户端失败:', err);
      }
    }

    async function refreshPlugins() {
      try {
        const res = await fetch('/admin/plugins');
        plugins = await res.json();
        renderPlugins();
      } catch (err) {
        console.error('刷新插件失败:', err);
      }
    }

    function renderClients() {
      const list = document.getElementById('client-list');
      if (clients.length === 0) {
        list.innerHTML = '<div class="empty">暂无连接</div>';
        return;
      }
      list.innerHTML = clients.map(c => \`
        <div class="client-item">
          <div class="client-info">
            <h3>\${c.name || 'Unknown Client'}</h3>
            <p>ID: \${c.clientId.slice(0, 8)}... | 平台: \${c.platform || 'unknown'}</p>
          </div>
          <div class="actions">
            <span class="status \${c.isOnline ? 'online' : 'offline'}">
              <span class="status-dot"></span>
              \${c.isOnline ? '在线' : '离线'}
            </span>
          </div>
        </div>
      \`).join('');
      updateTime();
    }

    function renderPlugins() {
      const list = document.getElementById('plugin-list');
      if (plugins.length === 0) {
        list.innerHTML = '<div class="empty">暂无插件</div>';
        return;
      }
      list.innerHTML = plugins.map(p => \`
        <div class="plugin-item" style="cursor:pointer" onclick="window.location.href='/admin/plugin/\${p.name}'">
          <div class="client-info">
            <h3>\${p.name}</h3>
            <p>v\${p.version} | \${p.description || '无描述'}</p>
          </div>
          <div class="actions">
            <span class="status \${p.status === 'loaded' ? 'online' : 'offline'}">
              \${p.status}
            </span>
            <span style="color:#64748b;margin-left:0.5rem">→</span>
          </div>
        </div>
      \`).join('');
      updateTime();
    }

    function updateTime() {
      document.getElementById('refresh-time').textContent =
        '最后更新: ' + new Date().toLocaleTimeString();
    }

    // 初始加载
    refreshClients();
    refreshPlugins();

    // 自动刷新
    setInterval(() => {
      if (document.getElementById('clients-panel').classList.contains('active')) {
        refreshClients();
      }
    }, 5000);
  </script>
</body>
</html>`;
  }

  /**
   * 启动服务器
   */
  start(port) {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`🌐 HTTP 服务器运行在端口 ${port}`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    this.server?.close();
  }
}
