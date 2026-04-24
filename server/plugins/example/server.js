/**
 * 示例插件 - 服务端模块
 * 
 * 功能：
 * 1. 接收客户端发来的网络请求记录
 * 2. 保存到 /客户端名称/日期/网页标题/时间_接口名称.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  manifest: {
    name: 'example',
    version: '1.8.0',
    description: '网络请求监控插件'
  },

  // 数据保存根目录
  dataDir: path.join(__dirname, '..', '..', 'data'),

  // 客户端信息缓存
  clientInfo: new Map(),

  // 最近的请求记录（内存缓存，用于入口页展示）
  recentRequests: [],
  maxRecentRequests: 200,

  /**
   * 注册入口页 API 路由
   * 在服务端启动后由 PluginManager 调用
   */
  setupRoutes(app, pluginManager) {
    // 获取请求记录
    app.get(`/requests/count`, (req, res) => {
      res.json({
        count: this.recentRequests.length,
        requests: this.recentRequests.slice(-50)
      });
    });

    // 发送消息给客户端
    app.post(`/send`, (req, res) => {
      const { clientId, message } = req.body;
      if (!clientId || !message) {
        return res.status(400).json({ error: 'Missing clientId or message' });
      }

      // 通过 pluginManager 的 serverApi 发送
      pluginManager.serverApi.sendToClient(clientId, this.manifest.name, message);
      res.json({ success: true });
    });

    console.log(`[Example Plugin] 入口页 API 路由已注册`);
  },

  /**
   * 插件启动
   */
  async onStart(ctx) {
    // 确保 data 目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    console.log('[Example Plugin] 已启动，数据目录:', this.dataDir);
  },

  /**
   * 客户端事件
   */
  async onClientEvent(ctx, event, clientId) {
    if (event === 'connect') {
      console.log(`[Example Plugin] 客户端 ${clientId} 连接`);
    } else if (event === 'disconnect') {
      console.log(`[Example Plugin] 客户端 ${clientId} 断开`);
    }
  },

  /**
   * 客户端启用插件
   */
  async onEnable(ctx) {
    console.log(`[Example Plugin] 客户端 ${ctx.clientId} 启用插件`);
    this.clientInfo.set(ctx.clientId, { connectedAt: Date.now() });

    // 使用 ctx.api 获取连接状态
    const status = ctx.api.getConnectionStatus();
    console.log(`[Example Plugin] 服务端状态: 在线客户端 ${status.onlineClients}, 插件数 ${status.totalPlugins}`);
  },

  /**
   * 处理来自客户端的消息
   */
  async onMessage(ctx, message) {
    // 消息格式: { pluginName: 'example', message: { type: '...', ... } }
    const msg = message?.message || message;
    
    if (!msg) return;

    // 客户端就绪通知
    if (msg.type === 'client_ready') {
      this.clientInfo.set(ctx.clientId, {
        ...this.clientInfo.get(ctx.clientId),
        url: msg.url
      });
      console.log(`[Example Plugin] 客户端 ${ctx.clientId} 就绪, URL: ${msg.url}`);
      return;
    }

    // 网络请求记录
    if (msg.type === 'network_request') {
      await this.saveRequest(ctx.clientId, msg);
      // 使用 ctx.api 发送保存确认给客户端同名插件
      ctx.api.sendToClient(ctx.clientId, {
        type: 'request_saved',
        url: msg.url,
        method: msg.method,
        timestamp: msg.timestamp
      });
      return;
    }

    console.log(`[Example Plugin] 未处理消息:`, msg.type);
  },

  /**
   * 保存网络请求记录到文件
   * 路径格式：/客户端名称/日期/网页标题/时间_接口名称.json
   */
  async saveRequest(clientId, requestInfo) {
    try {
      const { url, method, status, statusText, duration, requestType, timestamp, request, response } = requestInfo;

      // 解析 URL 获取接口名称
      let apiName = 'unknown';
      try {
        const urlObj = new URL(url);
        // 取 path 部分作为接口名，将 / 转换为 _
        apiName = urlObj.pathname
          .replace(/^\//, '')
          .replace(/\/$/g, '')
          .replace(/\//g, '_') || 'root';
        // 截断过长的名称
        if (apiName.length > 80) {
          apiName = apiName.substring(0, 80);
        }
      } catch {
        apiName = 'invalid_url';
      }

      // 客户端名称（使用 clientId 前8位）
      const clientName = clientId.substring(0, 8);

      // 日期目录
      const now = new Date(timestamp || Date.now());
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

      // 时间戳文件名
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHmmss

      // 网页标题（从客户端信息获取，或用域名代替）
      const clientData = this.clientInfo.get(clientId);
      let pageTitle = 'unknown_page';
      try {
        if (clientData?.url) {
          const urlObj = new URL(clientData.url);
          pageTitle = urlObj.hostname.replace(/\./g, '_');
        }
      } catch { /* ignore */ }

      // 构建保存路径
      const saveDir = path.join(
        this.dataDir,
        clientName,
        dateStr,
        pageTitle
      );

      // 确保目录存在
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      // 文件名：时间_方法_接口名称.json
      const fileName = `${timeStr}_${method}_${apiName}.json`;
      const filePath = path.join(saveDir, fileName);

      // 保存完整数据（请求 + 响应）
      const data = {
        url,
        method,
        status,
        statusText: statusText || '',
        duration: duration || 0,
        requestType,
        timestamp: timestamp || Date.now(),
        time: now.toISOString(),
        clientId,
        request: request || null,
        response: response || null
      };

      // 如果文件已存在（同一秒同一接口），追加序号
      let finalPath = filePath;
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        finalPath = path.join(saveDir, `${base}_${counter}${ext}`);
        counter++;
      }

      fs.writeFileSync(finalPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[Example Plugin] 保存请求: ${path.relative(this.dataDir, finalPath)}`);

      // 加入内存缓存
      this.recentRequests.push(data);
      if (this.recentRequests.length > this.maxRecentRequests) {
        this.recentRequests = this.recentRequests.slice(-this.maxRecentRequests);
      }

    } catch (err) {
      console.error('[Example Plugin] 保存请求失败:', err.message);
    }
  }
};
