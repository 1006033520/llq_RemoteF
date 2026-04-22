/**
 * RemoteF Popup 脚本
 */

// 插件状态映射
const STATUS_LABELS = {
  idle: '空闲',
  running: '运行中',
  error: '异常',
  stopped: '已停止',
  installing: '安装中',
  uninstalling: '卸载中'
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

    // 更新插件列表
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
    const statusClass = `status-${p.status || 'idle'}`;
    const statusLabel = STATUS_LABELS[p.status] || '空闲';
    const isRunning = p.status === 'running';
    const isInstalling = p.status === 'installing';
    const canRun = !isRunning && !isInstalling && p.status !== 'uninstalling';
    const canStop = isRunning;
    const canDelete = !isInstalling && !isRunning && p.status !== 'uninstalling';

    // 使用 data-* 属性而非 onclick
    return `
      <div class="plugin-item" data-plugin="${escapeHtml(p.name)}">
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
        <div class="plugin-actions">
          <button class="btn-small btn-run action-run" data-plugin="${escapeHtml(p.name)}" ${!canRun ? 'disabled' : ''}>运行</button>
          <button class="btn-small btn-stop action-stop" data-plugin="${escapeHtml(p.name)}" ${!canStop ? 'disabled' : ''}>停止</button>
          <button class="btn-small btn-delete action-delete" data-plugin="${escapeHtml(p.name)}" ${!canDelete ? 'disabled' : ''}>删除</button>
        </div>
      </div>
    `;
  }).join('');

  // 绑定事件处理器
  bindActionEvents();
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 绑定按钮事件
function bindActionEvents() {
  pluginList.querySelectorAll('.action-run').forEach(btn => {
    btn.addEventListener('click', () => runPlugin(btn.dataset.plugin));
  });
  pluginList.querySelectorAll('.action-stop').forEach(btn => {
    btn.addEventListener('click', () => stopPlugin(btn.dataset.plugin));
  });
  pluginList.querySelectorAll('.action-delete').forEach(btn => {
    btn.addEventListener('click', () => deletePlugin(btn.dataset.plugin));
  });
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

// 运行插件
async function runPlugin(name) {
  console.log('[RemoteF] 运行插件:', name);
  try {
    await chrome.runtime.sendMessage({ 
      type: 'run_plugin', 
      pluginName: name,
      config: {}
    });
  } catch (err) {
    console.error('[RemoteF] 运行插件失败:', err);
  }
}

// 停止插件
async function stopPlugin(name) {
  console.log('[RemoteF] 停止插件:', name);
  try {
    await chrome.runtime.sendMessage({ 
      type: 'stop_plugin', 
      pluginName: name
    });
  } catch (err) {
    console.error('[RemoteF] 停止插件失败:', err);
  }
}

// 删除插件
async function deletePlugin(name) {
  if (!confirm(`确定要删除插件 "${name}" 吗？`)) {
    return;
  }
  console.log('[RemoteF] 删除插件:', name);
  try {
    await chrome.runtime.sendMessage({ 
      type: 'uninstall_plugin', 
      pluginName: name
    });
  } catch (err) {
    console.error('[RemoteF] 删除插件失败:', err);
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
      case 'plugin_status_changed':
        const plugin = plugins.find(p => p.name === payload.pluginName);
        if (plugin) {
          plugin.status = payload.status;
          plugin.error = payload.error;
        }
        renderPlugins();
        break;
        
      case 'plugin_installed':
      case 'plugin_uninstalled':
        checkStatus();
        break;
        
      case 'plugin_error':
        const p = plugins.find(p => p.name === payload.pluginName);
        if (p) {
          p.status = 'error';
          p.error = payload.error;
        }
        renderPlugins();
        break;
        
      case 'plugin_list':
      case 'connection_changed':
        checkStatus();
        break;
    }
  }
});
