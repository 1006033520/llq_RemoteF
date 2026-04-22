# RemoteF 流程文档

## 目录

- [连接流程](#连接流程)
- [插件安装流程](#插件安装流程)
- [插件运行流程](#插件运行流程)
- [消息通信流程](#消息通信流程)
- [时序图](#时序图)

---

## 连接流程

### 客户端连接

```
┌─────────┐                              ┌─────────┐
│  客户端  │                              │  服务端  │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. 用户点击"连接"或启用"自动连接"        │
     │────────────────────────────────────────>│
     │                                        │
     │  2. WebSocket 连接建立                   │
     │<────────────────────────────────────────│
     │                                        │
     │  3. 服务端发送 connected                 │
     │<────────────────────────────────────────│
     │                                        │
     │  4. 客户端发送 register                   │
     │────────────────────────────────────────>│
     │   {                                      │
     │     type: "register",                   │
     │     payload: { name, version, platform, │
     │                  extensions }            │
     │   }                                      │
     │────────────────────────────────────────>│
     │                                        │
     │  5. 服务端发送 registered                 │
     │<────────────────────────────────────────│
     │   { type: "registered",                 │
     │     payload: { success: true,           │
     │                plugins: [...] } }       │
     │                                        │
     │  6. 客户端请求 plugin_list               │
     │────────────────────────────────────────>│
     │   { type: "plugin_list" }               │
     │────────────────────────────────────────>│
     │                                        │
     │  7. 服务端发送 plugin_list               │
     │<────────────────────────────────────────│
     │   { type: "plugin_list",                │
     │     payload: { plugins: [...] } }       │
     │                                        │
     ▼                                        ▼
```

### 自动重连流程

```
客户端                      服务端
   │                          │
   │ ── WebSocket 连接 ──────> │ 连接正常
   │                          │
   │                    [服务端重启]
   │                          │
   │ <── 连接关闭 ──────────── │
   │   code: 1006             │
   │                          │
   │ 3秒后                     │
   │ ── 重连 ─────────────────> │
   │                          │
```

---

## 插件安装流程

### 方式一：客户端主动安装

```
┌─────────┐                              ┌─────────┐
│  客户端  │                              │  服务端  │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. 用户点击"安装"插件                  │
     │────────────────────────────────────────>│
     │   { type: "plugin_install",             │
     │     payload: { pluginName: "xxx" } }   │
     │────────────────────────────────────────>│
     │                                        │
     │  2. 服务端查找插件                      │
     │                                        │
     │  3. 服务端发送 plugin_push              │
     │<────────────────────────────────────────│
     │   { type: "plugin_push",                │
     │     payload: { pluginName, module } }  │
     │                                        │
     │  4. 客户端安装插件                      │
     │  5. 发送 plugin_install_result          │
     │────────────────────────────────────────>│
     │   { type: "plugin_install_result",     │
     │     payload: { pluginName, success } } │
     │                                        │
     ▼                                        ▼
```

### 方式二：服务端推送安装

```
┌─────────┐                              ┌─────────┐
│  客户端  │                              │  服务端  │
└────┬────┘                              └────┬────┘
     │                                        │
     │                         [管理员在 /admin 界面选择客户端安装插件]
     │                                        │
     │  1. 服务端发送 plugin_push              │
     │<────────────────────────────────────────│
     │   { type: "plugin_push",                │
     │     payload: { pluginName, module } }  │
     │                                        │
     │  2. 客户端安装插件                      │
     │  3. 发送 plugin_install_result         │
     │────────────────────────────────────────>│
     │   { type: "plugin_install_result",     │
     │     payload: { pluginName, success } } │
     │                                        │
     ▼                                        ▼
```

---

## 插件运行流程

### 客户端触发

```
┌─────────┐                              ┌─────────┐
│  客户端  │                              │  服务端  │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. 用户点击"运行"或定时触发             │
     │────────────────────────────────────────>│
     │   { type: "plugin_run_request",         │
     │     payload: { pluginName, config } }   │
     │────────────────────────────────────────>│
     │                                        │
     │  2. 服务端转发或处理                    │
     │  3. 返回 plugin_run_result             │
     │<────────────────────────────────────────│
     │   { type: "plugin_run_result",          │
     │     payload: { pluginName, success,    │
     │                result, error } }        │
     │                                        │
     ▼                                        ▼
```

### 服务端触发

```
┌─────────┐                              ┌─────────┐
│  客户端  │                              │  服务端  │
└────┬────┘                              └────┬────┘
     │                                        │
     │                         [管理员在 /admin 触发]
     │                                        │
     │  1. 服务端发送 plugin_run               │
     │<────────────────────────────────────────│
     │   { type: "plugin_run",                │
     │     payload: { pluginName, config } }  │
     │                                        │
     │  2. 客户端执行插件                      │
     │  3. 发送 plugin_run_result             │
     │────────────────────────────────────────>│
     │   { type: "plugin_run_result",          │
     │     payload: { pluginName, success,    │
     │                result, error } }        │
     │                                        │
     ▼                                        ▼
```

---

## 消息通信流程

### 消息格式

```javascript
// 所有消息统一格式
{
  type: string,      // 消息类型
  payload: any,      // 消息数据
  timestamp: number // 时间戳（服务端添加）
}
```

### 消息类型总览

| 类型 | 方向 | 说明 |
|------|------|------|
| `connected` | S→C | 连接成功 |
| `registered` | S→C | 注册成功 |
| `plugin_list` | 双向 | 插件列表请求/响应 |
| `plugin_install` | C→S | 安装请求 |
| `plugin_push` | S→C | 插件推送 |
| `plugin_install_result` | C→S | 安装结果 |
| `plugin_run` | S→C | 运行触发 |
| `plugin_run_request` | C→S | 运行请求 |
| `plugin_run_result` | 双向 | 运行结果 |
| `plugin_message` | 双向 | 插件间通信 |

---

## 时序图

### 完整连接与插件同步时序

```mermaid
sequenceDiagram
    participant C as 客户端扩展
    participant WS as WS服务端
    participant PM as PluginManager

    C->>WS: WebSocket连接
    WS-->>C: connected

    C->>WS: register(name, version, platform)
    WS->>PM: 获取插件列表
    PM-->>WS: plugins[]
    WS-->>C: registered(plugins)

    C->>WS: plugin_list 请求
    WS-->>C: plugin_list(plugins)

    Note over C: 遍历服务端插件列表
    C->>WS: plugin_install(plugin-a)
    C->>WS: plugin_install(plugin-b)

    WS->>PM: 获取 plugin-a 模块
    PM-->>WS: module
    WS-->>C: plugin_push(plugin-a, module)

    Note over C: 客户端安装插件
    C->>C: 保存到 storage
    C->>WS: plugin_install_result(plugin-a, success)

    WS->>PM: 获取 plugin-b 模块
    PM-->>WS: module
    WS-->>C: plugin_push(plugin-b, module)
    C->>WS: plugin_install_result(plugin-b, success)

    Note over C: 所有插件同步完成
```

### 插件运行完整时序

```mermaid
sequenceDiagram
    participant User as 用户/管理员
    participant UI as 扩展界面
    participant BG as Background
    participant WS as WS服务端
    participant Plugin as 插件模块

    User->>UI: 点击"运行"
    UI->>BG: run_plugin(pluginName, config)
    BG->>BG: pluginManager.run()

    Note over BG: 1. 更新状态为 running
    BG->>BG: 2. 调用插件 run(ctx)

    BG->>WS: plugin_message(pluginName, msg)
    WS->>WS: 广播/路由消息
    WS-->>BG: 消息响应

    Plugin-->>BG: 执行完成

    Note over BG: 3. 更新状态为 installed
    BG->>BG: 4. 返回结果

    BG-->>UI: { success, result }
    UI-->>User: 显示结果
```

---

## 状态流转

### 客户端连接状态

```
              ┌──────────────┐
              │   disconnected │
              └──────┬───────┘
                     │ connect()
                     ▼
              ┌──────────────┐
              │   connecting  │◄────┐
              └──────┬───────┘      │
                     │ connected    │  reconnect()
                     ▼              │
              ┌──────────────┐      │
              │   connected   │─────┘
              └──────┬───────┘
                     │ disconnect() / 断开
                     ▼
              ┌──────────────┐
              │ disconnected │
              └──────────────┘
```

### 插件运行状态

```
    ┌──────────────┐
    │   uninstalled │
    └──────┬───────┘
           │ install()
           ▼
    ┌──────────────┐
    │   installed   │◄────┐
    └──────┬───────┘      │
           │ run()         │ run() (重新运行)
           ▼               │
    ┌──────────────┐       │
    │   running     │──────┘
    └──────┬───────┘
           │ complete / stop()
           ▼
    ┌──────────────┐
    │   installed   │
    └──────┬───────┘
           │ uninstall()
           ▼
    ┌──────────────┐
    │ uninstalled  │
    └──────────────┘
```

---

## 错误处理

### 连接错误

| 错误类型 | 处理方式 |
|----------|----------|
| 连接超时 | 3秒后重试，最多重试3次 |
| 连接拒绝 | 提示检查服务端地址 |
| 网络断开 | 自动重连 |

### 插件错误

| 错误类型 | 处理方式 |
|----------|----------|
| 安装失败 | 记录错误，通知用户 |
| 运行超时 | 30秒超时，强制停止 |
| 运行异常 | 捕获错误，返回错误信息 |
