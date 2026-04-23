/**
 * 美团数据抓取插件 - 服务端模块
 *
 * 功能：
 * 1. 接收客户端上报的接口抓取数据
 * 2. 数据存储与查询
 * 3. AI 命令通道 - HTTP API 供 AI 调用，向指定客户端下发命令
 * 4. AI 命令响应收集
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  manifest: {
    name: 'meituan-crawler',
    version: '1.0.0',
    description: '美团数据抓取插件'
  },

  // 数据存储
  dataDir: path.join(__dirname, '..', '..', 'data'),
  recentCaptures: [],
  maxRecentCaptures: 500,

  // 客户端信息
  clients: new Map(),

  // AI 命令响应（用于同步等待响应）
  pendingAIResponses: new Map(),

  /**
   * 注册入口页 API 路由
   */
  setupRoutes(app, pluginManager) {
    const name = this.manifest.name;

    // ===== 数据查询 API =====

    // 获取最近抓取记录
    app.get(`/api/plugins/${name}/captures`, (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      const urlContains = req.query.url || '';
      let captures = this.recentCaptures;
      if (urlContains) {
        captures = captures.filter(c => c.url.includes(urlContains));
      }
      res.json({
        total: captures.length,
        captures: captures.slice(-limit)
      });
    });

    // 获取抓取统计
    app.get(`/api/plugins/${name}/stats`, (req, res) => {
      res.json({
        total: this.recentCaptures.length,
        clients: this.clients.size,
        byMethod: this.getMethodStats(),
        byStatus: this.getStatusStats(),
        recentClients: Array.from(this.clients.entries()).map(([id, info]) => ({
          clientId: id,
          url: info.url,
          lastSeen: info.lastSeen,
          captureCount: info.captureCount
        }))
      });
    });

    // ===== AI 命令通道 =====

    // AI → 客户端：发送命令（异步，无需等待响应）
    // POST /api/plugins/meituan-crawler/command
    // Body: { clientId, action, params }
    app.post(`/api/plugins/${name}/command`, (req, res) => {
      const { clientId, action, params } = req.body;
      if (!clientId || !action) {
        return res.status(400).json({ error: 'Missing clientId or action' });
      }

      const requestId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const message = { action, params, requestId, _from: 'ai' };

      // 通过 pluginManager 发送命令给客户端
      pluginManager.serverApi.sendToClient(clientId, name, message);

      res.json({ success: true, requestId, clientId, action });
    });

    // AI → 客户端：发送命令并等待响应（同步，最长 30 秒）
    // POST /api/plugins/meituan-crawler/command-sync
    // Body: { clientId, action, params, timeout? }
    app.post(`/api/plugins/${name}/command-sync`, async (req, res) => {
      const { clientId, action, params, timeout } = req.body;
      if (!clientId || !action) {
        return res.status(400).json({ error: 'Missing clientId or action' });
      }

      const requestId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const message = { action, params, requestId, _from: 'ai' };
      const waitTimeout = Math.min(timeout || 30000, 60000);

      // 发送命令
      pluginManager.serverApi.sendToClient(clientId, name, message);

      // 等待响应
      try {
        const response = await this.waitForAIResponse(requestId, waitTimeout);
        res.json({ success: true, requestId, clientId, action, response });
      } catch (err) {
        res.json({ success: false, requestId, clientId, action, error: err.message });
      }
    });

    // AI → 所有安装本插件的客户端：广播命令
    // POST /api/plugins/meituan-crawler/broadcast
    // Body: { action, params }
    app.post(`/api/plugins/${name}/broadcast`, (req, res) => {
      const { action, params } = req.body;
      if (!action) {
        return res.status(400).json({ error: 'Missing action' });
      }

      const requestId = `ai_bc_${Date.now()}`;
      const message = { action, params, requestId, _from: 'ai', _broadcast: true };

      pluginManager.serverApi.broadcastToPluginClients(name, message);

      res.json({ success: true, action, requestId });
    });

    // 获取在线客户端列表
    app.get(`/api/plugins/${name}/clients`, (req, res) => {
      const clients = pluginManager.serverApi.getClients();
      res.json({ total: clients.length, clients });
    });

    console.log(`[MeituanCrawler] 入口页 API 路由已注册`);
  },

  /**
   * 等待 AI 命令响应
   */
  waitForAIResponse(requestId, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAIResponses.delete(requestId);
        reject(new Error(`AI 命令超时 (${timeout}ms)`));
      }, timeout);

      this.pendingAIResponses.set(requestId, { resolve, reject, timer });
    });
  },

  /**
   * 插件启动
   */
  async onStart(ctx) {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    console.log('[MeituanCrawler] 已启动，数据目录:', this.dataDir);
  },

  /**
   * 客户端启用插件
   */
  async onEnable(ctx) {
    console.log(`[MeituanCrawler] 客户端 ${ctx.clientId} 启用插件`);
    this.clients.set(ctx.clientId, {
      connectedAt: Date.now(),
      url: '',
      lastSeen: Date.now(),
      captureCount: 0
    });
  },

  /**
   * 客户端断开
   */
  async onClientEvent(ctx, event, clientId) {
    if (event === 'disconnect') {
      this.clients.delete(clientId);
      console.log(`[MeituanCrawler] 客户端 ${clientId} 断开`);
    }
  },

  /**
   * 处理来自客户端的消息
   */
  async onMessage(ctx, message) {
    const msg = message?.message || message;
    if (!msg) return;

    // 更新客户端信息
    if (this.clients.has(ctx.clientId)) {
      const client = this.clients.get(ctx.clientId);
      client.lastSeen = Date.now();
      if (msg.url) client.url = msg.url;
    }

    // 客户端就绪
    if (msg.type === 'client_ready') {
      console.log(`[MeituanCrawler] 客户端 ${ctx.clientId} 就绪`);
      this.clients.set(ctx.clientId, {
        connectedAt: Date.now(),
        url: msg.url || '',
        lastSeen: Date.now(),
        captureCount: 0
      });
      return;
    }

    // 抓取数据上报
    if (msg.type === 'network_capture') {
      await this.saveCapture(ctx.clientId, msg);
      const client = this.clients.get(ctx.clientId);
      if (client) client.captureCount++;
      return;
    }

    // 定期上报
    if (msg.type === 'periodic_report') {
      console.log(`[MeituanCrawler] 客户端 ${ctx.clientId} 定期上报: ${msg.count} 条请求`);
      return;
    }

    // AI 命令响应
    if (msg.type === 'ai_command_response') {
      const { requestId, result } = msg;
      const pending = this.pendingAIResponses.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAIResponses.delete(requestId);
        pending.resolve(result);
      }
      return;
    }
  },

  /**
   * 保存抓取数据
   */
  async saveCapture(clientId, data) {
    try {
      const { url, method, status, statusText, duration, requestType, timestamp, request, response } = data;

      // 解析接口名
      let apiName = 'unknown';
      try {
        const urlObj = new URL(url);
        apiName = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '_') || 'root';
        if (apiName.length > 80) apiName = apiName.substring(0, 80);
      } catch {
        apiName = 'invalid_url';
      }

      const clientName = clientId.substring(0, 8);
      const now = new Date(timestamp || Date.now());
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
      const pageTitle = this.clients.get(clientId)?.url
        ? new URL(this.clients.get(clientId).url).hostname.replace(/\./g, '_')
        : 'unknown_page';

      const saveDir = path.join(this.dataDir, clientName, dateStr, pageTitle);
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      const baseName = `${timeStr}_${method}_${apiName}`;
      let filePath = path.join(saveDir, `${baseName}.json`);
      let counter = 1;
      while (fs.existsSync(filePath)) {
        filePath = path.join(saveDir, `${baseName}_${counter}.json`);
        counter++;
      }

      fs.writeFileSync(filePath, JSON.stringify({
        url, method, status, statusText: statusText || '',
        duration: duration || 0, requestType, timestamp: timestamp || Date.now(),
        time: now.toISOString(), clientId,
        request: request || null, response: response || null
      }, null, 2), 'utf-8');

      // 内存缓存
      this.recentCaptures.push({ url, method, status, timestamp });
      if (this.recentCaptures.length > this.maxRecentCaptures) {
        this.recentCaptures = this.recentCaptures.slice(-this.maxRecentCaptures);
      }

    } catch (err) {
      console.error('[MeituanCrawler] 保存失败:', err.message);
    }
  },

  getMethodStats() {
    const stats = {};
    for (const c of this.recentCaptures) {
      stats[c.method] = (stats[c.method] || 0) + 1;
    }
    return stats;
  },

  getStatusStats() {
    const stats = {};
    for (const c of this.recentCaptures) {
      const bucket = Math.floor(c.status / 100) * 100;
      const key = `${bucket}-${bucket + 99}`;
      stats[key] = (stats[key] || 0) + 1;
    }
    return stats;
  }
};
