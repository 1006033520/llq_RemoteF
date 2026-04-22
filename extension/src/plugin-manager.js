/**
 * RemoteF 插件管理器
 * 插件由服务端控制分发，客户端只负责安装和运行
 * 状态只有两种：已安装(installed) / 异常(error)
 */

import storage from './storage.js';

// ===== 插件状态定义 =====
export const PluginStatus = {
  INSTALLED: 'installed', // 已安装（正常可用）
  ERROR: 'error'          // 异常（安装失败或运行出错）
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

    // 返回代理对象，实际执行由 content script 处理
    return {
      _isProxy: true,
      _pluginName: module.manifest.name,
      init: async (ctx) => {
        console.log('[PluginManager] 插件初始化:', ctx.pluginName);
      },
      run: async (ctx, config) => {
        console.log('[PluginManager] 插件运行:', ctx.pluginName);
        return { queued: true, config };
      }
    };
  }

  // ===== 插件安装 =====
  async install(pluginName, module, sendFunc) {
    console.log('[PluginManager] 安装插件:', pluginName);

    try {
      const pluginData = {
        manifest: module.manifest,
        version: module.manifest.version,
        files: module.files,
        installedAt: Date.now()
      };

      // 保存元数据和插件数据
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
        status: PluginStatus.INSTALLED,
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

  // ===== 插件运行（由服务端触发）=====
  async run(pluginName, sendFunc, config = {}) {
    console.log('[PluginManager] 运行插件:', pluginName);

    const plugin = this.plugins.get(pluginName);
    if (!plugin?.instance) {
      const error = '插件未安装';
      this.emit('error', { pluginName, error });
      return { success: false, error };
    }

    try {
      const ctx = this.createContext(pluginName, sendFunc);
      const result = await plugin.instance.run(ctx, config);

      plugin.lastRun = Date.now();
      plugin.runCount = (plugin.runCount || 0) + 1;

      // 运行完成后回到已安装状态
      this.setStatus(pluginName, PluginStatus.INSTALLED);
      this.emit('run', { pluginName, result });
      return { success: true, result };
    } catch (err) {
      console.error('[PluginManager] 插件执行失败:', pluginName, err);
      this.setStatus(pluginName, PluginStatus.ERROR, err.message);
      this.emit('error', { pluginName, error: err.message });
      return { success: false, error: err.message };
    }
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
              status: PluginStatus.INSTALLED,
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
