# RemoteF 项目说明

> 远程插件分发系统 - 服务端集中管理，客户端扩展接收

## 项目简介

RemoteF 是一个**远程插件分发系统**，通过 Chrome 扩展接收并运行服务端下发的插件，实现插件的集中管理和远程控制。

### 核心能力

- 🌐 **远程分发**：服务端统一管理插件，客户端自动同步
- ⚡ **实时通信**：WebSocket 双向连接，支持实时消息
- 🔌 **热更新**：插件更新自动推送，无需手动更新扩展
- 🎯 **精准控制**：支持向指定客户端推送和执行插件

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         服务端 (Node.js)                    │
│                                                             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│   │ 插件管理    │   │ WS 服务     │   │ HTTP API        │  │
│   │ 安装/删除   │   │ 实时通信    │   │ 管理界面        │  │
│   └─────────────┘   └─────────────┘   └─────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    客户端 (Chrome Extension)                  │
│                                                             │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│   │ WS 客户端   │   │ 插件管理    │   │ 插件运行环境    │  │
│   │ 自动重连    │   │ 安装/运行   │   │ 沙箱隔离        │  │
│   └─────────────┘   └─────────────┘   └─────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
remoteF/
├── docs/                    # 文档目录
│   ├── usage.md            # 使用指南
│   ├── design.md           # 设计文档
│   └── flow.md             # 流程文档
│
├── server/                  # 服务端
│   ├── src/
│   │   ├── index.js        # 服务入口
│   │   ├── plugin-manager.js
│   │   ├── ws-server.js
│   │   └── api-server.js
│   ├── plugins/            # 插件目录
│   │   └── example/        # 示例插件
│   ├── package.json
│   └── ...
│
├── extension/               # Chrome 扩展
│   ├── src/                 # 源码
│   │   ├── background.js
│   │   ├── ws-client.js
│   │   ├── plugin-manager.js
│   │   ├── messenger.js
│   │   └── storage.js
│   ├── build/              # 构建输出
│   ├── package.json
│   ├── esbuild.config.js
│   └── ...
│
└── README.md
```

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 服务端 | Node.js, Express, ws |
| 客户端 | Chrome Extension (Manifest V3) |
| 构建 | esbuild |
| 通信 | WebSocket + HTTP |

---

## 快速开始

### 1. 启动服务端

```bash
cd server
npm install
npm start

# 服务地址:
# - HTTP API:  http://localhost:3000
# - WebSocket: ws://localhost:3000/ws
# - 管理界面:   http://localhost:3000/admin
```

### 2. 构建扩展

```bash
cd extension
npm install
npm run build

# 输出: build/
```

### 3. 安装扩展

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/build` 目录

### 4. 连接配置

1. 点击扩展图标 → 设置
2. 填写服务端地址：`http://localhost:3000`
3. 保存并连接

---

## 插件开发

### 插件结构

```
plugins/my-plugin/
├── manifest.json         # 插件清单
├── server.js             # 服务端模块（可选）
└── client/               # 客户端模块
    ├── manifest.json
    └── content.js
```

### 插件清单 (manifest.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "我的插件",
  "author": "作者名",
  "server": {
    "entry": "server.js"
  },
  "client": {
    "entry": "client/content.js",
    "permissions": ["storage"]
  }
}
```

### 服务端模块 (server.js)

```javascript
module.exports = {
  manifest: { name: 'my-plugin', version: '1.0.0' },

  async onInstall(ctx) {},
  async onStart(ctx) {},
  async onStop(ctx) {},
  async onMessage(ctx, message) {},

  routes: {
    'GET /api/data': async (ctx, req) => {}
  }
};
```

### 客户端模块 (client/content.js)

```javascript
module.exports = {
  manifest: { name: 'my-plugin', version: '1.0.0' },

  config: { enabled: true },

  init(ctx) {},
  async run(ctx) {},
  destroy() {},
  onMessage(message) {}
};
```

---

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/plugins` | GET | 获取插件列表 |
| `/api/clients` | GET | 获取客户端列表 |
| `/api/clients/:id/plugins` | POST | 向客户端推送插件 |
| `/api/clients/:id/plugins/:name/run` | POST | 触发客户端执行插件 |
| `/admin` | GET | 管理界面 |

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [使用指南](./docs/usage.md) | 部署、配置、常见问题 |
| [设计文档](./docs/design.md) | 架构设计、模块说明、数据模型 |
| [流程文档](./docs/flow.md) | 连接流程、通信时序、状态流转 |
| [插件开发指南](./docs/plugin-development.md) | 插件结构、清单配置、API 参考、完整示例 |

---

## License

MIT
