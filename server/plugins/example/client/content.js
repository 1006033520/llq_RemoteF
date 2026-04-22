/**
 * 示例插件 - 客户端模块
 * 
 * 功能：
 * 1. 监听网页的网络请求（fetch + XHR），捕获完整请求+响应数据
 * 2. 将请求记录发送给服务端
 * 3. 页面上显示信息窗口
 */

module.exports = {
  // 插件配置
  config: {
    enabled: true,
    showNotification: true
  },

  // 状态
  isRunning: false,
  requestCount: 0,
  requests: [],
  unwatchFetch: null,
  unwatchXHR: null,

  /**
   * 初始化
   */
  init(ctx) {
    console.log('[Example Plugin] 初始化');

    // 监听来自服务端的消息
    ctx.onMessage((message) => {
      console.log('[Example Plugin] 收到服务端消息:', message);
    });

    // 使用 ctx.api 发送消息给同名服务端插件
    ctx.api.sendMessage({
      type: 'client_ready',
      url: window.location.href
    });

    // 使用 ctx.api 获取连接状态
    ctx.api.getConnectionStatus().then((status) => {
      console.log('[Example Plugin] 连接状态:', status);
    });
  },

  /**
   * 运行插件
   */
  async run(ctx, config) {
    console.log('[Example Plugin] 运行');

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.isRunning = true;

    // 显示信息窗口
    this.showPanel(ctx);

    // 监听 fetch 请求（插件自身在 MAIN 世界，直接拦截）
    this.unwatchFetch = this.watchFetch((info) => {
      this.onRequest(ctx, info);
    });

    // 监听 XHR 请求
    this.unwatchXHR = this.watchXHR((info) => {
      this.onRequest(ctx, info);
    });
  },

  // ============================================================
  // 网络拦截（插件自带，不依赖 background.js）
  // ============================================================

  /**
   * 拦截 fetch 请求，捕获完整请求+响应数据
   */
  watchFetch(callback) {
    const originalFetch = window.fetch;
    // 保存原始引用，防止多次拦截
    if (!window.__remotef_fetch_original) {
      window.__remotef_fetch_original = originalFetch;
    }
    const baseFetch = window.__remotef_fetch_original;

    window.fetch = async (...args) => {
      const startTime = Date.now();
      const rawUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
      const options = args[1] || {};
      const method = (options.method || 'GET').toUpperCase();

      // 收集请求信息
      const requestInfo = {
        url: rawUrl,
        method,
        headers: null,
        body: null
      };

      try {
        if (options.headers) {
          const h = {};
          if (options.headers instanceof Headers) {
            options.headers.forEach((v, k) => { h[k] = v; });
          } else if (typeof options.headers === 'object') {
            Object.entries(options.headers).forEach(([k, v]) => { h[k] = v; });
          }
          requestInfo.headers = h;
        }
      } catch (e) { /* ignore */ }

      try {
        if (options.body !== undefined && options.body !== null) {
          if (typeof options.body === 'string') {
            requestInfo.body = options.body;
          } else if (options.body instanceof FormData) {
            const fd = {};
            options.body.forEach((v, k) => { fd[k] = typeof v === 'string' ? v : `[${v.type || 'Blob'}]`; });
            requestInfo.body = fd;
          } else {
            requestInfo.body = String(options.body);
          }
        }
      } catch (e) { /* ignore */ }

      let response;
      try {
        response = await baseFetch(...args);
      } catch (err) {
        try {
          callback({
            type: 'fetch',
            url: rawUrl,
            method,
            status: 0,
            statusText: 'Network Error',
            duration: Date.now() - startTime,
            request: requestInfo,
            response: { headers: null, body: null }
          });
        } catch (e) { /* ignore */ }
        throw err;
      }

      const duration = Date.now() - startTime;

      // 收集响应头
      const responseHeaders = {};
      try {
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });
      } catch (e) { /* ignore */ }

      // 收集响应体
      let responseBody = null;
      try {
        const cloned = response.clone();
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          responseBody = await cloned.text();
          if (contentType.includes('json')) {
            try { responseBody = JSON.parse(responseBody); } catch (e) { /* keep as string */ }
          }
        } else {
          responseBody = `[${contentType || 'unknown'} ${cloned.headers.get('content-length') || '?'}B]`;
        }
      } catch (e) { /* ignore */ }

      try {
        callback({
          type: 'fetch',
          url: rawUrl,
          method,
          status: response.status,
          statusText: response.statusText,
          duration,
          request: requestInfo,
          response: {
            headers: responseHeaders,
            body: responseBody
          }
        });
      } catch (e) { /* ignore callback errors */ }

      return response;
    };

    // 返回取消函数
    return () => {
      window.fetch = baseFetch;
      delete window.__remotef_fetch_original;
    };
  },

  /**
   * 拦截 XHR 请求，捕获完整请求+响应数据
   */
  watchXHR(callback) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__remotef_info = { method: method.toUpperCase(), url, requestHeaders: {} };
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__remotef_info) {
        this.__remotef_info.requestHeaders[name] = value;
      }
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const startTime = Date.now();
      const self = this;

      // 收集请求体
      if (self.__remotef_info && args[0] !== undefined && args[0] !== null) {
        if (typeof args[0] === 'string') {
          self.__remotef_info.requestBody = args[0];
        } else if (args[0] instanceof FormData) {
          const fd = {};
          try { args[0].forEach((v, k) => { fd[k] = typeof v === 'string' ? v : `[${v.type || 'Blob'}]`; }); } catch (e) { /* ignore */ }
          self.__remotef_info.requestBody = fd;
        } else {
          self.__remotef_info.requestBody = `[${typeof args[0]}]`;
        }
      }

      const onLoad = () => {
        try {
          const duration = Date.now() - startTime;

          // 收集响应头
          const responseHeaders = {};
          try {
            const headerStr = self.getAllResponseHeaders();
            if (headerStr) {
              headerStr.trim().split(/\r?\n/).forEach(line => {
                const idx = line.indexOf(': ');
                if (idx > 0) {
                  responseHeaders[line.substring(0, idx).toLowerCase()] = line.substring(idx + 2);
                }
              });
            }
          } catch (e) { /* ignore */ }

          // 收集响应体
          let responseBody = null;
          try {
            if (self.responseType === '' || self.responseType === 'text') {
              responseBody = self.responseText;
              const contentType = self.getResponseHeader('content-type') || '';
              if (contentType.includes('json') && typeof responseBody === 'string') {
                try { responseBody = JSON.parse(responseBody); } catch (e) { /* keep as string */ }
              }
            } else if (self.responseType === 'json') {
              responseBody = self.response;
            } else {
              responseBody = `[${self.responseType || 'unknown'}]`;
            }
          } catch (e) { /* ignore */ }

          callback({
            type: 'xhr',
            url: self.__remotef_info?.url,
            method: self.__remotef_info?.method,
            status: self.status,
            statusText: self.statusText,
            duration,
            request: {
              url: self.__remotef_info?.url,
              method: self.__remotef_info?.method,
              headers: self.__remotef_info?.requestHeaders || null,
              body: self.__remotef_info?.requestBody || null
            },
            response: {
              headers: responseHeaders,
              body: responseBody
            }
          });
        } catch (e) { /* ignore */ }
      };

      self.addEventListener('load', onLoad);
      self.addEventListener('error', () => {
        try {
          callback({
            type: 'xhr',
            url: self.__remotef_info?.url,
            method: self.__remotef_info?.method,
            status: 0,
            statusText: 'Network Error',
            duration: Date.now() - startTime,
            request: {
              url: self.__remotef_info?.url,
              method: self.__remotef_info?.method,
              headers: self.__remotef_info?.requestHeaders || null,
              body: self.__remotef_info?.requestBody || null
            },
            response: { headers: null, body: null }
          });
        } catch (e) { /* ignore */ }
      });

      return originalSend.apply(this, args);
    };

    return () => {
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
      XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
    };
  },

  // ============================================================
  // 数据处理
  // ============================================================

  /**
   * 网络请求回调
   */
  onRequest(ctx, info) {
    this.requestCount++;
    this.requests.push({
      ...info,
      timestamp: Date.now()
    });

    // 只保留最近 100 条
    if (this.requests.length > 100) {
      this.requests = this.requests.slice(-100);
    }

    // 更新面板
    this.updatePanel();

    // 发送完整接口数据到同名服务端插件
    ctx.api.sendMessage({
      type: 'network_request',
      url: info.url,
      method: info.method,
      status: info.status,
      statusText: info.statusText || '',
      duration: info.duration || 0,
      requestType: info.type,
      timestamp: Date.now(),
      request: info.request || null,
      response: info.response || null
    });
  },

  // ============================================================
  // UI 面板
  // ============================================================

  /**
   * 显示信息面板
   */
  showPanel(ctx) {
    // 移除已存在的
    const existing = document.getElementById('remotef-monitor-panel');
    if (existing) existing.remove();

    // 注入样式
    if (!document.getElementById('remotef-monitor-style')) {
      ctx.utils.injectStyle(`
        #remotef-monitor-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 360px;
          max-height: 400px;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 16px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #e2e8f0;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          overflow: hidden;
          animation: remotef-panel-in 0.3s ease;
          user-select: none;
        }
        @keyframes remotef-panel-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .remotef-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          cursor: move;
        }
        .remotef-header h3 {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: white;
        }
        .remotef-header-btns {
          display: flex;
          gap: 8px;
        }
        .remotef-header-btns button {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .remotef-header-btns button:hover {
          background: rgba(255,255,255,0.3);
        }
        .remotef-stats {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .remotef-stat {
          text-align: center;
        }
        .remotef-stat-value {
          font-size: 20px;
          font-weight: 700;
          color: #818cf8;
        }
        .remotef-stat-label {
          font-size: 11px;
          color: #64748b;
          margin-top: 2px;
        }
        .remotef-list {
          max-height: 220px;
          overflow-y: auto;
          padding: 8px;
        }
        .remotef-list::-webkit-scrollbar {
          width: 4px;
        }
        .remotef-list::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
        }
        .remotef-list-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 8px;
          font-size: 12px;
          transition: background 0.15s;
        }
        .remotef-list-item:hover {
          background: rgba(255,255,255,0.05);
        }
        .remotef-method {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
          min-width: 36px;
          text-align: center;
        }
        .remotef-method-GET { background: #166534; color: #86efac; }
        .remotef-method-POST { background: #1e40af; color: #93c5fd; }
        .remotef-method-PUT { background: #854d0e; color: #fde047; }
        .remotef-method-DELETE { background: #991b1b; color: #fca5a5; }
        .remotef-method-PATCH { background: #6b21a8; color: #d8b4fe; }
        .remotef-url {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #94a3b8;
        }
        .remotef-status {
          font-size: 10px;
          color: #64748b;
        }
        .remotef-empty {
          text-align: center;
          padding: 20px;
          color: #475569;
          font-size: 13px;
        }
        .remotef-panel-minimized .remotef-stats,
        .remotef-panel-minimized .remotef-list {
          display: none;
        }
      `);
    }

    const panel = document.createElement('div');
    panel.id = 'remotef-monitor-panel';
    panel.innerHTML = `
      <div class="remotef-header">
        <h3>🔌 RemoteF 网络监控</h3>
        <div class="remotef-header-btns">
          <button id="remotef-minimize" title="最小化">─</button>
          <button id="remotef-close" title="关闭">✕</button>
        </div>
      </div>
      <div class="remotef-stats">
        <div class="remotef-stat">
          <div class="remotef-stat-value" id="remotef-count">0</div>
          <div class="remotef-stat-label">请求数</div>
        </div>
        <div class="remotef-stat">
          <div class="remotef-stat-value" id="remotef-fetch-count">0</div>
          <div class="remotef-stat-label">Fetch</div>
        </div>
        <div class="remotef-stat">
          <div class="remotef-stat-value" id="remotef-xhr-count">0</div>
          <div class="remotef-stat-label">XHR</div>
        </div>
      </div>
      <div class="remotef-list" id="remotef-list">
        <div class="remotef-empty">等待网络请求...</div>
      </div>
    `;

    document.body.appendChild(panel);

    // 关闭按钮
    panel.querySelector('#remotef-close').addEventListener('click', () => {
      panel.remove();
    });

    // 最小化按钮
    panel.querySelector('#remotef-minimize').addEventListener('click', () => {
      panel.classList.toggle('remotef-panel-minimized');
    });

    // 拖拽
    this.makeDraggable(panel, panel.querySelector('.remotef-header'));
  },

  /**
   * 更新面板数据
   */
  updatePanel() {
    const countEl = document.getElementById('remotef-count');
    if (!countEl) return;

    const fetchCount = this.requests.filter(r => r.type === 'fetch').length;
    const xhrCount = this.requests.filter(r => r.type === 'xhr').length;

    document.getElementById('remotef-count').textContent = this.requestCount;
    document.getElementById('remotef-fetch-count').textContent = fetchCount;
    document.getElementById('remotef-xhr-count').textContent = xhrCount;

    // 更新列表（只显示最近 20 条）
    const listEl = document.getElementById('remotef-list');
    if (listEl) {
      const recent = this.requests.slice(-20).reverse();
      listEl.innerHTML = recent.length === 0
        ? '<div class="remotef-empty">等待网络请求...</div>'
        : recent.map(r => {
          const method = (r.method || 'GET').toUpperCase();
          const url = r.url || '';
          const shortUrl = url.length > 40 ? url.substring(0, 40) + '...' : url;
          const methodClass = 'remotef-method-' + method;
          return `<div class="remotef-list-item">
            <span class="remotef-method ${methodClass}">${method}</span>
            <span class="remotef-url" title="${url}">${shortUrl}</span>
            <span class="remotef-status">${r.status || ''} ${r.duration ? r.duration + 'ms' : ''}</span>
          </div>`;
        }).join('');
      
      // 滚动到顶部
      listEl.scrollTop = 0;
    }
  },

  /**
   * 使面板可拖拽
   */
  makeDraggable(el, handle) {
    let startX, startY, initialLeft, initialTop;
    
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = (initialLeft + dx) + 'px';
        el.style.top = (initialTop + dy) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  },

  /**
   * 销毁
   */
  destroy() {
    console.log('[Example Plugin] 销毁');

    if (this.unwatchFetch) this.unwatchFetch();
    if (this.unwatchXHR) this.unwatchXHR();

    const panel = document.getElementById('remotef-monitor-panel');
    if (panel) panel.remove();

    this.isRunning = false;
  }
};
