/**
 * 示例插件 - 客户端模块
 *
 * 这个模块将注入到网页中运行，可以：
 * - 操作页面 DOM
 * - 监听网络请求
 * - 发送消息到服务端
 */

module.exports = {
  manifest: {
    name: 'example',
    version: '1.0.0'
  },

  // 插件配置
  config: {
    enabled: true,
    autoReport: false,
    showNotification: true
  },

  // 状态
  isRunning: false,
  injectedStyle: null,

  /**
   * 初始化
   */
  init(ctx) {
    console.log('[Example Plugin] 初始化');

    // 注入样式
    this.injectedStyle = ctx.utils.injectStyle(`
      .remotef-example-banner {
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: remotef-slide-in 0.3s ease;
      }
      .remotef-example-banner h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
      }
      .remotef-example-banner p {
        margin: 0;
        font-size: 0.85rem;
        opacity: 0.9;
      }
      .remotef-example-banner .close-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 1.2rem;
        opacity: 0.7;
      }
      .remotef-example-banner .close-btn:hover {
        opacity: 1;
      }
      @keyframes remotef-slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `);

    // 监听来自服务端的消息
    ctx.onMessage((message) => {
      console.log('[Example Plugin] 收到服务端消息:', message);
    });

    // 向服务端发送注册消息
    ctx.sendMessage({
      type: 'client_ready',
      url: window.location.href
    });
  },

  /**
   * 运行插件
   */
  async run(ctx, config) {
    console.log('[Example Plugin] 运行', config);

    // 更新配置
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.isRunning = true;

    // 显示通知
    if (this.config.showNotification) {
      this.showBanner(ctx);
    }

    // 监听网络请求（如果启用）
    if (this.config.autoReport) {
      this.watchNetwork(ctx);
    }

    return {
      success: true,
      pageUrl: window.location.href,
      timestamp: Date.now()
    };
  },

  /**
   * 显示横幅
   */
  showBanner(ctx) {
    // 移除已存在的
    const existing = document.querySelector('.remotef-example-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'remotef-example-banner';
    banner.innerHTML = `
      <button class="close-btn">&times;</button>
      <h3>⚡ Example Plugin Active</h3>
      <p>当前页面: ${window.location.hostname}</p>
      <p>运行时间: <span id="remotef-runtime">0</span>秒</p>
    `;

    document.body.appendChild(banner);

    // 关闭按钮
    banner.querySelector('.close-btn').addEventListener('click', () => {
      banner.remove();
    });

    // 运行时长计数
    let seconds = 0;
    const counter = setInterval(() => {
      seconds++;
      const el = document.getElementById('remotef-runtime');
      if (el) {
        el.textContent = seconds;
      } else {
        clearInterval(counter);
      }
    }, 1000);
  },

  /**
   * 监听网络请求
   */
  watchNetwork(ctx) {
    ctx.utils.watchFetch(async (info) => {
      // 发送网络请求信息到服务端
      ctx.sendMessage({
        type: 'network_request',
        url: typeof info.url === 'string' ? info.url : info.url.toString(),
        method: info.options?.method || 'GET'
      });
    });
  },

  /**
   * 销毁
   */
  destroy() {
    console.log('[Example Plugin] 销毁');

    // 移除注入的样式
    if (this.injectedStyle) {
      this.injectedStyle.remove();
    }

    // 移除横幅
    const banner = document.querySelector('.remotef-example-banner');
    if (banner) banner.remove();

    this.isRunning = false;
  }
};
