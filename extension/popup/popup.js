/**
 * RemoteF Popup 脚本
 * 插件由服务端统一管理，客户端只展示插件状态
 */

// 插件状态映射（只有两种）
const STATUS_LABELS = {
  installed: '已安装',
  error: '异常'
};

const STATUS_CLASS = {
  installed: 'status-installed',
  error: 'status-error'
};

// DOM 元素
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const serverUrlEl = document.getElementById('server-url');
const pluginList = document.getElementById('plugin-list');

// 当前插件数据
let plugins = [];

// 检查状态
async function checkStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'get_status' });
    console.log('[RemoteF] Popup 状态:', status);

    if (status && status.isConnected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = '已连接';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = '未连接';
    }

    if (status && status.plugins) {
      plugins = status.plugins;
      renderPlugins();
    }
  } catch (err) {
    console.error('[RemoteF] Popup 状态错误:', err);
  }
}

// 渲染插件列表
function renderPlugins() {
  if (plugins.length === 0) {
    pluginList.innerHTML = '<div class="empty-state"><p>暂无插件</p></div>';
    return;
  }

  pluginList.innerHTML = plugins.map(p => {
    const status = p.status === 'error' ? 'error' : 'installed';
    const statusClass = STATUS_CLASS[status];
    const statusLabel = STATUS_LABELS[status];

    return `
      <div class="plugin-item">
        <div class="plugin-header">
          <div class="plugin-info">
            <h3>${escapeHtml(p.name)}</h3>
            <p>v${escapeHtml(p.version || '1.0.0')}</p>
          </div>
          <div class="plugin-status ${statusClass}">
            <span class="dot"></span>
            <span class="label">${statusLabel}</span>
          </div>
        </div>
        ${p.error ? `<div class="plugin-error">${escapeHtml(p.error)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 加载配置
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('remotef_config');
    const config = result.remotef_config || {};
    serverUrlEl.textContent = config.serverUrl || '未配置';
  } catch (err) {
    console.error('[RemoteF] 加载配置失败:', err);
  }
}

// 初始化
loadConfig();
checkStatus();

// 每秒更新状态
setInterval(checkStatus, 1000);

// 监听消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'popup_update') {
    console.log('[RemoteF] Popup 收到更新:', message.payload);

    const payload = message.payload;

    switch (payload.type) {
      case 'plugin_status_changed': {
        const plugin = plugins.find(p => p.name === payload.pluginName);
        if (plugin) {
          plugin.status = payload.status;
          plugin.error = payload.error;
        }
        renderPlugins();
        break;
      }

      case 'plugin_installed':
        checkStatus();
        break;

      case 'plugin_error': {
        const p = plugins.find(p => p.name === payload.pluginName);
        if (p) {
          p.status = 'error';
          p.error = payload.error;
        }
        renderPlugins();
        break;
      }

      case 'plugin_list':
      case 'connection_changed':
        checkStatus();
        break;
    }
  }
});
