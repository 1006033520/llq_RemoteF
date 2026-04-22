/**
 * 插件管理器
 * 负责插件的加载、卸载、安装、卸载等操作
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PluginManager {
  constructor(pluginsDir) {
    this.pluginsDir = path.resolve(__dirname, '..', pluginsDir);
    this.plugins = new Map(); // name -> PluginInstance
    this.instances = new Map(); // clientId -> Set<pluginName>
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
      enabled: new Set(), // 启用此插件的客户端ID
      status: 'loaded'
    };

    this.plugins.set(name, plugin);
    console.log(`✅ 插件 ${name} 已加载`);

    return plugin;
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // 通知所有客户端卸载
    const ctx = this.createContext(null, null);
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
      status: p.status,
      enabledClients: p.enabled.size
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
   */
  createContext(clientId, ws) {
    const self = this;
    return {
      clientId,
      ws,
      server: {
        send(clientId, type, payload) {
          const conn = this.getConnection(clientId);
          if (conn) {
            conn.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
          }
        },
        getConnection(id) {
          // 由 WsServer 提供
          return null;
        },
        broadcast(type, payload, filter) {
          // 由 WsServer 提供
        }
      },
      plugin: {
        list: () => self.list(),
        get: (name) => self.get(name),
        getClientModule: (name) => self.getClientModule(name),
        enable: (name, clientId) => {
          const p = self.plugins.get(name);
          if (p) {
            p.enabled.add(clientId);
            return true;
          }
          return false;
        },
        disable: (name, clientId) => {
          const p = self.plugins.get(name);
          if (p) {
            p.enabled.delete(clientId);
            return true;
          }
          return false;
        }
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
          const ctx = this.createContext(clientId, null);
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

    const ctx = this.createContext(clientId, null);
    if (plugin.serverModule.onMessage) {
      await plugin.serverModule.onMessage(ctx, message);
    }
  }
}
