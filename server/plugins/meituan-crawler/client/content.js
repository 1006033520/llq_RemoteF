/**
 * 美团数据抓取插件 - 客户端模块
 *
 * 功能：
 * 1. 抓取页面发出的所有接口请求（fetch + XHR）
 * 2. 仿真模拟人手触摸滑动事件和点击事件（ctx.input）
 * 3. 获取当前页面信息（DOM、可视区域、元素坐标）
 * 4. 接收 AI 命令并执行对应操作
 * 5. 向服务端上报抓取的数据
 */

module.exports = {

  config: {
    enabled: true,
    autoReport: true,
    captureInterval: 5000
  },

  // 状态
  isRunning: false,
  requests: [],
  unwatchFetch: null,
  unwatchXHR: null,
  lastReportTime: 0,
  pageInfoCache: null,

  /**
   * 初始化
   */
  init(ctx) {
    console.log('[MeituanCrawler] 初始化');
    this._ctx = ctx; // 存储 ctx 供 onMessage 使用

    // 上报客户端就绪
    ctx.api.sendMessage({
      type: 'client_ready',
      url: window.location.href,
      plugin: 'meituan-crawler',
      version: '1.0.0'
    });
  },

  onMessage(message) {
    console.log('[MeituanCrawler] 收到服务端消息:', message);
    this.handleServerMessage(this._ctx, message);
  },

  /**
   * 运行插件
   */
  async run(ctx, config) {
    console.log('[MeituanCrawler] 运行');

    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.isRunning = true;

    // 开始网络拦截
    this.unwatchFetch = this.watchFetch((info) => {
      this.onRequest(ctx, info);
    });

    this.unwatchXHR = this.watchXHR((info) => {
      this.onRequest(ctx, info);
    });

    // 定期上报数据
    this.startPeriodicReport();
  },

  // ============================================================
  // 网络拦截
  // ============================================================

  watchFetch(callback) {
    const baseFetch = window.__remotef_mt_fetch_original || window.fetch;
    if (!window.__remotef_mt_fetch_original) {
      window.__remotef_mt_fetch_original = baseFetch;
    }

    window.fetch = async (...args) => {
      const startTime = Date.now();
      const rawUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
      const options = args[1] || {};
      const method = (options.method || 'GET').toUpperCase();

      const requestInfo = { url: rawUrl, method, headers: null, body: null };

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
        if (options.body !== undefined && options.body !== null) {
          if (typeof options.body === 'string') {
            requestInfo.body = options.body;
          } else if (options.body instanceof FormData) {
            const fd = {};
            options.body.forEach((v, k) => { fd[k] = typeof v === 'string' ? v : `[${v.type || 'Blob'}]`; });
            requestInfo.body = fd;
          }
        }
      } catch (e) { /* ignore */ }

      let response;
      try {
        response = await baseFetch(...args);
      } catch (err) {
        try { callback({ type: 'fetch', url: rawUrl, method, status: 0, statusText: 'Network Error', duration: Date.now() - startTime, request: requestInfo, response: { headers: null, body: null } }); } catch (e) { /* ignore */ }
        throw err;
      }

      const duration = Date.now() - startTime;
      const responseHeaders = {};
      try { response.headers.forEach((v, k) => { responseHeaders[k] = v; }); } catch (e) { /* ignore */ }

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

      try { callback({ type: 'fetch', url: rawUrl, method, status: response.status, statusText: response.statusText, duration, request: requestInfo, response: { headers: responseHeaders, body: responseBody } }); } catch (e) { /* ignore */ }
      return response;
    };

    return () => {
      window.fetch = baseFetch;
      delete window.__remotef_mt_fetch_original;
    };
  },

  watchXHR(callback) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__mt_info = { method: method.toUpperCase(), url, requestHeaders: {} };
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__mt_info) this.__mt_info.requestHeaders[name] = value;
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const startTime = Date.now();
      const self = this;

      if (self.__mt_info && args[0] !== undefined && args[0] !== null) {
        if (typeof args[0] === 'string') {
          self.__mt_info.requestBody = args[0];
        } else if (args[0] instanceof FormData) {
          const fd = {};
          try { args[0].forEach((v, k) => { fd[k] = typeof v === 'string' ? v : `[${v.type || 'Blob'}]`; }); } catch (e) { /* ignore */ }
          self.__mt_info.requestBody = fd;
        }
      }

      const onLoad = () => {
        try {
          const duration = Date.now() - startTime;
          const responseHeaders = {};
          try {
            const headerStr = self.getAllResponseHeaders();
            if (headerStr) headerStr.trim().split(/\r?\n/).forEach(line => {
              const idx = line.indexOf(': ');
              if (idx > 0) responseHeaders[line.substring(0, idx).toLowerCase()] = line.substring(idx + 2);
            });
          } catch (e) { /* ignore */ }

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

          callback({ type: 'xhr', url: self.__mt_info?.url, method: self.__mt_info?.method, status: self.status, statusText: self.statusText, duration, request: { url: self.__mt_info?.url, method: self.__mt_info?.method, headers: self.__mt_info?.requestHeaders || null, body: self.__mt_info?.requestBody || null }, response: { headers: responseHeaders, body: responseBody } });
        } catch (e) { /* ignore */ }
      };

      self.addEventListener('load', onLoad);
      self.addEventListener('error', () => {
        try { callback({ type: 'xhr', url: self.__mt_info?.url, method: self.__mt_info?.method, status: 0, statusText: 'Network Error', duration: Date.now() - startTime, request: { url: self.__mt_info?.url, method: self.__mt_info?.method, headers: self.__mt_info?.requestHeaders || null, body: self.__mt_info?.requestBody || null }, response: { headers: null, body: null } }); } catch (e) { /* ignore */ }
      });

      return originalSend.apply(this, args);
    };

    return () => {
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
      XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
    };
  },

  /**
   * 网络请求回调
   */
  onRequest(ctx, info) {
    this.requests.push({ ...info, timestamp: Date.now() });
    if (this.requests.length > 500) {
      this.requests = this.requests.slice(-500);
    }

    // 自动上报给服务端
    if (this.config.autoReport) {
      ctx.api.sendMessage({
        type: 'network_capture',
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
    }
  },

  // ============================================================
  // AI 命令处理
  // ============================================================

  /**
   * 处理来自服务端的 AI 命令
   */
  async handleServerMessage(ctx,message) {
    const { action, params, requestId } = message;
    let result;

    try {
      switch (action) {
        case 'click':
          result = await this.cmdClick(ctx, params);
          break;
        case 'swipe':
          result = await this.cmdSwipe(ctx, params);
          break;
        case 'getPageInfo':
          result = this.cmdGetPageInfo(params);
          break;
        case 'getRequests':
          result = this.cmdGetRequests(params);
          break;
        case 'findElement':
          result = this.cmdFindElement(params);
          break;
        case 'scrollTo':
          result = await this.cmdScrollTo(ctx, params);
          break;
        case 'wait':
          result = await this.cmdWait(params);
          break;
        default:
          result = { success: false, error: `未知动作: ${action}` };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // 响应 AI 命令
    ctx.api.sendMessage({
      type: 'ai_command_response',
      requestId,
      action,
      result
    });
  },

  /**
   * AI 命令：点击指定坐标
   * params: { x, y, button? }
   */
  async cmdClick(ctx, params) {
    const { x, y, button = 'left' } = params;
    await ctx.input.click(x, y, { button, delay: 50 });
    return { success: true, action: 'click', x, y };
  },

  /**
   * AI 命令：触摸滑动
   * params: { fromX, fromY, toX, toY, steps?, stepDelay? }
   */
  async cmdSwipe(ctx, params) {
    const { fromX, fromY, toX, toY, steps, stepDelay } = params;
    await ctx.input.swipe(fromX, fromY, toX, toY, { steps: steps || 15, stepDelay: stepDelay || 20 });
    return { success: true, action: 'swipe', from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
  },

  /**
   * AI 命令：获取页面信息
   * params: { detail? }
   */
  cmdGetPageInfo(params) {
    const detail = params?.detail || 'basic';

    const info = {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth
    };

    if (detail === 'full') {
      info.bodyText = document.body.innerText?.substring(0, 2000) || '';
      info.visibleElements = this.getVisibleElements();
      info.inputs = this.getInputElements();
      info.links = this.getLinks();
      info.headings = this.getHeadings();
    }

    return { success: true, pageInfo: info };
  },

  /**
   * AI 命令：获取已抓取的请求
   * params: { limit?, urlContains? }
   */
  cmdGetRequests(params) {
    const limit = params?.limit || 100;
    const urlContains = params?.urlContains || '';

    let filtered = this.requests;
    if (urlContains) {
      filtered = filtered.filter(r => r.url.includes(urlContains));
    }

    return {
      success: true,
      total: filtered.length,
      requests: filtered.slice(-limit)
    };
  },

  /**
   * AI 命令：查找页面元素
   * params: { selector?, text?, xpath? }
   */
  cmdFindElement(params) {
    const { selector, text, xpath } = params;

    let elements = [];

    if (selector) {
      try {
        elements = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        return { success: false, error: `无效选择器: ${selector}` };
      }
    } else if (xpath) {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
          elements.push(result.snapshotItem(i));
        }
      } catch (e) {
        return { success: false, error: `无效 XPath: ${xpath}` };
      }
    } else if (text) {
      elements = this.findElementsByText(text);
    }

    const results = elements.slice(0, 20).map(el => ({
      tag: el.tagName.toLowerCase(),
      text: el.innerText?.substring(0, 100) || '',
      rect: this.getElementRect(el),
      attributes: {
        id: el.id || null,
        className: el.className?.substring(0, 100) || null,
        href: el.href || null,
        src: el.src || null
      }
    }));

    return { success: true, count: elements.length, elements: results };
  },

  /**
   * AI 命令：滚动页面
   * params: { x?, y?, by? }
   */
  async cmdScrollTo(ctx, params) {
    const { x, y, by } = params;

    if (by) {
      // 相对滚动
      window.scrollBy({ top: by, left: 0, behavior: 'smooth' });
    } else if (x !== undefined && y !== undefined) {
      window.scrollTo({ top: y, left: x, behavior: 'smooth' });
    } else if (y !== undefined) {
      window.scrollTo({ top: y, behavior: 'smooth' });
    } else if (x !== undefined) {
      window.scrollTo({ left: x, behavior: 'smooth' });
    }

    await new Promise(r => setTimeout(r, 500));
    return { success: true, scrollY: window.scrollY, scrollX: window.scrollX };
  },

  /**
   * AI 命令：等待
   * params: { ms }
   */
  async cmdWait(params) {
    const ms = params?.ms || 1000;
    await new Promise(r => setTimeout(r, ms));
    return { success: true, waited: ms };
  },

  // ============================================================
  // 辅助方法
  // ============================================================

  startPeriodicReport() {
    const interval = this.config.captureInterval || 5000;
    this._reportTimer = setInterval(() => {
      if (this.requests.length > 0) {
        this._ctx.api.sendMessage({
          type: 'periodic_report',
          timestamp: Date.now(),
          count: this.requests.length,
          lastUrls: this.requests.slice(-10).map(r => ({ url: r.url, method: r.method, status: r.status }))
        });
      }
    }, interval);
  },

  getVisibleElements() {
    const els = document.querySelectorAll('div, span, a, button, p, h1, h2, h3, li');
    return Array.from(els)
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 5 && rect.height > 5 && rect.top < window.innerHeight;
      })
      .slice(0, 50)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        text: el.innerText?.substring(0, 80) || '',
        rect: this.getElementRect(el)
      }));
  },

  getInputElements() {
    return Array.from(document.querySelectorAll('input, textarea, select'))
      .slice(0, 30)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || 'text',
        placeholder: el.placeholder || '',
        value: el.value?.substring(0, 100) || '',
        rect: this.getElementRect(el),
        disabled: el.disabled
      }));
  },

  getLinks() {
    return Array.from(document.querySelectorAll('a'))
      .slice(0, 30)
      .map(el => ({
        text: el.innerText?.substring(0, 60) || '',
        href: el.href || '',
        rect: this.getElementRect(el)
      }));
  },

  getHeadings() {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .slice(0, 20)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        text: el.innerText?.substring(0, 100) || ''
      }));
  },

  getElementRect(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right)
    };
  },

  findElementsByText(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const results = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.toLowerCase().includes(text.toLowerCase())) {
        const el = node.parentElement;
        if (el && !results.includes(el)) results.push(el);
      }
    }
    return results;
  },

  // ============================================================
  // 销毁
  // ============================================================

  destroy() {
    console.log('[MeituanCrawler] 销毁');
    if (this.unwatchFetch) this.unwatchFetch();
    if (this.unwatchXHR) this.unwatchXHR();
    if (this._reportTimer) clearInterval(this._reportTimer);
    this.isRunning = false;
  }
};
