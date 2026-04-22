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

  // ===== 客户端身份（永久唯一 ID）=====

  /**
   * 获取客户端唯一 ID。
   * 首次调用时生成 UUID v4 并持久化到 storage，后续始终返回相同值。
   * 不受重连、更新、浏览器重启影响，只有卸载扩展才会消失。
   */
  async getClientId() {
    const KEY = 'remotef_client_id';
    const result = await this.storage.get(KEY);
    if (result[KEY]) {
      return result[KEY];
    }
    // 生成 UUID v4
    const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0x0f) | (c === 'x' ? 0 : 0x80);
      return (c === 'x' ? r : (r & 0x3f) | 0x80).toString(16);
    });
    await this.storage.set({ [KEY]: id });
    console.log('[Storage] 生成客户端唯一 ID:', id);
    return id;
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
