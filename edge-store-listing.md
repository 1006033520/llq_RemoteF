# RemoteF Edge 扩展商店提交包

> 本文档包含提交 Edge 加载项（Microsoft Edge Add-ons）所需的全部内容。

---

## 1. 扩展基本信息

| 字段 | 内容 |
|------|------|
| **名称** | RemoteF Client |
| **类型** | 浏览器扩展（Browser Extension） |
| **版本** | 1.0.0 |
| **价格** | 免费 |
| **分类** | 开发者工具（Developer Tools） |
| **隐私声明** | 此扩展收集用户 IP 和客户端 ID 用于 WebSocket 连接，无其他数据收集行为。 |

---

## 2. 徽标

已在 `extension/icons/` 目录中准备好以下徽标：

- `icon-128.png` — 商店主展示图（128×128）
- `icon-48.png` — 扩展管理页（48×48）
- `icon-32.png` — 工具栏图标（32×32）
- `icon-16.png` — 小图标（16×16）
- `Modern_browser_extension_icon__2026-04-23T17-07-41.png` — 原始设计稿

> 如需重新生成，执行：`cd extension/icons && .\resize-icons.ps1`

---

## 3. 商店展示说明

### 简短说明（Short Description，≤ 45 字符）

```
RemoteF - 远程插件分发与自动化控制
```

### 完整说明（Long Description）

```
# RemoteF Client

RemoteF 是一个**远程插件分发系统**，通过浏览器扩展接收并运行服务端下发的插件，实现插件的集中管理和远程自动化控制。

## 核心功能

**远程插件分发** - 服务端统一管理插件，客户端自动同步，支持热更新，无需手动操作即可推送新插件到所有客户端。

**实时双向通信** - 基于 WebSocket 的长连接，支持服务端向客户端实时推送消息、数据和指令，毫秒级响应。

**系统级输入模拟** - 通过 Chrome DevTools Protocol（CDP）派发 `isTrusted: true` 的鼠标、键盘、触摸事件，网页和防刷机制无法区分与真人操作的区别。

**插件隔离运行** - 客户端插件在浏览器 MAIN 世界运行，直接操作 DOM，可拦截网络请求（fetch/XHR）；服务端插件运行于 Node.js，负责数据存储与消息分发。

**灵活的 URL 匹配** - 支持 Chrome Match Patterns，可将插件精准投放到特定域名或页面，无需全站生效。

## 工作原理

```
服务端（Node.js）
    ├─ 插件管理 / 数据存储 / HTTP API
    └─ WebSocket 服务器
              │
              ▼
客户端（Chrome/Edge 扩展）
    ├─ WebSocket 客户端（自动重连）
    ├─ 插件运行环境（MAIN 世界）
    └─ CDP 输入模拟层
```

## 应用场景

- 自动化测试与脚本录制回放
- 浏览器端 RPA（机器人流程自动化）
- 防爬虫/反自动化机制绕过研究
- 远程批量管理浏览器客户端
- 需要模拟真人操作的可信自动化任务

## 技术规格

- 基于 Manifest V3 标准开发
- 无需"允许使用者脚本"开关即可在 MAIN 世界执行代码
- 服务端：Node.js + Express + ws
- 客户端：Chrome/Edge 扩展 + WebSocket + CDP

## 隐私说明

此扩展仅在用户主动配置并连接服务端后才会通信。服务端地址由用户自行填写，数据流向完全由用户控制。不收集、不上报任何用户浏览数据。

## 源代码

https://github.com/1006033520/llq_RemoteF

## 版本历史

### v1.0.0
- 初始版本
- 远程插件分发与 WebSocket 双向通信
- CDP 系统级输入事件模拟
- 插件隔离运行与 URL 匹配过滤
- 配套管理后台（Admin UI）
```

### 关键词（Tags）

```
RemoteF, 远程控制, 插件分发, 自动化, 浏览器扩展, WebSocket, CDP, 输入模拟,
RPA, 浏览器自动化, 防爬虫, 插件系统, 远程脚本, 插件管理
```

### 分类与标签

- **类别**: 开发者工具
- **标签**: 自动化, 开发者工具, WebSocket, 插件, 浏览器扩展

---

## 4. 隐私政策

此扩展的隐私政策可在以下地址获取（或直接嵌入）：

```
此扩展仅在您主动配置并连接至自有服务端后才会进行网络通信。
- 服务端地址由您自行填写
- 仅传输 WebSocket 连接所需的基本信息（IP、客户端 ID）
- 不收集、不上传任何浏览历史、表单数据或个人隐私信息
- 所有插件运行数据均保存在您的本地浏览器和服务端之间
- 如有疑问，请访问 https://github.com/1006033520/llq_RemoteF
```

> **注意**: 如需填写独立的隐私政策 URL，请将此文本托管至 GitHub Pages 或其他静态托管服务。

---

## 5. 截图建议

Edge 商店建议至少上传一张截图（推荐 1280×800 或 800×600）。

建议截图内容：

1. **RemoteF 管理后台概览** — 显示已连接客户端数量、插件列表
2. **插件运行状态** — 展示扩展 popup 中的连接状态和插件列表
3. **自定义插件示例** — 展示插件开发示例的运行效果

> 可使用 `server.js` 启动后访问 `http://localhost:3000/admin` 截图，或录制屏幕制作 GIF。

---

## 6. 提交前检查清单

### 必需项

- [ ] `manifest.json` 中的 `name` 符合 Edge 规范（无特殊字符，≤ 45 字符）
- [ ] `manifest.json` 中包含所有图标路径（16/32/48/128）
- [ ] 图标文件均已上传（PNG 格式，尺寸正确）
- [ ] 简短说明 ≤ 45 字符
- [ ] 完整说明已填写（可粘贴上方长描述）
- [ ] 隐私政策已提供（独立 URL 或直接填写文本）
- [ ] 至少一张截图（可选，但建议上传）
- [ ] manifest 中 `permissions` 不包含任何可疑权限
- [ ] 扩展已在 Edge 中测试运行正常（`edge://extensions/` 加载已解压扩展）

### 可选项

- [ ] 关键词标签（提升搜索可见性）
- [ ] 推广截图（展示核心功能界面）
- [ ] 视频演示链接

---

## 7. 提交步骤

1. 登录 [Microsoft Partner Center](https://partner.microsoft.com/)
2. 选择「Azure 门户」或直接访问 Edge 加载项提交页面
3. 选择「创建新提交」→「浏览器扩展」
4. 填写上述所有信息
5. 上传扩展包（`.zip`，包含 `manifest.json` 和所有资源）
6. 提交审核（通常 24-72 小时内完成审核）

### 打包扩展

在 `extension/` 目录下运行：

```bash
# 安装打包工具（如果需要）
npm install -g zip

# 打包（排除 node_modules/build 等）
cd extension
zip -r ../remoteF-edge.zip . -x "node_modules/*" -x "build/*" -x "*.zip" -x "icons/resize-icons.ps1" -x "icons/README.md"
```

> **重要**: 打包前请先执行 `npm run build`（如果构建脚本存在），确保 `build/` 目录包含最新编译代码，并将 `manifest.json` 和所有资源正确包含在 zip 包中。

---

## 8. 相关链接

- **GitHub 项目地址**: https://github.com/1006033520/llq_RemoteF
- **Edge 扩展提交指南**: https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/publish-extension
- **Microsoft Partner Center**: https://partner.microsoft.com/
- **RemoteF 使用文档**: `docs/usage.md`
- **RemoteF 插件开发指南**: `docs/plugin-development.md`
