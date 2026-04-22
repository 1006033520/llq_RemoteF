/**
 * RemoteF 插件管理器
 * 插件安装后由 content script 在页面加载时自动运行
 */

import storage from './storage.js';

// ===== 插件状态定义 =====
export const PluginStatus = {
  INSTALLED: 'installed', // 已安装（正常可用）
  ERROR: 'error'          // 异常（安装失败或运行出错）
};

// ===== 插件上下文模板 =====
function createPluginContext(pluginName, sendFunc) {
  return {
    pluginName,
    console: {
      log: (...args) => console.log(`[${pluginName}]`, ...args),
      error: (...args) => console.error(`[${pluginName}]`, ...args),
      warn: (...args) => console.warn(`[${pluginName}]`, ...args),
      info: (...args) => console.info(`[${pluginName}]`, ...args)
    },
    sendMessage: (msg) => {
      sendFunc({
        type: 'plugin_message',
        payload: { pluginName, message: msg }
      });
    }
  };
}

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

  // ===== 插件安装 =====
  async install(pluginName, module, sendFunc) {
    console.log('[PluginManager] 安装插件:', pluginName);

    try {
      // 保存元数据
      const meta = await storage.getPluginMeta();
      meta[pluginName] = {
        version: module.manifest.version,
        installedAt: Date.now(),
        lastError: null
      };
      await storage.savePluginMeta(meta);

      // 保存完整插件数据
      const pluginData = {
        manifest: module.manifest,
        version: module.manifest.version,
        files: module.files,
        installedAt: Date.now()
      };
      await storage.savePluginData(pluginName, pluginData);

      // 保存客户端代码（供 content script 自动运行）
      const mainFile = module.manifest.client?.entry || 'content.js';
      const code = module.files[mainFile];
      if (code) {
        await storage.savePluginCode(pluginName, code);
      }

      // 保存插件实例信息（不含实际代码，简化存储）
      this.plugins.set(pluginName, {
        name: pluginName,
        manifest: module.manifest,
        version: module.manifest.version,
        status: PluginStatus.INSTALLED,
        error: null,
        installedAt: pluginData.installedAt
      });

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

    try {
      await storage.removePluginData(pluginName);

      // 从内存移除
      const plugin = this.plugins.get(pluginName);
      this.plugins.delete(pluginName);

      // 从元数据移除
      const meta = await storage.getPluginMeta();
      delete meta[pluginName];
      await storage.savePluginMeta(meta);

      // 通知 content script 卸载
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          target: 'content',
          type: 'plugin_unload',
          payload: { pluginName }
        });
      }

      console.log('[PluginManager] 插件卸载成功:', pluginName);
      this.emit('uninstalled', { pluginName });

      return { success: true };
    } catch (err) {
      console.error('[PluginManager] 插件卸载失败:', pluginName, err);
      return { success: false, error: err.message };
    }
  }

  // ===== 手动重运行插件 =====
  async rerun(pluginName) {
    console.log('[PluginManager] 手动重运行插件:', pluginName);

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      return { success: false, error: '无法获取当前标签页' };
    }

    try {
      await chrome.tabs.sendMessage(tabs[0].id, {
        target: 'content',
        type: 'plugin_rerun',
        payload: { pluginName }
      });
      return { success: true };
    } catch (err) {
      console.error('[PluginManager] 重运行失败:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ===== 在标签页运行所有已安装插件 =====
  async runAllInTab(tabId, sendFunc) {
    console.log('[PluginManager] 在标签页运行插件:', tabId);

    const meta = await storage.getPluginMeta();
    const pluginNames = Object.keys(meta);

    for (const name of pluginNames) {
      try {
        const code = await storage.getPluginCode(name);
        if (!code) continue;

        console.log('[PluginManager] 执行插件:', name);

        // 使用 chrome.userScripts.execute() 执行插件代码
        // 这会在 USER_SCRIPT 隔离世界中执行，不受页面 CSP 限制
        if (typeof chrome.userScripts?.execute === 'function') {
          // Chrome 135+ 推荐方式
          const results = await chrome.userScripts.execute({
            target: { tabId },
            scripts: [{
              code: `
                (function() {
                  window.__remotef_plugins = window.__remotef_plugins || {};
                  try {
                    const factory = (${code});
                    window.__remotef_plugins['${name}'] = factory;
                    return { success: true, hasFactory: typeof factory === 'function' };
                  } catch (err) {
                    return { success: false, error: err.message };
                  }
                })();
              `
            }]
          });

          const result = results?.[0]?.result;
          if (result?.success) {
            console.log('[PluginManager]', name, ': 注入成功 (userScripts API)');
            
            // 创建上下文
            const context = createPluginContext(name, sendFunc);

            // 通知 content script 注册并运行插件
            chrome.tabs.sendMessage(tabId, {
              target: 'content',
              type: 'plugin_register',
              payload: { pluginName: name, context }
            });
          } else {
            console.error('[PluginManager]', name, ': 注入失败', result?.error);
          }
        } else {
          // 降级到 chrome.scripting.executeScript (可能有 CSP 限制)
          console.log('[PluginManager]', name, ': chrome.userScripts 不可用，降级到 executeScript');
          
          const results = await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
              target: { tabId },
              world: 'ISOLATED',
              func: (pluginName, pluginCode) => {
                try {
                  window.__remotef_plugins = window.__remotef_plugins || {};
                  const factory = (new Function(`return (${pluginCode})`))();
                  window.__remotef_plugins[pluginName] = factory;
                  return { success: !!factory, hasFactory: typeof factory === 'function' };
                } catch (err) {
                  return { success: false, error: err.message };
                }
              },
              args: [name, code]
            }, (results) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(results[0]?.result);
              }
            });
          });

          if (results?.success) {
            console.log('[PluginManager]', name, ': 注入成功 (executeScript)');

            const context = createPluginContext(name, sendFunc);

            chrome.tabs.sendMessage(tabId, {
              target: 'content',
              type: 'plugin_register',
              payload: { pluginName: name, context }
            });
          } else {
            console.error('[PluginManager]', name, ': 注入失败', results?.error);
          }
        }
      } catch (err) {
        console.error('[PluginManager]', name, ': 错误:', err.message);
      }
    }
  }

  // ===== 上下文创建（用于服务端模块的 init/onEnable）=====
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
      }
    };
  }

  // ===== 状态管理 =====
  setStatus(pluginName, status, error = null) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.status = status;
      plugin.error = error;
      plugin.statusChangedAt = Date.now();
      this.emit('statusChanged', { pluginName, status, error });
    }
  }

  getStatus(pluginName) {
    return this.plugins.get(pluginName)?.status || null;
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
    console.log('[PluginManager] 恢复已安装的插件...');

    const meta = await storage.getPluginMeta();
    const names = Object.keys(meta);

    for (const name of names) {
      try {
        const data = await storage.getPluginData(name);
        if (data?.manifest) {
          this.plugins.set(name, {
            name,
            manifest: data.manifest,
            version: data.version,
            status: PluginStatus.INSTALLED,
            error: null,
            installedAt: data.installedAt
          });
          console.log('[PluginManager] 恢复插件:', name);
        }
      } catch (err) {
        console.error('[PluginManager] 恢复插件失败:', name, err);
      }
    }

    this.emit('restored', { count: this.plugins.size });
    console.log('[PluginManager] 插件恢复完成:', this.plugins.size);
  }
}

export default new PluginManager();
