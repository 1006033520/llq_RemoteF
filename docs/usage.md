# RemoteF 使用指南

## 目录

- [快速开始](#快速开始)
- [服务端部署](#服务端部署)
- [客户端安装](#客户端安装)
- [插件管理](#插件管理)
- [管理界面](#管理界面)
- [常见问题](#常见问题)

---

## 快速开始

### 环境要求

- **Node.js**: >= 18.0.0
- **浏览器**: Chrome 88+ / Edge 88+ (支持 Manifest V3)

### 1. 启动服务端

```bash
cd remoteF/server
npm install
npm start
```

服务启动后显示：
```
╔═══════════════════════════════════════════════════╗
║              RemoteF Server Started             ║
╠═══════════════════════════════════════════════════╣
║  HTTP API:   http://localhost:3000              ║
║  WebSocket:  ws://localhost:3000/ws             ║
║  Admin UI:   http://localhost:3000/admin        ║
╚═══════════════════════════════════════════════════╝
```

### 2. 安装客户端扩展

1. 打开 Chrome/Edge，访问 `chrome://extensions/`
2. 启用右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `remoteF/extension/build` 目录

> ⚠️ 注意：需要先在 extension 目录执行 `npm run build`

### 3. 配置连接

1. 点击扩展图标，打开设置页面
2. 填写服务端地址（如 `http://localhost:3000`）
3. 填写客户端名称（可选，用于服务端识别）
4. 勾选「自动连接」
5. 点击「保存并连接」

### 4. 安装插件

方式一：通过扩展 popup
- 点击扩展图标
- 在插件列表中点击「安装」

方式二：通过管理界面
- 访问 `http://localhost:3000/admin`
- 选择客户端，点击「安装插件」

---

## 服务端部署

### 配置文件

环境变量或 `.env` 文件：

```bash
PORT=3000              # HTTP/WebSocket 端口
WS_PATH=/ws            # WebSocket 路径
PLUGINS_DIR=./plugins  # 插件目录
```

### 生产环境部署

```bash
# 使用 PM2 运行
npm install -g pm2
pm2 start server/src/index.js --name remotef

# 查看状态
pm2 status

# 查看日志
pm2 logs remotef

# 重启
pm2 restart remotef
```

### Nginx 反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 客户端安装

### 构建扩展

```bash
cd remoteF/extension
npm install
npm run build    # 输出到 build/
# 或
npm run watch    # 监听模式
```

### 手动加载

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/build` 目录

### 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 存储配置和插件数据 |
| `activeTab` | 获取当前标签页信息 |
| `tabs` | 管理标签页 |
| `scripting` | 执行内容脚本 |
| `webNavigation` | 监听页面导航 |

---

## 插件管理

### 安装插件

```bash
# 1. 创建插件目录
mkdir server/plugins/my-plugin

# 2. 创建插件清单
cat > server/plugins/my-plugin/manifest.json << EOF
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
EOF

# 3. 重启服务端（插件自动加载）
```

### 卸载插件

```bash
# 删除插件目录
rm -rf server/plugins/my-plugin
```

### 更新插件

1. 修改插件文件
2. 重启服务端
3. 客户端会自动检测到新版本并提示更新

---

## 管理界面

访问 `http://localhost:3000/admin`

### 功能

- **客户端列表**：查看所有在线/离线客户端
- **插件列表**：查看已安装插件
- **远程安装**：向指定客户端推送插件
- **远程执行**：触发客户端运行指定插件

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/plugins` | GET | 获取插件列表 |
| `/api/clients` | GET | 获取客户端列表 |
| `/api/clients/:id/plugins` | POST | 向客户端推送插件 |
| `/api/clients/:id/plugins/:name/run` | POST | 触发客户端执行插件 |

---

## 常见问题

### Q: 扩展无法加载？

检查 `build/background.js` 是否存在，如不存在执行 `npm run build`。

### Q: WebSocket 连接失败？

1. 确认服务端已启动
2. 检查服务端地址是否正确
3. 检查浏览器控制台是否有跨域错误

### Q: 插件安装后不生效？

1. 检查插件 manifest.json 配置是否正确
2. 查看浏览器扩展页面的控制台日志
3. 尝试刷新页面或重新安装插件

### Q: 如何调试？

服务端：
```bash
DEBUG=* npm start
```

客户端：
- 打开扩展页面 → 点击「服务工作者」→ 打开控制台
- 或在 popup/options 页面右键 → 审查元素 → Console

---

## 下一步

- 查看 [设计文档](./design.md) 了解系统架构
- 查看 [流程文档](./flow.md) 了解通信流程
- 查看 [插件开发指南](../README.md#插件开发) 开发自定义插件
