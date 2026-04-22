/**
 * 示例插件 - 服务端模块
 *
 * 这个模块运行在服务端，可以：
 * - 管理客户端连接
 * - 处理来自客户端的消息
 * - 提供 HTTP API
 */

export default {
  manifest: {
    name: 'example',
    version: '1.0.0',
    description: '示例插件'
  },

  // 连接统计
  stats: {
    connectCount: 0,
    messages: []
  },

  /**
   * 插件安装时调用
   */
  async onInstall(ctx) {
    console.log('[Example Plugin] 已安装');
  },

  /**
   * 插件启动时调用
   */
  async onStart(ctx) {
    console.log('[Example Plugin] 已启动');
  },

  /**
   * 插件停止时调用
   */
  async onStop(ctx) {
    console.log('[Example Plugin] 已停止');
  },

  /**
   * 客户端事件
   */
  async onClientEvent(ctx, event, clientId) {
    if (event === 'connect') {
      this.stats.connectCount++;
      console.log(`[Example Plugin] 客户端 ${clientId} 连接，当前: ${this.stats.connectCount}`);

      // 向该客户端发送欢迎消息
      ctx.server.send(clientId, 'welcome', {
        message: '欢迎使用 Example 插件！',
        stats: this.stats
      });
    } else if (event === 'disconnect') {
      console.log(`[Example Plugin] 客户端 ${clientId} 断开`);
    }
  },

  /**
   * 客户端启用此插件
   */
  async onEnable(ctx) {
    console.log(`[Example Plugin] 客户端 ${ctx.clientId} 启用插件`);
  },

  /**
   * 客户端禁用此插件
   */
  async onDisable(ctx) {
    console.log(`[Example Plugin] 客户端 ${ctx.clientId} 禁用插件`);
  },

  /**
   * 处理来自客户端的消息
   */
  async onMessage(ctx, message) {
    const { type, payload } = message;

    this.stats.messages.push({
      type,
      payload,
      from: ctx.clientId,
      time: Date.now()
    });

    console.log(`[Example Plugin] 收到消息 from ${ctx.clientId}:`, type, payload);

    // 处理 ping
    if (type === 'ping') {
      ctx.server.send(ctx.clientId, 'pong', {
        timestamp: Date.now()
      });
    }

    // 处理获取统计数据
    if (type === 'get_stats') {
      ctx.server.send(ctx.clientId, 'stats', this.stats);
    }
  },

  /**
   * HTTP 路由
   */
  routes: {
    'GET /api/example/stats': async (ctx, req) => {
      return {
        success: true,
        data: this.stats
      };
    },

    'POST /api/example/broadcast': async (ctx, req) => {
      const { message } = req.body || {};
      ctx.server.broadcast('example_message', {
        from: 'server',
        message
      });
      return { success: true };
    }
  }
};
