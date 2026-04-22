/**
 * 清理构建目录
 */

import { rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');

if (existsSync(buildDir)) {
  rmSync(buildDir, { recursive: true, force: true });
  console.log('✅ 已清理 build 目录');
} else {
  console.log('ℹ️ build 目录不存在，无需清理');
}
