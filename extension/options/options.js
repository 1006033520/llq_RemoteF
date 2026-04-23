/**
 * RemoteF 设置页面
 */

console.log('[RemoteF] options.js loaded');

// i18n 辅助
function msg(key) {
  return chrome.i18n.getMessage(key) || key;
}

const CONFIG_KEY = 'remotef_config';

// 获取元素
const serverUrlInput = document.getElementById('server-url');
const clientNameInput = document.getElementById('client-name');
const autoConnectCheckbox = document.getElementById('auto-connect');
const saveBtn = document.getElementById('save-btn');
const connectBtn = document.getElementById('connect-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const alertContainer = document.getElementById('alert-container');

// 保存配置
async function saveConfig() {
  const config = {
    serverUrl: serverUrlInput.value.trim(),
    clientName: clientNameInput.value.trim(),
    autoConnect: autoConnectCheckbox.checked
  };
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  console.log('[RemoteF] 配置已保存:', config);
  return config;
}

// 检查状态
async function checkStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'get_status' });
    console.log('[RemoteF] 状态:', status);
    if (status && status.isConnected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = msg('statusConnected');
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = msg('statusDisconnected');
    }
  } catch (err) {
    console.error('[RemoteF] 状态检查失败:', err);
    statusDot.className = 'status-dot error';
    statusText.textContent = msg('statusChecking');
  }
}

// 提示
function showAlert(message, type) {
  alertContainer.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
  setTimeout(() => { alertContainer.innerHTML = ''; }, 3000);
}

// 加载配置
async function loadConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const config = result[CONFIG_KEY] || {};
  serverUrlInput.value = config.serverUrl || '';
  clientNameInput.value = config.clientName || '';
  autoConnectCheckbox.checked = config.autoConnect !== false;
}

// 保存按钮
saveBtn.addEventListener('click', async () => {
  console.log('[RemoteF] 点击保存');
  try {
    await saveConfig();
    showAlert(msg('configSaved') || 'Config saved', 'success');
  } catch (err) {
    console.error('[RemoteF] 保存失败:', err);
    showAlert(msg('saveFailed') || 'Save failed', 'error');
  }
});

// 连接按钮
connectBtn.addEventListener('click', async () => {
  console.log('[RemoteF] 点击连接');
  connectBtn.disabled = true;
  connectBtn.textContent = msg('statusConnecting');

  try {
    // 先保存配置
    await saveConfig();

    // 发送连接请求
    console.log('[RemoteF] 发送 connect 消息');
    const result = await chrome.runtime.sendMessage({ type: 'connect' });
    console.log('[RemoteF] connect 响应:', result);

    showAlert(msg('connectSent') || 'Connect request sent', 'success');

    // 2秒后检查状态
    setTimeout(() => {
      checkStatus();
      connectBtn.disabled = false;
      connectBtn.textContent = msg('connectNow');
    }, 2000);
  } catch (err) {
    console.error('[RemoteF] 连接失败:', err);
    showAlert(msg('connectFailed') + ': ' + err.message, 'error');
    connectBtn.disabled = false;
    connectBtn.textContent = msg('connectNow');
  }
});

// 初始化
loadConfig();
checkStatus();
setInterval(checkStatus, 5000);

console.log('[RemoteF] 初始化完成');
