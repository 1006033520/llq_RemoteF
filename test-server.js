/**
 * RemoteF 本地测试服务器
 * 
 * 功能：
 * 1. 托管测试页面（http://localhost:8080）
 * 2. 提供 mock API 接口供测试页面调用（GET/POST/PUT/DELETE）
 * 3. 模拟延迟和错误响应
 * 
 * 用法：node test-server.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.TEST_PORT || 8888;

// 简单的 JSON 解析
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(body); }
    });
  });
}

// 发送 JSON 响应
function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// 请求计数器
const stats = { total: 0, get: 0, post: 0, put: 0, delete: 0 };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // 托管测试页面
  if (url.pathname === '/' || url.pathname === '/test-page.html') {
    const htmlPath = path.join(__dirname, 'test-page.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 统计接口
  if (url.pathname === '/api/stats') {
    sendJson(res, { stats, uptime: process.uptime() });
    return;
  }

  // Mock API - GET
  if (url.pathname === '/api/get' && method === 'GET') {
    stats.get++;
    stats.total++;
    sendJson(res, {
      method: 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      timestamp: Date.now(),
      message: 'GET 请求成功'
    });
    return;
  }

  // Mock API - POST
  if (url.pathname === '/api/post' && method === 'POST') {
    stats.post++;
    stats.total++;
    const body = await parseBody(req);
    sendJson(res, {
      method: 'POST',
      path: url.pathname,
      body,
      timestamp: Date.now(),
      message: 'POST 请求成功'
    });
    return;
  }

  // Mock API - PUT
  if (url.pathname === '/api/put' && method === 'PUT') {
    stats.put++;
    stats.total++;
    const body = await parseBody(req);
    sendJson(res, {
      method: 'PUT',
      path: url.pathname,
      body,
      timestamp: Date.now(),
      message: 'PUT 请求成功'
    });
    return;
  }

  // Mock API - DELETE
  if (url.pathname === '/api/delete' && method === 'DELETE') {
    stats.delete++;
    stats.total++;
    sendJson(res, {
      method: 'DELETE',
      path: url.pathname,
      timestamp: Date.now(),
      message: 'DELETE 请求成功'
    });
    return;
  }

  // Mock API - 模拟延迟
  if (url.pathname === '/api/slow') {
    const delay = parseInt(url.searchParams.get('ms') || '1000');
    stats.total++;
    stats.get++;
    setTimeout(() => {
      sendJson(res, { method: 'GET', path: url.pathname, delay, timestamp: Date.now() });
    }, delay);
    return;
  }

  // Mock API - 模拟错误
  if (url.pathname === '/api/error') {
    stats.total++;
    const code = parseInt(url.searchParams.get('code') || '500');
    sendJson(res, { error: '模拟服务器错误', code }, code);
    return;
  }

  // Mock API - 大数据响应
  if (url.pathname === '/api/large') {
    stats.total++;
    stats.get++;
    const count = parseInt(url.searchParams.get('count') || '100');
    const items = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 1000,
      active: Math.random() > 0.5
    }));
    sendJson(res, { count, items });
    return;
  }

  // 404
  sendJson(res, { error: 'Not Found', path: url.pathname }, 404);
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║         RemoteF 测试服务器已启动                 ║
╠═══════════════════════════════════════════════════╣
║  测试页面:  http://localhost:${PORT}                ║
║  API 接口:                                        ║
║    GET    http://localhost:${PORT}/api/get            ║
║    POST   http://localhost:${PORT}/api/post           ║
║    PUT    http://localhost:${PORT}/api/put            ║
║    DELETE http://localhost:${PORT}/api/delete         ║
║    慢速  http://localhost:${PORT}/api/slow?ms=2000    ║
║    错误  http://localhost:${PORT}/api/error?code=500  ║
║    大数据 http://localhost:${PORT}/api/large?count=500 ║
║    统计  http://localhost:${PORT}/api/stats           ║
╚═══════════════════════════════════════════════════╝
  `);
});
