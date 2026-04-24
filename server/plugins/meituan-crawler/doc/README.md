# meituan-crawler 插件文档

## 概述

美团数据抓取插件，集成网络请求监控、页面操作、AI 远程控制三大能力于一体。

**核心功能**：
1. 抓取页面发出的所有接口请求（fetch + XHR）
2. 模拟真人触摸滑动、点击事件（`isTrusted: true`）
3. 获取页面信息（DOM、可视区域、元素坐标）
4. 接收 AI 命令并执行对应操作
5. 向服务端上报抓取数据

---

## 安装与配置

### URL 匹配

客户端 `matches` 配置生效范围：

| 匹配规则 | 说明 |
|---------|------|
| `https://cactivityapi-sc.waimai.meituan.com/*` | 美团活动接口域名 |
| `http://localhost:8888/*` | 本地测试 |

### 插件配置（client/manifest.json）

```json
{
  "config": {
    "enabled": true,           // 是否启用
    "autoReport": true,        // 自动上报抓取数据
    "captureInterval": 5000    // 定期上报间隔（毫秒）
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|-------|------|--------|------|
| `enabled` | boolean | `true` | 插件总开关 |
| `autoReport` | boolean | `true` | 是否自动上报抓取的接口数据 |
| `captureInterval` | number | `5000` | 定期上报间隔（毫秒），0 则不上报 |

---

## 客户端 API（AI 命令）

插件在 `onMessage` 中接收 AI 命令，命令格式：

```json
{
  "action": "click",
  "params": { "x": 100, "y": 200 },
  "requestId": "ai_xxx"
}
```

### 支持的 AI 命令

#### click — 点击坐标

```json
{ "action": "click", "params": { "x": 100, "y": 200, "button": "left" } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `x` | number | ✅ | 点击 X 坐标 |
| `y` | number | ✅ | 点击 Y 坐标 |
| `button` | string | ❌ | 鼠标按钮，`left`（默认）/ `middle` / `right` |

---

#### swipe — 触摸滑动

```json
{ "action": "swipe", "params": { "fromX": 200, "fromY": 600, "toX": 200, "toY": 100 } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fromX` | number | ✅ | 起始 X 坐标 |
| `fromY` | number | ✅ | 起始 Y 坐标 |
| `toX` | number | ✅ | 终点 X 坐标 |
| `toY` | number | ✅ | 终点 Y 坐标 |
| `steps` | number | ❌ | 插值步数，默认 15 |
| `stepDelay` | number | ❌ | 每步延迟（毫秒），默认 20 |

---

#### getPageInfo — 获取页面信息

```json
{ "action": "getPageInfo", "params": { "detail": "basic" } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `detail` | string | ❌ | `basic`（默认，仅基本信息）/ `full`（包含元素信息） |

**返回值**（`detail: "basic"`）：

```json
{
  "success": true,
  "pageInfo": {
    "url": "https://...",
    "title": "页面标题",
    "readyState": "complete",
    "scrollHeight": 2000,
    "scrollWidth": 375,
    "scrollY": 0,
    "scrollX": 0,
    "innerHeight": 812,
    "innerWidth": 375
  }
}
```

**返回值**（`detail: "full"`，额外包含）：

```json
{
  "bodyText": "页面文本内容（前2000字符）",
  "visibleElements": [{ "tag": "div", "text": "文本", "rect": { "x": 0, "y": 100, "width": 375, "height": 44 } }],
  "inputs": [{ "tag": "input", "type": "text", "placeholder": "搜索", "rect": {...}, "disabled": false }],
  "links": [{ "text": "链接文本", "href": "https://...", "rect": {...} }],
  "headings": [{ "tag": "h1", "text": "标题文本" }]
}
```

---

#### getRequests — 获取已抓取的请求

```json
{ "action": "getRequests", "params": { "limit": 100, "urlContains": "product" } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `limit` | number | ❌ | 返回数量上限，默认 100 |
| `urlContains` | string | ❌ | 过滤 URL 包含的字符串 |

---

#### findElement — 查找页面元素

```json
{ "action": "findElement", "params": { "selector": ".product-item" } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `selector` | string | ❌ | CSS 选择器 |
| `xpath` | string | ❌ | XPath 表达式 |
| `text` | string | ❌ | 文本包含（不区分大小写） |

三选一，最多返回 20 个元素。返回每个元素的：

```json
{
  "tag": "div",
  "text": "元素文本（前100字符）",
  "rect": { "x": 0, "y": 100, "width": 375, "height": 44, "top": 100, "bottom": 144, "left": 0, "right": 375 },
  "attributes": {
    "id": "item-1",
    "className": "product-item",
    "href": "https://...",
    "src": null
  }
}
```

---

#### scrollTo — 滚动页面

```json
{ "action": "scrollTo", "params": { "by": -300 } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `x` | number | ❌ | 绝对 X 坐标 |
| `y` | number | ❌ | 绝对 Y 坐标 |
| `by` | number | ❌ | 相对滚动量（负数向上，正数向下） |

三选一，优先级：`by` > `x+y` > `y`。

---

#### wait — 等待

```json
{ "action": "wait", "params": { "ms": 2000 } }
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ms` | number | ❌ | 等待毫秒数，默认 1000 |

---

### AI 命令响应

客户端执行完命令后自动响应：

```json
{
  "type": "ai_command_response",
  "requestId": "ai_xxx",
  "action": "click",
  "result": { "success": true, "action": "click", "x": 100, "y": 200 }
}
```

---

## 服务端 API

插件服务端提供以下 HTTP 接口，全部挂载在 `/admin/plugin/meituan-crawler/` 下。

### 数据查询

#### GET /admin/plugin/meituan-crawler/captures

获取最近抓取记录。

**Query 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 返回数量上限，默认 50 |
| `url` | string | 过滤 URL 包含的字符串 |

**响应**：

```json
{
  "total": 120,
  "captures": [
    { "url": "https://...", "method": "GET", "status": 200, "timestamp": 1712345678000 },
    ...
  ]
}
```

---

#### GET /admin/plugin/meituan-crawler/stats

获取抓取统计。

**响应**：

```json
{
  "total": 120,
  "clients": 2,
  "byMethod": { "GET": 80, "POST": 40 },
  "byStatus": { "200-299": 100, "400-499": 20 },
  "recentClients": [
    {
      "clientId": "xxx",
      "url": "https://...",
      "lastSeen": 1712345678000,
      "captureCount": 60
    }
  ]
}
```

---

#### GET /admin/plugin/meituan-crawler/clients

获取在线客户端列表。

**响应**：

```json
{
  "total": 2,
  "clients": ["client-id-1", "client-id-2"]
}
```

---

### AI 命令通道

#### POST /admin/plugin/meituan-crawler/command

向指定客户端发送命令（异步，无需等待响应）。

**Body**：

```json
{
  "clientId": "xxx",
  "action": "click",
  "params": { "x": 100, "y": 200 }
}
```

**响应**：

```json
{ "success": true, "requestId": "ai_xxx", "clientId": "xxx", "action": "click" }
```

---

#### POST /admin/plugin/meituan-crawler/command-sync

向指定客户端发送命令并等待响应（同步，最长 60 秒）。

**Body**：

```json
{
  "clientId": "xxx",
  "action": "getPageInfo",
  "params": { "detail": "full" },
  "timeout": 30000
}
```

**响应**：

```json
{
  "success": true,
  "requestId": "ai_xxx",
  "clientId": "xxx",
  "action": "getPageInfo",
  "response": {
    "success": true,
    "pageInfo": { ... }
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clientId` | string | ✅ | 目标客户端 ID |
| `action` | string | ✅ | 命令类型 |
| `params` | object | ❌ | 命令参数 |
| `timeout` | number | ❌ | 等待超时（毫秒），默认 30000，最大 60000 |

---

#### POST /admin/plugin/meituan-crawler/broadcast

向所有安装本插件的客户端广播命令。

**Body**：

```json
{
  "action": "scrollTo",
  "params": { "by": -300 }
}
```

**响应**：

```json
{ "success": true, "action": "scrollTo", "requestId": "ai_bc_xxx" }
```

---

## 数据上报格式

客户端自动上报的接口数据格式：

```json
{
  "type": "network_capture",
  "url": "https://cactivityapi-sc.waimai.meituan.com/...",
  "method": "POST",
  "status": 200,
  "statusText": "OK",
  "duration": 125,
  "requestType": "fetch",
  "timestamp": 1712345678000,
  "request": {
    "url": "https://...",
    "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "body": { "key": "value" }
  },
  "response": {
    "headers": { "Content-Type": "application/json" },
    "body": { "code": 0, "data": {...} }
  }
}
```

---

## 文件结构

```
meituan-crawler/
├── manifest.json              # 主清单
├── server.js                 # 服务端模块
├── page.html                 # 插件入口页（可选）
└── client/
    ├── manifest.json          # 客户端清单
    └── content.js            # 客户端模块
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.2 | 2026-04-24 | 新增 localhost:8888 matches；升级 onMessage 方法 |
| 1.0.0 | 2026-04-24 | 初始版本 |
