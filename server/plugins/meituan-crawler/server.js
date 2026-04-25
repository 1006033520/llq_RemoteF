/**
 * 美团数据抓取插件 - 服务端模块
 *
 * 功能：
 * 1. 接收客户端上报的接口抓取数据
 * 2. 数据存储与查询
 * 3. AI 命令通道 - HTTP API 供 AI 调用，向指定客户端下发命令
 * 4. AI 命令响应收集
 * 5. 自动同步业务数据到 sgDataServer 闪购竞品数据分析系统
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== sgDataServer 同步配置 ==========
const SG_DATA_CONFIG = {
  enabled: true,                            // 是否启用自动同步
  serverUrl: 'http://localhost:3200',       // sgDataServer 地址
  apiPath: '/api/import/crawler',           // 导入API路径
  syncOnStart: true,                        // 启动时是否同步历史未导入数据
  // 需要同步的业务接口URL关键词
  businessKeywords: [
    '/quickbuy/v1/poi/food',
    '/quickbuy/v1/poi/sputag/products',
    '/quickbuy/v1/poi/product/smooth/render',
    '/quickbuy/v2/poi/product/info',
    '/wxapp/v1/poi/food',
    '/wxapp/v1/poi/sputag/products',
  ],
};

export default {
  manifest: {
    name: 'meituan-crawler',
    version: '1.1.0',
    description: '美团数据抓取插件 - 抓取接口数据、模拟触摸滑动、AI 操控页面、自动同步数据'
  },

  // 数据存储
  dataDir: path.join(__dirname, '..', '..', 'data'),
  recentCaptures: [],
  maxRecentCaptures: 500,

  // 客户端信息
  clients: new Map(),

  // AI 命令响应（用于同步等待响应）
  pendingAIResponses: new Map(),

  // ========== sgDataServer 同步状态 ==========
  syncStats: {
    total: 0,          // 总同步次数
    success: 0,        // 成功次数
    fail: 0,           // 失败次数
    lastSyncAt: null,   // 最后同步时间
    lastSyncResult: null, // 最后同步结果
  },
  syncQueue: [],        // 待同步队列
  isSyncing: false,     // 是否正在同步

  /**
   * 判断URL是否为业务接口（需要同步到sgDataServer）
   */
  isBusinessUrl(url) {
    if (!url) return false;
    return SG_DATA_CONFIG.businessKeywords.some(kw => url.includes(kw));
  },

  /**
   * 同步单条抓取数据到 sgDataServer
   */
  async syncToSgData(captureData) {
    if (!SG_DATA_CONFIG.enabled) return;

    const { url, request, response } = captureData;

    // 构造与 meituanParser 兼容的JSON格式
    const payload = {
      url,
      method: captureData.method,
      status: captureData.status,
      statusText: captureData.statusText || '',
      duration: captureData.duration || 0,
      requestType: captureData.requestType,
      timestamp: captureData.timestamp || Date.now(),
      time: new Date(captureData.timestamp || Date.now()).toISOString(),
      clientId: captureData.clientId,
      request: request || null,
      response: response || null
    };

    try {
      const serverUrl = SG_DATA_CONFIG.serverUrl + SG_DATA_CONFIG.apiPath;
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload, source: 'remoteF-crawler' }),
        signal: AbortSignal.timeout(10000), // 10秒超时
      });

      const result = await res.json();
      this.syncStats.total++;
      if (result.code === 0) {
        this.syncStats.success++;
        this.syncStats.lastSyncResult = 'success';
        const detail = result.data;
        if (detail && detail.details && detail.details.length > 0) {
          const d = detail.details[0];
          console.log(`[MeituanCrawler→sgData] 同步成功: ${d.type} 商铺:${d.shop || 0} 商品:${d.products || 0} SKU:${d.skus || 0} 价格:${d.priceRecords || 0}`);
        }
      } else {
        this.syncStats.fail++;
        this.syncStats.lastSyncResult = `error: ${result.msg}`;
        console.warn(`[MeituanCrawler→sgData] 同步失败: ${result.msg}`);
      }
    } catch (err) {
      this.syncStats.fail++;
      this.syncStats.lastSyncResult = `error: ${err.message}`;
      // sgDataServer 可能未启动，不频繁报错
      if (this.syncStats.total <= 3 || this.syncStats.total % 50 === 0) {
        console.warn(`[MeituanCrawler→sgData] 同步异常: ${err.message}`);
      }
    }
    this.syncStats.lastSyncAt = new Date().toISOString();
  },

  /**
   * 处理同步队列（异步逐条处理，避免并发过多）
   */
  async processSyncQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    while (this.syncQueue.length > 0) {
      const data = this.syncQueue.shift();
      await this.syncToSgData(data);
    }

    this.isSyncing = false;
  },

  /**
   * 启动时同步历史未导入数据
   * 扫描 dataDir 下的所有JSON文件，对业务接口数据推送到 sgDataServer
   */
  async syncHistoricalData() {
    if (!SG_DATA_CONFIG.syncOnStart || !SG_DATA_CONFIG.enabled) return;

    console.log('[MeituanCrawler→sgData] 开始同步历史数据...');
    let syncCount = 0;
    let skipCount = 0;

    const walkDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const jsonData = JSON.parse(content);
            const url = jsonData.url || jsonData.request?.url || '';

            if (this.isBusinessUrl(url)) {
              this.syncQueue.push(jsonData);
              syncCount++;
            } else {
              skipCount++;
            }
          } catch (e) {
            // 忽略解析失败的文件
          }
        }
      }
    };

    walkDir(this.dataDir);

    console.log(`[MeituanCrawler→sgData] 发现 ${syncCount} 条业务数据待同步，${skipCount} 条非业务数据跳过`);

    if (syncCount > 0) {
      await this.processSyncQueue();
      console.log(`[MeituanCrawler→sgData] 历史数据同步完成: 成功${this.syncStats.success} 失败${this.syncStats.fail}`);
    }
  },

  /**
   * 注册入口页 API 路由
   */
  setupRoutes(app, pluginManager) {
    const name = this.manifest.name;

    // ===== 数据查询 API =====

    // 获取最近抓取记录
    app.get(`/captures`, (req, res) => {
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
    app.get(`/stats`, (req, res) => {
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
        })),
        syncStats: this.syncStats
      });
    });

    // ===== AI 命令通道 =====

    // AI → 客户端：发送命令（异步，无需等待响应）
    app.post(`/command`, (req, res) => {
      const { clientId, action, params } = req.body;
      if (!clientId || !action) {
        return res.status(400).json({ error: 'Missing clientId or action' });
      }

      const requestId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const message = { action, params, requestId, _from: 'ai' };

      pluginManager.serverApi.sendToClient(clientId, name, message);

      res.json({ success: true, requestId, clientId, action });
    });

    // AI → 客户端：发送命令并等待响应（同步，最长 30 秒）
    app.post(`/command-sync`, async (req, res) => {
      const { clientId, action, params, timeout } = req.body;
      if (!clientId || !action) {
        return res.status(400).json({ error: 'Missing clientId or action' });
      }

      const requestId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const message = { action, params, requestId, _from: 'ai' };
      const waitTimeout = Math.min(timeout || 30000, 60000);

      pluginManager.serverApi.sendToClient(clientId, name, message);

      try {
        const response = await this.waitForAIResponse(requestId, waitTimeout);
        res.json({ success: true, requestId, clientId, action, response });
      } catch (err) {
        res.json({ success: false, requestId, clientId, action, error: err.message });
      }
    });

    // AI → 所有安装本插件的客户端：广播命令
    app.post(`/broadcast`, (req, res) => {
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
    app.get(`/clients`, (req, res) => {
      const clients = pluginManager.serverApi.getClients();
      res.json({ total: clients.length, clients });
    });

    // ===== sgDataServer 同步配置 API =====

    // 获取同步配置和状态
    app.get(`/sync-config`, (req, res) => {
      res.json({
        config: {
          enabled: SG_DATA_CONFIG.enabled,
          serverUrl: SG_DATA_CONFIG.serverUrl,
          syncOnStart: SG_DATA_CONFIG.syncOnStart,
          businessKeywords: SG_DATA_CONFIG.businessKeywords,
        },
        stats: this.syncStats,
        queueSize: this.syncQueue.length
      });
    });

    // 更新同步配置
    app.post(`/sync-config`, (req, res) => {
      const { enabled, serverUrl, syncOnStart } = req.body;
      if (enabled !== undefined) SG_DATA_CONFIG.enabled = !!enabled;
      if (serverUrl) SG_DATA_CONFIG.serverUrl = serverUrl;
      if (syncOnStart !== undefined) SG_DATA_CONFIG.syncOnStart = !!syncOnStart;
      res.json({ success: true, config: SG_DATA_CONFIG });
    });

    // 手动触发全量同步
    app.post(`/sync-historical`, async (req, res) => {
      this.syncHistoricalData()
        .then(() => res.json({ success: true, stats: this.syncStats }))
        .catch(err => res.json({ success: false, error: err.message }));
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
    console.log(`[MeituanCrawler→sgData] 自动同步${SG_DATA_CONFIG.enabled ? '已启用' : '已禁用'}，目标: ${SG_DATA_CONFIG.serverUrl}`);

    // 延迟同步历史数据（等sgDataServer启动）
    if (SG_DATA_CONFIG.syncOnStart && SG_DATA_CONFIG.enabled) {
      setTimeout(() => this.syncHistoricalData(), 3000);
    }
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

      // ★ 自动同步到 sgDataServer
      if (this.isBusinessUrl(msg.url)) {
        this.syncQueue.push({ ...msg, clientId: ctx.clientId });
        this.processSyncQueue(); // 异步处理，不阻塞
      }
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
