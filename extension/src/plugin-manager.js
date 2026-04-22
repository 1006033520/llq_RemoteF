/**
 * RemoteF 插件管理器
 * 提供插件的安装、卸载、运行、状态管理功能
 */

import storage from './storage.js';

// ===== 插件状态定义 =====
export const PluginStatus = {
  IDLE: 'idle',
  INSTALLING: 'installing',
  RUNNING: 'running',
  ERROR: 'error',
  STOPPED: 'stopped',
  UNINSTALLING: 'uninstalling'
};

// ===== 插件管理器类 =====
export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.contexts = new Map();
    this.eventListeners = new Set();
  }

  // ===== 事件系统 =====
  on(event, callback) {
    const id = Symbol('listener');
    this.eventListeners.add({ id, event, callback });
    return () => this.off(id);
  }

  off(id) {
    for (const listener of this.eventListeners) {
      if (listener.id === id) {
        this.eventListeners.delete(listener);
        break;
      }
    }
  }

  emit(event, data = {}) {
    this.eventListeners.forEach(listener => {
      if (listener.event === event || listener.event === '*') {
        try {
          listener.callback({ type: event, ...data });
        } catch (err) {
          console.error('[PluginManager] 事件回调错误:', err);
        }
      }
    });
  }

  // ===== 代码加载 =====
  async loadPluginCode(module) {
    const mainFile = module.manifest.client?.entry || 'content.js';
    const code = module.files[mainFile];

    if (!code) {
      throw new Error(`找不到入口文件: ${mainFile}`);
    }

    // 保存代码到存储，供 content script 读取
    await storage.savePluginCode(module.manifest.name, code);

    // 返回一个代理对象，实际执行由 content script 处理
    return {
      _isProxy: true,
      _pluginName: module.manifest.name,
      init: async (ctx) => {
        console.log('[PluginManager] 插件初始化:', ctx.pluginName);
      },
      run: async (ctx, config) => {
        console.log('[PluginManager] 插件运行:', ctx.pluginName);
        return { queued: true, config };
      },
      stop: async () => {
        console.log('[PluginManager] 插件停止:', this._pluginName);
      },
      destroy: async () => {
        console.log('[PluginManager] 插件销毁:', this._pluginName);
        await storage.removePluginData(this._pluginName);
      }
    };
  }

  // ===== 插件安装 =====
  async install(pluginName, module, sendFunc) {
    console.log('[PluginManager] 安装插件:', pluginName);
    this.setStatus(pluginName, PluginStatus.INSTALLING);

    try {
      const pluginData = {
        manifest: module.manifest,
        version: module.manifest.version,
        files: module.files,
        installedAt: Date.now()
      };

      // 保存元数据
      const meta = await storage.getPluginMeta();
      meta[pluginName] = {
        version: pluginData.version,
        installedAt: pluginData.installedAt,
        lastError: null
      };
      await storage.savePluginMeta(meta);
      await storage.savePluginData(pluginName, pluginData);

      // 加载插件实例
      const instance = await this.loadPluginCode(module);

      // 保存插件
      this.plugins.set(pluginName, {
        name: pluginName,
        manifest: module.manifest,
        version: module.manifest.version,
        instance,
        status: PluginStatus.IDLE,
        error: null,
        lastRun: null,
        runCount: 0,
        installedAt: pluginData.installedAt
      });

      // 调用初始化
      if (instance?.init) {
        const ctx = this.createContext(pluginName, sendFunc);
        await instance.init(ctx);
      }

      this.setStatus(pluginName, PluginStatus.IDLE);
      console.log('[PluginManager] 插件安装成功:', pluginName);
      this.emit('installed', { pluginName, version: pluginData.version });

      return { success: true, plugin: this.plugins.get(pluginName) };
    } catch (err) {
      console.error('[PluginManager] 插件安装失败:', pluginName, err);
      this.setStatus(pluginName, PluginStatus.ERROR, err.message);
      this.emit('error', { pluginName, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // ===== 插件卸载 =====
  async uninstall(pluginName) {
    console.log('[PluginManager] 卸载插件:', pluginName);
    this.setStatus(pluginName, PluginStatus.UNINSTALLING);

    const plugin = this.plugins.get(pluginName);
    if (plugin?.instance?.destroy) {
      try {
        await plugin.instance.destroy();
      } catch (err) {
        console.error('[PluginManager] 插件销毁失败:', err);
      }
    }

    this.plugins.delete(pluginName);
    this.contexts.delete(pluginName);

    // 清理存储
    const meta = await storage.getPluginMeta();
    delete meta[pluginName];
    await storage.savePluginMeta(meta);
    await storage.removePluginData(pluginName);

    console.log('[PluginManager] 插件已卸载:', pluginName);
    this.emit('uninstalled', { pluginName });
  }

  // ===== 插件运行 =====
  async run(pluginName, sendFunc, config = {}) {
    console.log('[PluginManager] 运行插件:', pluginName);

    const plugin = this.plugins.get(pluginName);
    if (!plugin?.instance) {
      const error = '插件未安装';
      this.emit('error', { pluginName, error });
      return { success: false, error };
    }

    this.setStatus(pluginName, PluginStatus.RUNNING);

    try {
      const ctx = this.createContext(pluginName, sendFunc);
      const result = await plugin.instance.run(ctx, config);

      plugin.lastRun = Date.now();
      plugin.runCount = (plugin.runCount || 0) + 1;
      this.setStatus(pluginName, PluginStatus.IDLE);

      this.emit('run', { pluginName, result });
      return { success: true, result };
    } catch (err) {
      console.error('[PluginManager] 插件执行失败:', pluginName, err);
      this.setStatus(pluginName, PluginStatus.ERROR, err.message);
      this.emit('error', { pluginName, error: err.message });
      return { success: false, error: err.message };
    }
  }

  // ===== 插件停止 =====
  async stop(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return { success: false, error: '插件不存在' };
    }

    if (plugin.instance?.stop) {
      try {
        await plugin.instance.stop();
      } catch (err) {
        console.error('[PluginManager] 停止插件失败:', err);
      }
    }

    this.setStatus(pluginName, PluginStatus.STOPPED);
    this.emit('stopped', { pluginName });
    return { success: true };
  }

  // ===== 上下文创建 =====
  createContext(pluginName, sendFunc) {
    const self = this;
    return {
      pluginName,
      sendMessage: (msg) => {
        sendFunc({
          type: 'plugin_message',
          payload: { pluginName, message: msg }
        });
      },
      onMessage: (handler) => {
        self.contexts.set(pluginName, handler);
      },
      utils: {
        getTab: () => chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]),
        injectScript: (code) => {
          return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs[0]) {
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: (c) => eval(c),
                args: [code]
              });
            }
          });
        }
      }
    };
  }

  // ===== 状态管理 =====
  setStatus(pluginName, status, error = null) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      const prevStatus = plugin.status;
      plugin.status = status;
      plugin.error = error;
      plugin.statusChangedAt = Date.now();

      const errorPart = error ? ` (${error})` : '';
      console.log(`[PluginManager] ${pluginName}: ${prevStatus} → ${status}${errorPart}`);
      this.emit('statusChanged', { pluginName, prevStatus, status, error });
    }
  }

  getStatus(pluginName) {
    return this.plugins.get(pluginName)?.status || null;
  }

  getError(pluginName) {
    return this.plugins.get(pluginName)?.error || null;
  }

  // ===== 查询方法 =====
  get(pluginName) {
    return this.plugins.get(pluginName) || null;
  }

  getAll() {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      manifest: p.manifest,
      version: p.version,
      status: p.status,
      error: p.error,
      lastRun: p.lastRun,
      runCount: p.runCount,
      installedAt: p.installedAt
    }));
  }

  getNames() {
    return Array.from(this.plugins.keys());
  }

  has(pluginName) {
    return this.plugins.has(pluginName);
  }

  getContextHandler(pluginName) {
    return this.contexts.get(pluginName);
  }

  // ===== 从存储恢复 =====
  async restore(sendFunc) {
    console.log('[PluginManager] 尝试恢复已安装的插件...');

    const meta = await storage.getPluginMeta();
    const names = Object.keys(meta);

    if (names.length === 0) {
      console.log('[PluginManager] 没有已安装的插件');
      return;
    }

    for (const name of names) {
      try {
        const data = await storage.getPluginData(name);
        if (data) {
          const code = await storage.getPluginCode(name);

          if (code) {
            const module = { manifest: data.manifest, files: data.files };
            const instance = await this.loadPluginCode(module);

            this.plugins.set(name, {
              name,
              manifest: data.manifest,
              version: data.version,
              instance,
              status: PluginStatus.IDLE,
              error: null,
              lastRun: null,
              runCount: 0,
              installedAt: data.installedAt
            });

            console.log('[PluginManager] 恢复插件:', name);

            if (instance?.init) {
              const ctx = this.createContext(name, sendFunc);
              await instance.init(ctx);
            }
          }
        }
      } catch (err) {
        console.error('[PluginManager] 恢复插件失败:', name, err);
        this.plugins.set(name, {
          name,
          manifest: meta[name].manifest || {},
          version: meta[name].version,
          instance: null,
          status: PluginStatus.ERROR,
          error: err.message,
          installedAt: meta[name].installedAt
        });
      }
    }

    this.emit('restored', { count: this.plugins.size });
    console.log('[PluginManager] 插件恢复完成:', this.plugins.size);
  }
}

export default new PluginManager();
