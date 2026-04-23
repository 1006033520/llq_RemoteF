/**
 * 插件管理器
 * 负责插件的加载、卸载、安装、卸载等操作
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerAPI } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PluginManager {
  constructor(pluginsDir) {
    this.pluginsDir = path.resolve(__dirname, '..', pluginsDir);
    this.plugins = new Map(); // name -> PluginInstance
    this.instances = new Map(); // clientId -> Set<pluginName>

    // 服务端 API 实例
    this.serverApi = new ServerAPI({ pluginManager: this });

    // Express app 引用（延迟注入，用于注册插件路由）
    this.app = null;
  }

  /**
   * 注入 Express app 引用（在服务端启动时调用）
   */
  setApp(app) {
    this.app = app;
  }

  /**
   * 加载所有插件
   */
  async loadAll() {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }

    const dirs = fs.readdirSync(this.pluginsDir);

    for (const dir of dirs) {
      const pluginPath = path.join(this.pluginsDir, dir);
      const stat = fs.statSync(pluginPath);

      if (stat.isDirectory()) {
        try {
          await this.loadPlugin(dir);
        } catch (err) {
          console.error(`❌ 加载插件 ${dir} 失败:`, err.message);
        }
      }
    }
  }

  /**
   * 加载单个插件
   */
  async loadPlugin(name) {
    const pluginDir = path.join(this.pluginsDir, name);
    const manifestPath = path.join(pluginDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // 加载服务端模块
    let serverModule = null;
    if (manifest.server?.entry) {
      const serverPath = path.join(pluginDir, manifest.server.entry);
      if (fs.existsSync(serverPath)) {
        const { default: module } = await import(`file://${serverPath}`);
        serverModule = {
          ...module,
          manifest: { ...manifest, ...module.manifest }
        };
      }
    }

    const plugin = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      author: manifest.author || '',
      manifest,
      path: pluginDir,
      serverModule,
      status: 'loaded'
    };

    this.plugins.set(name, plugin);
    console.log(`✅ 插件 ${name} 已加载`);

    // 如果插件有 setupRoutes 方法，自动注册路由
    if (plugin.serverModule?.setupRoutes && this.app) {
      plugin.serverModule.setupRoutes(this.app, this);
    }

    return plugin;
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // 通知所有客户端卸载
    const ctx = this.createContext(null, null, name);
    if (plugin.serverModule?.onStop) {
      try {
        await plugin.serverModule.onStop(ctx);
      } catch (err) {
        console.error(`插件 ${name} onStop 失败:`, err);
      }
    }

    this.plugins.delete(name);
    console.log(`📤 插件 ${name} 已卸载`);
    return true;
  }

  /**
   * 安装插件（从文件或URL）
   */
  async installPlugin(source, sourceType = 'directory') {
    if (sourceType === 'directory') {
      const name = path.basename(source);
      await this.loadPlugin(name);
      return this.plugins.get(name);
    }
    // TODO: 支持从URL或文件安装
    throw new Error('暂不支持的安装类型');
  }

  /**
   * 获取插件列表
   */
  list() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      status: p.status
    }));
  }

  /**
   * 获取单个插件
   */
  get(name) {
    return this.plugins.get(name);
  }

  /**
   * 获取插件的客户端模块（JSON格式，可传输）
   */
  getClientModule(name) {
    const plugin = this.plugins.get(name);
    if (!plugin?.manifest.client) return null;

    const clientDir = path.join(plugin.path, plugin.manifest.client.directory || 'client');
    const clientManifestPath = path.join(clientDir, 'manifest.json');
    const clientManifest = JSON.parse(fs.readFileSync(clientManifestPath, 'utf-8'));

    // 读取所有客户端文件
    const files = this.readDirRecursive(clientDir, []);
    const clientFiles = {};

    for (const file of files) {
      if (file === 'manifest.json') continue;
      const filePath = path.join(clientDir, file);
      const ext = path.extname(file);
      if (['.js', '.json', '.css', '.html'].includes(ext)) {
        let code = fs.readFileSync(filePath, 'utf-8');

        // 转换模块格式为客户端可执行格式
        if (ext === '.js') {
          code = this.transformModuleCode(code);
        }

        clientFiles[file] = code;
      }
    }

    return {
      manifest: clientManifest,
      files: clientFiles
    };
  }

  /**
   * 将 CommonJS/ES Module 格式转换为客户端可执行格式
   */
  transformModuleCode(code) {
    // 移除 ES Module 导出
    code = code.replaceAll(/export\s+default\s+/g, 'var __plugin__ = ');

    // 移除 CommonJS 导出
    code = code.replaceAll(/module\.exports\s*=\s*/g, 'var __plugin__ = ');

    // 如果代码是对象字面量（以 { 结尾），确保闭合
    // 这是为了让代码能被直接执行
    if (!code.includes('__plugin__')) {
      // 尝试包裹成立即执行函数，返回对象
      code = `var __plugin__ = (${code})`;
    }

    return code;
  }

  /**
   * 递归读取目录
   */
  readDirRecursive(dir, baseDir = []) {
    const files = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.readDirRecursive(fullPath, [...baseDir, item]));
      } else {
        files.push([...baseDir, item].join('/'));
      }
    }

    return files;
  }

  /**
   * 创建插件执行上下文
   * @param {string} clientId - 客户端 ID
   * @param {WebSocket} ws - WebSocket 连接
   * @param {string} pluginName - 当前插件名（系统注入，插件无法指定）
   */
  createContext(clientId, ws, pluginName) {
    const self = this;
    return {
      clientId,
      ws,
      pluginName,

      // 统一 API 接口（推荐使用）
      // 核心原则：插件只能与同名客户端插件通讯，pluginName 由系统自动绑定
      api: {
        /**
         * 发送消息给指定客户端的同名插件
         */
        sendToClient(targetClientId, message) {
          return self.serverApi.sendToClient(targetClientId, pluginName, message);
        },

        /**
         * 广播消息给所有在线客户端的同名插件
         */
        broadcast(message, filter) {
          return self.serverApi.broadcast(pluginName, message, filter);
        },

        /**
         * 广播给安装了本插件的所有客户端
         */
        broadcastToPluginClients(message) {
          return self.serverApi.broadcastToPluginClients(pluginName, message);
        },

        /**
         * 获取所有在线客户端
         */
        getClients() {
          return self.serverApi.getClients();
        },

        /**
         * 获取指定客户端信息
         */
        getClientInfo(targetClientId) {
          return self.serverApi.getClientInfo(targetClientId);
        },

        /**
         * 检查客户端是否在线
         */
        isClientOnline(targetClientId) {
          return self.serverApi.isClientOnline(targetClientId);
        },

        /**
         * 获取服务端连接状态
         */
        getConnectionStatus() {
          return self.serverApi.getConnectionStatus();
        },

        /**
         * 获取插件存储
         */
        getStorage(key) {
          return self.serverApi.getStorage(pluginName, key);
        },

        /**
         * 设置插件存储
         */
        setStorage(key, value) {
          return self.serverApi.setStorage(pluginName, key, value);
        },

        /**
         * 删除插件存储
         */
        removeStorage(key) {
          return self.serverApi.removeStorage(pluginName, key);
        },

        /**
         * 获取插件整个存储对象
         */
        getStore() {
          return self.serverApi.getStore(pluginName);
        }
      },

      // 保留旧接口兼容
      server: {
        send(targetClientId, type, payload) {
          // 使用注入的发送函数
          if (self._sendToClient) {
            self._sendToClient(targetClientId, type, payload);
          } else if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
          }
        },
        getConnection(id) {
          // 由 WsServer 提供
          return null;
        },
        broadcast(type, payload, filter) {
          if (self._broadcast) {
            self._broadcast(type, payload, filter);
          }
        }
      },
      plugin: {
        list: () => self.list(),
        get: (name) => self.get(name),
        getClientModule: (name) => self.getClientModule(name)
      }
    };
  }

  /**
   * 通知插件有客户端连接/断开
   */
  async notifyClientEvent(event, clientId) {
    for (const [name, plugin] of this.plugins) {
      if (plugin.serverModule?.onClientEvent) {
        try {
          const ctx = this.createContext(clientId, null, name);
          await plugin.serverModule.onClientEvent(ctx, event, clientId);
        } catch (err) {
          console.error(`插件 ${name} onClientEvent 失败:`, err);
        }
      }
    }
  }

  /**
   * 处理来自插件的消息
   */
  async handlePluginMessage(pluginName, clientId, message) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin?.serverModule) return;

    const ctx = this.createContext(clientId, null, pluginName);
    if (plugin.serverModule.onMessage) {
      await plugin.serverModule.onMessage(ctx, message);
    }
  }
}
