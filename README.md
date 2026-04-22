# RemoteF - 远程插件分发系统

一个浏览器插件远程管理平台，支持服务端向客户端下发插件。

## 功能架构

```
┌─────────────────────────────────────────────────────────────┐
│                         服务端                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 插件管理    │  │ 客户端状态  │  │ WebSocket 服务      │  │
│  │ 安装/删除   │  │ 在线/离线   │  │ 实时通信             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                         WebSocket
                              │
┌─────────────────────────────────────────────────────────────┐
│                         客户端（浏览器扩展）                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 配置界面    │  │ 插件接收    │  │ 插件执行环境        │  │
│  │ 服务端地址  │  │ 接收/存储   │  │ 沙箱运行客户端代码  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
remoteF/
├── server/                    # 服务端
│   ├── src/
│   │   ├── index.js          # 服务入口
│   │   ├── plugin-manager.js # 插件管理
│   │   ├── ws-server.js      # WebSocket服务器
│   │   └── api-server.js     # HTTP API服务器
│   ├── plugins/              # 插件存放目录
│   │   └── example/          # 示例插件
│   │       ├── manifest.json
│   │       ├── server.js     # 服务端模块
│   │       └── client/       # 客户端模块
│   │           ├── manifest.json
│   │           └── content.js
│   └── package.json
│
├── extension/                 # 客户端浏览器扩展
│   ├── manifest.json
│   ├── background.js         # 后台脚本
│   ├── popup/                 # 弹窗界面
│   │   ├── popup.html
│   │   └── popup.js
│   ├── options/               # 配置页面
│   │   ├── options.html
│   │   └── options.js
│   └── content/               # 内容脚本
│       └── plugin-runtime.js # 插件运行时
│
└── README.md
```

## 通信协议

### WebSocket 消息格式

```json
{
  "type": "message_type",
  "payload": {},
  "timestamp": 1234567890,
  "clientId": "client_xxx"
}
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `register` | C→S | 客户端注册 |
| `client_status` | S→C | 推送客户端状态 |
| `plugin_list` | C→S | 请求插件列表 |
| `plugin_install` | C→S | 请求安装插件 |
| `plugin_push` | S→C | 服务端推送插件 |
| `plugin_run` | S→C | 触发客户端执行插件 |
| `plugin_result` | C→S | 插件执行结果 |

## 插件开发

### 插件结构

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者",
  "server": {
    "entry": "server.js",
    "api": ["api1", "api2"]
  },
  "client": {
    "entry": "client/content.js",
    "permissions": ["storage", "activeTab"]
  }
}
```

### 服务端模块 API

```javascript
// server.js
module.exports = {
  // 插件元信息
  manifest: {
    name: 'plugin-name',
    version: '1.0.0'
  },

  // 初始化（插件安装时调用）
  async onInstall(ctx) {},

  // 启动（插件启用时调用）
  async onStart(ctx) {},

  // 停止（插件停用时调用）
  async onStop(ctx) {},

  // 处理来自客户端的消息
  async onMessage(ctx, message) {},

  // HTTP路由处理
  routes: {
    'GET /api/data': async (ctx, req) => {}
  }
};
```

### 客户端模块 API

```javascript
// client/content.js
module.exports = {
  // 客户端模块元信息
  manifest: {
    name: 'plugin-name',
    version: '1.0.0'
  },

  // 插件配置（用户可在配置界面修改）
  config: {
    enabled: true,
    // 其他配置项...
  },

  // 初始化
  init(ctx) {},

  // 执行
  run(ctx) {},

  // 清理
  destroy() {},

  // 接收来自服务端的消息
  onMessage(message) {}
};
```

## 快速开始

### 1. 启动服务端

```bash
cd server
npm install
npm start
```

### 2. 安装客户端扩展

1. 打开 Chrome/Edge，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension` 目录

### 3. 配置客户端

1. 点击扩展图标，打开配置页面
2. 填写服务端地址（如 `http://localhost:3000`）
3. 保存并连接

### 4. 管理插件

服务端启动后，访问 `http://localhost:3000/admin` 进入管理界面。

## 技术栈

- **服务端**: Node.js, Express, ws (WebSocket)
- **客户端**: Chrome Extension (Manifest V3)
- **通信**: WebSocket + HTTP

---

## 项目文件结构

```
remoteF/
├── server/                          # 服务端
│   ├── src/
│   │   ├── index.js                # 入口文件
│   │   ├── plugin-manager.js       # 插件管理器
│   │   ├── ws-server.js           # WebSocket 服务器
│   │   └── api-server.js          # HTTP API 服务器
│   ├── plugins/                   # 插件目录
│   │   └── example/               # 示例插件
│   │       ├── manifest.json
│   │       ├── server.js
│   │       └── client/
│   │           ├── manifest.json
│   │           └── content.js
│   └── package.json
│
├── extension/                       # 浏览器扩展
│   ├── manifest.json
│   ├── background.js               # 后台脚本
│   ├── popup/                      # 弹窗
│   │   ├── popup.html
│   │   └── popup.js
│   ├── options/                    # 设置页
│   │   ├── options.html
│   │   └── options.js
│   └── content/                    # 内容脚本
│       └── plugin-runtime.js
│
└── README.md
```

---

## 添加图标（可选）

Chrome 扩展需要 PNG 图标。如需添加图标：

1. 创建以下尺寸的 PNG 图标：
   - `extension/icons/icon16.png` (16x16)
   - `extension/icons/icon48.png` (48x48)
   - `extension/icons/icon128.png` (128x128)

2. 更新 `extension/manifest.json`：
```json
{
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```
