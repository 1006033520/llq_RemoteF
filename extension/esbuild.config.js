/**
 * RemoteF Extension 构建配置
 * 使用 esbuild 打包 background 脚本
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const buildDir = join(__dirname, 'build');

// ===== 构建 background.js =====

const backgroundBuildOptions = {
  entryPoints: [join(srcDir, 'background.js')],
  bundle: true,
  outfile: join(buildDir, 'background.js'),
  format: 'iife',
  target: ['chrome100'],
  minify: false,
  sourcemap: true,
  logLevel: 'info',
};

// ===== 清理构建目录 =====

function cleanBuildDir() {
  if (existsSync(buildDir)) {
    const files = readdirSync(buildDir);
    for (const file of files) {
      const path = join(buildDir, file);
      if (statSync(path).isFile()) {
        if (file !== 'manifest.json') {
          // 不删除 manifest，手动管理
        }
      }
    }
  }
}

// ===== 复制静态文件 =====

function copyStaticFiles() {
  // 确保目录存在
  mkdirSync(buildDir, { recursive: true });

  // 复制 manifest.json
  copyFileSync(
    join(__dirname, 'manifest.json'),
    join(buildDir, 'manifest.json')
  );

  // 复制 popup
  const popupSrc = join(__dirname, 'popup');
  const popupDest = join(buildDir, 'popup');
  if (existsSync(popupSrc)) {
    mkdirSync(popupDest, { recursive: true });
    copyDir(popupSrc, popupDest);
  }

  // 复制 options
  const optionsSrc = join(__dirname, 'options');
  const optionsDest = join(buildDir, 'options');
  if (existsSync(optionsSrc)) {
    mkdirSync(optionsDest, { recursive: true });
    copyDir(optionsSrc, optionsDest);
  }

  // 复制 content
  const contentSrc = join(__dirname, 'content');
  const contentDest = join(buildDir, 'content');
  if (existsSync(contentSrc)) {
    mkdirSync(contentDest, { recursive: true });
    copyDir(contentSrc, contentDest);
  }

  // 复制 icons
  const iconsSrc = join(__dirname, 'icons');
  const iconsDest = join(buildDir, 'icons');
  if (existsSync(iconsSrc)) {
    mkdirSync(iconsDest, { recursive: true });
    copyDir(iconsSrc, iconsDest);
  }
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ===== 主构建函数 =====

async function build() {
  console.log('🔨 开始构建 RemoteF Extension...\n');

  // 清理并复制静态文件
  console.log('📁 复制静态文件...');
  copyStaticFiles();

  // 打包 background.js
  console.log('📦 打包 background.js...');
  try {
    await esbuild.build(backgroundBuildOptions);
    console.log('✅ background.js 打包完成\n');
  } catch (error) {
    console.error('❌ 打包失败:', error);
    process.exit(1);
  }

  console.log('✨ 构建完成！输出目录:', buildDir);
  console.log('\n📋 下一步:');
  console.log('   1. 在 Chrome 中打开 chrome://extensions/');
  console.log('   2. 启用"开发者模式"');
  console.log('   3. 点击"加载已解压的扩展程序"');
  console.log('   4. 选择 build 目录\n');
}

// ===== Watch 模式 =====

if (process.argv.includes('--watch')) {
  console.log('👀 监听模式已启动...\n');
  copyStaticFiles();

  const ctx = await esbuild.context(backgroundBuildOptions);
  await ctx.watch();

  // 监听静态文件变化
  const watcher = esbuild.build({
    ...backgroundBuildOptions,
    write: false,
    watch: {
      on档案Exists(path) {
        console.log('📁 文件变化:', path);
        copyStaticFiles();
      }
    }
  }).catch(() => {});

  console.log('🔄 文件变化将自动重新构建\n');
} else {
  build();
}
