# RemoteF 插件开发指南

> 本文档基于 RemoteF v1.7.0+，描述如何开发自定义插件。

---

## 目录

- [概述](#概述)
- [插件结构](#插件结构)
- [清单文件](#清单文件)
- [客户端插件开发](#客户端插件开发)
- [服务端插件开发](#服务端插件开发)
- [插件入口页](#插件入口页)
- [通信机制](#通信机制)
- [完整示例](#完整示例)
- [调试技巧](#调试技巧)

---

## 概述

RemoteF 插件由 **客户端模块** 和 **服务端模块** 两部分组成：

| 模块 | 运行环境 | 作用 |
|------|---------|------|
| 客户端插件 | 浏览器 MAIN 世界 | 在网页上下文中执行，可操作 DOM、拦截网络请求等 |
| 服务端插件 | Node.js 服务端 | 处理数据存储、消息分发、业务逻辑 |

**核心原则**：客户端插件和服务端插件只能与**同名**的对应端通信，`pluginName` 由系统自动绑定，插件代码无法指定或冒充其他插件。

---

## 插件结构

```
server/plugins/my-plugin/
├── manifest.json          # 主清单（定义插件元信息、服务端/客户端配置）
├── server.js              # 服务端模块（可选）
├── page.html              # 插件入口页（可选，在管理界面中展示）
├── assets/                # 入口页静态资源（可选）
│   └── ...
└── client/                # 客户端模块目录
    ├── manifest.json      # 客户端清单（定义版本、URL匹配、配置等）
    └── content.js         # 客户端入口代码
```

---

## 清单文件

### 主清单 manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "我的插件",
  "author": "作者名",
  "server": {
    "entry": "server.js",
    "page": "page.html"
  },
  "client": {
    "directory": "client",
    "entry": "content.js",
    "permissions": ["storage"]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件唯一标识，用于通信隔离 |
| `version` | string | ✅ | 语义化版本号，用于增量同步 |
| `description` | string | ❌ | 插件描述 |
| `author` | string | ❌ | 作者 |
| `server.entry` | string | ❌ | 服务端入口文件 |
| `server.page` | string | ❌ | 插件入口页 HTML 文件 |
| `client.directory` | string | ❌ | 客户端代码目录，默认 `client` |
| `client.entry` | string | ❌ | 客户端入口 JS 文件名，默认 `content.js` |
| `client.permissions` | string[] | ❌ | 客户端所需权限 |

### 客户端清单 client/manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "我的插件客户端模块",
  "permissions": ["storage"],
  "matches": ["*://*.example.com/*"],
  "config": {
    "enabled": true,
    "autoReport": false
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件名，须与主清单一致 |
| `version` | string | ✅ | 版本号，须与主清单一致 |
| `description` | string | ❌ | 客户端模块描述 |
| `permissions` | string[] | ❌ | 所需权限 |
| `matches` | string[] | ❌ | **URL 匹配模式**，控制插件在哪些网站生效 |
| `config` | object | ❌ | 插件默认配置，会作为 `plugin.config` 传入 `run()` |

#### matches — URL 匹配配置

采用 Chrome 标准 [match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) 格式：

| 配置 | 效果 |
|------|------|
| 不配置 / `null` / `[]` | **所有网站生效**（默认） |
| `["<all_urls>"]` | 所有网站生效 |
| `["*://*.example.com/*"]` | 只在 example.com 及其子域 |
| `["http://localhost:8888/*"]` | 只在 localhost:8888 |
| `["https://api.example.com/*", "https://web.example.com/*"]` | 多个模式，任一匹配即生效 |

格式规则：`<scheme>://<host>/<path>`

- **scheme**: `*`（http+https）、`http`、`https`
- **host**: `*`（所有）、`*.domain`（域名及子域）、`domain:port`（含端口）
- **path**: 支持 `*` 通配符

---

## 客户端插件开发

### 基本模板

```javascript
module.exports = {
  // 插件配置（与客户端 manifest.config 合并）
  config: {
    enabled: true
  },

  /**
   * 初始化（在 run 之前调用）
   * @param {object} ctx - 插件上下文
   */
  init(ctx) {
    // 监听服务端消息
    ctx.onMessage((message) => {
      console.log('收到服务端消息:', message);
    });

    // 发送消息给同名服务端插件
    ctx.api.sendMessage({
      type: 'client_ready',
      url: window.location.href
    });
  },

  /**
   * 运行插件
   * @param {object} ctx - 插件上下文
   * @param {object} config - 合并后的配置
   */
  async run(ctx, config) {
    // 主要业务逻辑
    console.log('插件运行，配置:', config);
  },

  /**
   * 销毁（可选）
   */
  destroy() {
    // 清理定时器、事件监听、DOM 元素等
  }
};
```

> **重要**：使用 `module.exports =` 或 `export default` 导出插件对象，系统会自动转换为可执行格式。

### 客户端 ctx 上下文

客户端插件在浏览器 **MAIN 世界**执行，`ctx` 对象提供以下能力：

```
ctx
├── pluginName           // 插件名（只读，系统注入）
├── sendMessage(msg)     // 发送消息给同名服务端插件（快捷方法）
├── onMessage(callback)  // 监听来自同名服务端插件的消息
├── api                  // 插件 API 层
│   ├── sendMessage(msg)              // 发送消息给同名服务端插件
│   ├── getConnectionStatus()         // 获取连接状态 → Promise
│   ├── getClientId()                 // 获取客户端 ID → Promise
│   ├── getInstalledPlugins()         // 获取已安装插件列表 → Promise
│   ├── getStorage(key)               // 获取插件存储 → Promise
│   ├── setStorage(key, value)        // 设置插件存储 → Promise
│   └── removeStorage(key)            // 删除插件存储 → Promise
└── utils                // DOM 工具
    ├── injectStyle(css)              // 注入 CSS 样式
    └── injectScript(code)            // 注入 JS 脚本
```

#### ctx.api 方法详解

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `sendMessage(message)` | `void` | 发送消息给同名服务端插件，pluginName 自动绑定 |
| `getConnectionStatus()` | `Promise<{connected, clientId, serverUrl}>` | 获取 WebSocket 连接状态 |
| `getClientId()` | `Promise<string>` | 获取客户端唯一 ID |
| `getInstalledPlugins()` | `Promise<Array>` | 获取已安装插件列表 |
| `getStorage(key)` | `Promise<any>` | 获取插件存储数据 |
| `setStorage(key, value)` | `Promise<void>` | 设置插件存储数据 |
| `removeStorage(key)` | `Promise<void>` | 删除插件存储数据 |

#### ctx.utils 方法详解

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `injectStyle(css)` | `HTMLStyleElement` | 在页面注入 CSS，id 为 `remotef-{pluginName}-style` |
| `injectScript(code)` | `HTMLScriptElement` | 在页面注入 JS 脚本 |

### 客户端插件注意事项

1. **MAIN 世界执行**：插件代码运行在页面的主上下文中，可以直接访问 `window`、`document` 等全局对象，也可以拦截 `fetch`/`XHR` 等原生 API
2. **通信桥接**：MAIN 世界无法直接调用 Chrome API，所有需要扩展能力的操作（如存储、连接状态）必须通过 `ctx.api` 走消息桥接
3. **SPA 导航**：系统监听 `pushState`/`replaceState`/`popstate`，页面导航时会根据 `matches` 配置重新加载插件
4. **生命周期**：`init()` → `run()`，每次页面加载或 SPA 导航时重新执行

---

## 服务端插件开发

### 基本模板

```javascript
export default {
  manifest: {
    name: 'my-plugin',
    version: '1.0.0',
    description: '我的插件'
  },

  /**
   * 注册自定义 API 路由（可选）
   * 在服务端启动后由 PluginManager 自动调用
   * @param {Express} app - Express 应用实例
   * @param {PluginManager} pluginManager - 插件管理器
   */
  setupRoutes(app, pluginManager) {
    app.get('/api/plugins/my-plugin/stats', (req, res) => {
      res.json({ count: this.requestCount });
    });

    app.post('/api/plugins/my-plugin/action', (req, res) => {
      // 处理请求...
      res.json({ success: true });
    });
  },

  /**
   * 插件启动
   */
  async onStart(ctx) {
    console.log('插件已启动');
  },

  /**
   * 客户端连接/断开事件
   */
  async onClientEvent(ctx, event, clientId) {
    if (event === 'connect') {
      console.log('客户端连接:', clientId);
    } else if (event === 'disconnect') {
      console.log('客户端断开:', clientId);
    }
  },

  /**
   * 客户端启用插件
   */
  async onEnable(ctx) {
    console.log('客户端启用插件:', ctx.clientId);
  },

  /**
   * 处理来自同名客户端插件的消息
   */
  async onMessage(ctx, message) {
    const msg = message?.message || message;
    // 根据 msg.type 处理不同消息
  },

  /**
   * 插件停止（卸载时调用）
   */
  async onStop(ctx) {
    // 清理资源
  }
};
```

> **注意**：服务端插件使用 ES Module 格式（`export default`），因为服务端通过 `import()` 动态加载。

### 服务端 ctx 上下文

```
ctx
├── clientId          // 当前客户端 ID
├── ws                // WebSocket 连接
├── pluginName        // 当前插件名（只读，系统注入）
├── api               // 服务端 API 层
│   ├── sendToClient(clientId, message)   // 发送消息给指定客户端的同名插件
│   ├── broadcast(message, filter?)       // 广播给所有在线客户端的同名插件
│   ├── broadcastToPluginClients(message) // 广播给安装了本插件的客户端
│   ├── getClients()                      // 获取所有在线客户端
│   ├── getClientInfo(clientId)           // 获取指定客户端信息
│   ├── isClientOnline(clientId)          // 检查客户端是否在线
│   ├── getConnectionStatus()             // 获取服务端连接状态
│   ├── getStorage(key)                   // 获取插件存储
│   ├── setStorage(key, value)            // 设置插件存储
│   ├── removeStorage(key)                // 删除插件存储
│   └── getStore()                        // 获取整个存储对象
├── server            // 旧接口（兼容）
│   ├── send(clientId, type, payload)
│   └── broadcast(type, payload, filter?)
└── plugin            // 插件管理
    ├── list()
    ├── get(name)
    ├── getClientModule(name)
    ├── enable(name, clientId)
    └── disable(name, clientId)
```

#### ctx.api 方法详解

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `sendToClient` | `clientId, message` | `boolean` | 发送消息给指定客户端的同名插件 |
| `broadcast` | `message, filter?` | `void` | 广播给所有在线客户端的同名插件，filter: `(ws, clientId) => boolean` |
| `broadcastToPluginClients` | `message` | `void` | 只广播给安装了本插件的在线客户端 |
| `getClients` | - | `Array` | 获取所有在线客户端列表 |
| `getClientInfo` | `clientId` | `object|null` | 获取指定客户端信息 |
| `isClientOnline` | `clientId` | `boolean` | 检查客户端是否在线 |
| `getConnectionStatus` | - | `object` | `{ onlineClients, totalClients, totalPlugins, uptime }` |
| `getStorage` | `key` | `any` | 获取插件存储数据 |
| `setStorage` | `key, value` | `void` | 设置插件存储数据 |
| `removeStorage` | `key` | `void` | 删除插件存储数据 |
| `getStore` | - | `object` | 获取整个存储对象 |

> **重要**：`ctx.api` 中的所有方法都不需要传 `pluginName`，系统在 `createContext` 时通过闭包自动绑定当前插件名。

---

## 插件入口页

插件可以配置入口页，在管理界面中点击插件名即可进入。

### 配置

在主清单中添加 `server.page`：

```json
{
  "server": {
    "entry": "server.js",
    "page": "page.html"
  }
}
```

### 系统路由

配置 `page` 后，系统自动提供以下路由：

| 路由 | 说明 |
|------|------|
| `/admin/plugin/:name` | 入口页 HTML |
| `/admin/plugin/:name/data` | 插件数据 API（返回插件信息、客户端列表等） |
| `/admin/plugin/:name/assets/*` | 静态资源（从插件目录的 `assets/` 读取） |

### 入口页数据 API

`GET /admin/plugin/:name/data` 返回：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "描述",
  "status": "loaded",
  "enabledClients": ["client-id-1"],
  "onlineClients": [
    { "clientId": "xxx", "name": "Client-1", "platform": "chrome" }
  ]
}
```

### 自定义 API 路由

通过 `setupRoutes(app, pluginManager)` 注册自定义路由：

```javascript
setupRoutes(app, pluginManager) {
  // 自定义数据 API
  app.get('/api/plugins/my-plugin/stats', (req, res) => {
    res.json({ count: this.data.length });
  });

  // 通过 pluginManager 的 serverApi 发送消息给客户端
  app.post('/api/plugins/my-plugin/send', (req, res) => {
    const { clientId, message } = req.body;
    pluginManager.serverApi.sendToClient(clientId, this.manifest.name, message);
    res.json({ success: true });
  });
}
```

---

## 通信机制

### 消息链路

```
客户端插件 (MAIN 世界)
    │ ctx.api.sendMessage(msg)
    ▼
window.postMessage
    │ source: 'remotef-main'
    ▼
Content Script (plugin-runtime.js, ISOLATED 世界)
    │ chrome.runtime.sendMessage
    ▼
Background Script (service worker)
    │ wsClient.send({ type: 'plugin_message', payload })
    ▼
WebSocket
    │
    ▼
服务端
    │ pluginManager.handlePluginMessage()
    ▼
服务端插件 serverModule.onMessage(ctx, message)
```

```
服务端插件 ctx.api.sendToClient(clientId, msg)
    │
    ▼
WebSocket → Background → Content Script → window.postMessage
    │
    ▼
客户端插件 ctx.onMessage(callback) 收到消息
```

### 隔离原则

- 插件 **只能** 与同名的服务端/客户端插件通信
- `pluginName` 由系统在创建上下文时自动注入，插件代码无法指定
- 客户端 `ctx.api.sendMessage(message)` 无需传 pluginName
- 服务端 `ctx.api.sendToClient(clientId, message)` 无需传 pluginName

---

## 完整示例

以下是一个最简插件示例，客户端发送页面 URL 给服务端，服务端回复确认：

### 主清单 manifest.json

```json
{
  "name": "hello",
  "version": "1.0.0",
  "description": "Hello 示例插件",
  "author": "RemoteF",
  "server": {
    "entry": "server.js"
  },
  "client": {
    "directory": "client",
    "entry": "content.js"
  }
}
```

### 客户端清单 client/manifest.json

```json
{
  "name": "hello",
  "version": "1.0.0",
  "description": "Hello 客户端模块",
  "matches": ["*://*.example.com/*"]
}
```

### 客户端代码 client/content.js

```javascript
module.exports = {
  init(ctx) {
    // 监听服务端消息
    ctx.onMessage((message) => {
      if (message.type === 'ack') {
        console.log('[Hello] 服务端确认:', message.text);
      }
    });

    // 通知服务端
    ctx.api.sendMessage({
      type: 'page_ready',
      url: window.location.href
    });
  },

  run(ctx) {
    // 在页面右下角显示标记
    ctx.utils.injectStyle(`
      #remotef-hello-badge {
        position: fixed; bottom: 10px; right: 10px;
        background: #3b82f6; color: white; padding: 4px 12px;
        border-radius: 9999px; font-size: 12px; z-index: 999999;
      }
    `);
    const badge = document.createElement('div');
    badge.id = 'remotef-hello-badge';
    badge.textContent = '🔌 RemoteF Hello';
    document.body.appendChild(badge);
  }
};
```

### 服务端代码 server.js

```javascript
export default {
  manifest: {
    name: 'hello',
    version: '1.0.0'
  },

  async onMessage(ctx, message) {
    const msg = message?.message || message;

    if (msg.type === 'page_ready') {
      console.log(`[Hello] 客户端 ${ctx.clientId} 就绪: ${msg.url}`);

      // 回复确认
      ctx.api.sendToClient(ctx.clientId, {
        type: 'ack',
        text: `已收到: ${msg.url}`
      });
    }
  }
};
```

---

## 调试技巧

### 客户端调试

1. **打开 DevTools**：在目标网页上按 F12
2. **查看控制台**：插件日志以 `[Example Plugin]` 等前缀显示
3. **查看注入状态**：在控制台输入 `window.__remotef_plugins` 查看已加载插件
4. **Background 日志**：在 `chrome://extensions/` 点击「Service Worker」链接

### 服务端调试

1. **查看服务端日志**：控制台会输出插件加载、消息处理等日志
2. **管理界面**：访问 `http://localhost:3000/admin` 查看客户端和插件状态
3. **入口页 API**：直接访问 `/admin/plugin/:name/data` 查看插件数据

### 常见问题

| 问题 | 原因 | 解决方式 |
|------|------|---------|
| 插件不执行 | URL 不匹配 `matches` | 检查客户端 manifest 的 `matches` 配置 |
| 消息收不到 | 插件名不一致 | 确保主清单和客户端清单的 `name` 相同 |
| CSP 报错 | 代码在 ISOLATED 世界执行 | 系统使用 `world: 'MAIN'` 绕过 CSP，确保走 `execute_plugin` 路径 |
| `module.exports` 未定义 | 客户端代码使用 ES Module | 使用 `module.exports =` 或 `export default`，系统会自动转换 |
| 端口匹配失败 | `matches` 中的端口未匹配 | 使用 `host:port` 格式，如 `http://localhost:8888/*` |
| 版本不同步 | 清单版本号不一致 | 确保主清单、客户端清单、服务端代码中的版本号三处一致 |

---

## 版本更新检查清单

每次修改插件后，请确保更新以下位置的版本号：

1. ✅ `server/plugins/{name}/manifest.json` — `version`
2. ✅ `server/plugins/{name}/client/manifest.json` — `version`
3. ✅ `server/plugins/{name}/server.js` — `manifest.version`

版本号变化后，客户端会自动检测并重新安装插件。
