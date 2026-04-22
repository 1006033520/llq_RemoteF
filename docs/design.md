# RemoteF 设计文档

## 目录

- [系统概述](#系统概述)
- [架构设计](#架构设计)
- [核心模块](#核心模块)
- [数据模型](#数据模型)
- [扩展机制](#扩展机制)

---

## 系统概述

### 项目背景

RemoteF 是一个**远程插件分发系统**，旨在实现：
- 服务端集中管理插件
- 客户端通过扩展接收并运行插件
- 支持实时消息通信和远程控制

### 核心特性

| 特性 | 说明 |
|------|------|
| 实时通信 | WebSocket 双向连接 |
| 插件分发 | 服务端推送插件到客户端 |
| 远程执行 | 支持触发客户端运行插件 |
| 热更新 | 插件更新自动同步 |
| 沙箱隔离 | 客户端代码在受控环境运行 |

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                           服务端                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ PluginMgr   │  │  WS Server  │  │   HTTP API Server       │  │
│  │ - 安装/卸载  │  │ - 连接管理  │  │   - /admin 管理界面     │  │
│  │ - 状态跟踪  │  │ - 消息路由  │  │   - /api/* REST接口      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│         │                │                      │              │
│         └────────────────┼──────────────────────┘              │
│                          │                                     │
│                    WebSocket Server                            │
│                          │                                     │
└──────────────────────────┼─────────────────────────────────────┘
                           │ WebSocket / HTTP
┌──────────────────────────┼─────────────────────────────────────┐
│                          │                                     │
│  ┌─────────────┐  ┌─────┴──────┐  ┌─────────────────────────┐  │
│  │ WS Client   │  │ Messenger  │  │   Plugin Manager        │  │
│  │ - 重连机制  │  │ - 消息分发  │  │   - 安装/卸载/运行       │  │
│  │ - 心跳检测  │  │ - popup通信 │  │   - 状态管理             │  │
│  └─────────────┘  └────────────┘  └─────────────────────────┘  │
│                          │                                     │
│                    Chrome Extension                            │
└─────────────────────────────────────────────────────────────────┘
```

### 服务端架构

```
server/
├── src/
│   ├── index.js           # 入口，启动 HTTP + WebSocket
│   ├── plugin-manager.js  # 插件生命周期管理
│   ├── ws-server.js       # WebSocket 服务（已集成到 index.js）
│   └── api-server.js      # HTTP REST API
└── plugins/               # 插件存放目录
    └── [plugin-name]/
        ├── manifest.json      # 插件清单
        ├── server.js         # 服务端模块
        └── client/           # 客户端模块
            ├── manifest.json
            └── content.js
```

### 客户端架构

```
extension/
├── src/                       # 源码（模块化）
│   ├── background.js          # Service Worker 入口
│   ├── ws-client.js           # WebSocket 客户端
│   ├── plugin-manager.js      # 插件管理器
│   ├── messenger.js           # 消息通信
│   └── storage.js             # 存储封装
├── build/                     # 构建输出
│   ├── background.js          # 打包后的单文件
│   ├── manifest.json
│   └── ...
├── package.json
└── esbuild.config.js          # 构建配置
```

---

## 核心模块

### 1. PluginManager (服务端)

**职责**：管理插件的加载、安装、卸载

**核心接口**：

```javascript
class PluginManager {
  async loadAll()           // 加载所有插件
  list()                   // 获取插件列表
  get(name)                // 获取单个插件
  getClientModule(name)    // 获取客户端代码
  async onInstall(name)    // 安装钩子
  async onUninstall(name)  // 卸载钩子
}
```

**数据结构**：

```javascript
{
  name: 'plugin-name',           // 插件名称（唯一标识）
  version: '1.0.0',              // 版本号
  description: '描述',
  author: '作者',
  server: { entry: 'server.js' },
  client: { entry: 'client/content.js', permissions: [] },
  status: 'loaded' | 'error',
  loadedAt: timestamp
}
```

### 2. WSClient (客户端)

**职责**：管理 WebSocket 连接、自动重连、心跳

**核心接口**：

```javascript
class WSClient {
  async connect()          // 连接服务端
  disconnect()              // 断开连接
  send(message)            // 发送消息
  onMessage(type, handler) // 注册消息处理器
  on(event, handler)        // 注册事件监听器
  isConnected              // 连接状态
  clientId                  // 客户端ID
}
```

**重连策略**：

```javascript
// 非正常断开时，3秒后自动重连
ws.on('close', (event) => {
  if (!event.wasClean && event.code !== 1000) {
    setTimeout(() => this.connect(), 3000);
  }
});
```

### 3. PluginManager (客户端)

**职责**：管理本地插件的安装、运行、状态

**核心接口**：

```javascript
class ClientPluginManager {
  async install(name, module, sendFn)   // 安装插件
  async uninstall(name)                // 卸载插件
  async run(name, sendFn, config)      // 运行插件
  async stop(name)                     // 停止插件
  getAll()                             // 获取所有插件
  getStatus(name)                      // 获取状态
}
```

**插件状态机**：

```
  [none] ──install──> [installed] ──run──> [running]
     ^                       │                 │
     │                       │                 │
     └──uninstall─────────────┴──stop───────────┘
```

### 4. Messenger (客户端)

**职责**：处理 popup/options 与 background 的通信

**消息类型**：

```javascript
// API 消息（popup/options -> background）
'get_status'       // 获取状态
'get_plugins'      // 获取插件列表
'connect'          // 连接
'disconnect'       // 断开
'run_plugin'       // 运行插件
'stop_plugin'      // 停止插件
'install_plugin'   // 安装插件
'uninstall_plugin' // 卸载插件

// 推送消息（background -> popup）
'popup_update'              // 通用更新
'connection_changed'        // 连接状态变化
'plugin_status_changed'    // 插件状态变化
'plugin_installed'         // 插件已安装
'plugin_uninstalled'       // 插件已卸载
'plugin_error'             // 插件错误
```

---

## 数据模型

### 服务端存储

**客户端信息**（内存/可选数据库）：

```javascript
{
  clientId: 'uuid',
  ws: WebSocket,
  name: 'Client-xxx',
  platform: 'chrome-extension',
  isAlive: true,
  installedPlugins: ['plugin-a', 'plugin-b'],
  lastSeen: timestamp
}
```

**插件信息**（文件系统）：

```javascript
// plugins/[name]/manifest.json
{
  name: string,
  version: string,
  description: string,
  author: string,
  server: { entry: string, api?: string[] },
  client: { entry: string, permissions?: string[] }
}
```

### 客户端存储

**插件数据**（chrome.storage.local）：

```javascript
{
  'plugins': {
    '[plugin-name]': {
      manifest: { name, version, ... },
      module: string,          // 插件代码（字符串）
      status: 'installed' | 'running' | 'stopped',
      error?: string,
      installedAt: timestamp,
      lastRun?: timestamp
    }
  }
}
```

**配置数据**（chrome.storage.local）：

```javascript
{
  'config': {
    serverUrl: 'http://localhost:3000',
    clientName: 'My-Client',
    autoConnect: true,
    clientVersion: '1.0.0'
  }
}
```

---

## 扩展机制

### 插件生命周期

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   加载      │ ──> │   安装      │ ──> │   运行      │
│  loadAll   │     │  install    │     │   run       │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           v                   v
                    ┌─────────────┐     ┌─────────────┐
                    │   卸载      │     │   停止      │
                    │ uninstall  │     │   stop      │
                    └─────────────┘     └─────────────┘
```

### 服务端插件钩子

```javascript
// plugins/example/server.js
module.exports = {
  manifest: { name: 'example', version: '1.0.0' },

  async onInstall(ctx) {
    console.log('插件安装');
  },

  async onStart(ctx) {
    console.log('插件启动');
    // 定时任务、WebSocket 监听等
  },

  async onStop(ctx) {
    console.log('插件停止');
    // 清理资源
  },

  async onMessage(ctx, message) {
    // 处理来自客户端的消息
  },

  routes: {
    'GET /api/data': async (ctx, req) => {
      return { data: 'hello' };
    }
  }
};
```

### 客户端插件钩子

```javascript
// plugins/example/client/content.js
module.exports = {
  manifest: { name: 'example', version: '1.0.0' },

  config: {
    enabled: true,
    interval: 5000
  },

  init(ctx) {
    console.log('插件初始化');
  },

  async run(ctx) {
    console.log('插件执行');
    // 执行业务逻辑
  },

  destroy() {
    console.log('插件销毁');
    // 清理定时器、事件监听等
  },

  onMessage(message) {
    // 处理来自服务端的消息
  }
};
```

### 上下文对象

**服务端 ctx**：

```javascript
{
  pluginManager: PluginManager,    // 插件管理器实例
  clients: Map,                    // 所有客户端连接
  sendTo(clientId, type, payload) // 发送消息到客户端
}
```

**客户端 ctx**：

```javascript
{
  name: string,                   // 插件名称
  config: object,                 // 用户配置
  send: function                  // 发送消息到服务端
}
```

---

## 安全考虑

1. **代码隔离**：客户端插件在沙箱环境中运行
2. **权限控制**：插件只能请求必要的 Chrome 权限
3. **消息验证**：WebSocket 消息需要验证格式
4. **输入过滤**：插件输入需要严格校验

---

## 性能优化

1. **插件懒加载**：只在需要时加载插件
2. **消息压缩**：WebSocket 消息可考虑压缩
3. **连接复用**：多个插件共享同一 WebSocket 连接
4. **状态缓存**：常用数据缓存到内存
