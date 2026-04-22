/**
 * RemoteF 存储管理模块
 * 封装 chrome.storage.local 操作
 */

export class Storage {
  constructor(prefix = 'remotef_') {
    this.prefix = prefix;
    this.storage = chrome.storage.local;
  }

  // ===== 基础操作 =====

  async get(key) {
    const result = await this.storage.get(this.prefix + key);
    return result[this.prefix + key];
  }

  async set(key, value) {
    await this.storage.set({ [this.prefix + key]: value });
  }

  async remove(key) {
    await this.storage.remove(this.prefix + key);
  }

  async clear() {
    const keys = await this.storage.get(null);
    const prefixKeys = Object.keys(keys).filter(k => k.startsWith(this.prefix));
    if (prefixKeys.length > 0) {
      await this.storage.remove(prefixKeys);
    }
  }

  // ===== 配置操作 =====

  async getConfig() {
    const result = await this.storage.get('remotef_config');
    return result['remotef_config'] || {
      serverUrl: '',
      autoConnect: true,
      clientName: '',
      clientVersion: '1.0.0'
    };
  }

  async saveConfig(config) {
    await this.storage.set({ 'remotef_config': config });
  }

  // ===== 插件元数据操作 =====

  async getPluginMeta() {
    const result = await this.storage.get(this.prefix + 'plugin_meta');
    return result[this.prefix + 'plugin_meta'] || {};
  }

  async savePluginMeta(meta) {
    await this.storage.set({ [this.prefix + 'plugin_meta']: meta });
  }

  async getPluginData(name) {
    return this.get('plugin_' + name);
  }

  async savePluginData(name, data) {
    await this.set('plugin_' + name, data);
  }

  async removePluginData(name) {
    await this.remove('plugin_' + name);
    await this.remove('plugin_code_' + name);
  }

  async getPluginCode(name) {
    return this.get('plugin_code_' + name);
  }

  async savePluginCode(name, code) {
    await this.set('plugin_code_' + name, code);
  }
}

export default new Storage();
