#!/usr/bin/env node
/**
 * 一键部署云函数 —— 走微信开发者工具自带的 CLI，省掉在 IDE 里逐个右键。
 *
 * 前提：开发者工具已启动，且「设置 → 安全设置 → 服务端口」已开启
 *      （CLI 首次会自动拉起 IDE 本地服务端口，一般无需手动开）。
 *
 * 用法：
 *   npm run deploy:cf                 # 部署 cloudfunctions/ 下全部云函数
 *   npm run deploy:cf -- seed         # 只部署 seed
 *   npm run deploy:cf -- --list       # 列出云端已有的云函数
 *   CLOUD_ENV=xxx npm run deploy:cf   # 临时指定环境
 *
 * 环境 ID 默认从 miniprogram/constants/index.js 的 CLOUD_ENV 读取，避免两处维护。
 *
 * ⚠️ 实现说明：本机 spawnSync(cmd) 会稳定 EBUSY 失败，且 spawn 的 argv 引号转义会把
 *    "Program Files" 路径拆坏。故这里统一用 exec + 整串带引号命令，是已知唯一可靠路径。
 */
import { exec } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CLI_CANDIDATES = [
  process.env.WECHAT_DEVTOOLS_CLI,
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  'D:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'D:/Program Files/Tencent/微信web开发者工具/cli.bat',
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
];

const cli = CLI_CANDIDATES.filter(Boolean).find((p) => existsSync(p));
if (!cli) {
  console.error('✗ 找不到开发者工具 CLI。请设置环境变量 WECHAT_DEVTOOLS_CLI 指向 cli.bat');
  process.exit(1);
}

const constantsPath = join(ROOT, 'miniprogram', 'constants', 'index.js');
const envMatch = existsSync(constantsPath)
  ? readFileSync(constantsPath, 'utf8').match(/CLOUD_ENV\s*=\s*['"]([^'"]+)['"]/)
  : null;
const env = process.env.CLOUD_ENV || (envMatch && envMatch[1]);
if (!env) {
  console.error('✗ 没找到云环境 ID，请先设置 miniprogram/constants/index.js 的 CLOUD_ENV');
  process.exit(1);
}

const dir = join(ROOT, 'cloudfunctions');
const all = readdirSync(dir).filter((n) => existsSync(join(dir, n, 'index.js')));
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const wanted = args.filter((a) => !a.startsWith('-'));
const names = wanted.length ? wanted : all;

const port = process.env.CLI_PORT || '';
const PORT_PART = port ? ` --port ${port}` : '';

/** 用 exec + 整串带引号命令调用 CLI（避开 spawnSync 的 EBUSY 与 argv 引号转义坑）。 */
const call = (sub) =>
  new Promise((resolve) => {
    const cmd = `"${cli}" ${sub}${PORT_PART}`;
    exec(cmd, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      resolve({ out, code: err ? err.code : 0 });
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 部署单个函数，带重试。
 * 首次部署云端要先「创建」函数，紧接着上传代码会撞上
 * FailedOperation.UpdateFunctionCode「当前函数处于Creating状态」——等几秒重跑即可。
 */
const deployOne = async (name) => {
  const sub = `cloud functions deploy --env ${env} --names ${name} --project ${ROOT} -r`;
  let last = { out: '', code: 0 };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    last = await call(sub);
    const out = last.out;
    if (!out.trim()) {
      // 空输出 = CLI 没连上 IDE（端口未开 / 项目未打开），判失败而非假成功。
      if (attempt < 4) {
        process.stdout.write(`(CLI 无响应，${attempt * 3}s 后重试) `);
        await sleep(3000);
        continue;
      }
      return { ok: false, out };
    }
    const creating = /Creating状态|FailedOperation\.UpdateFunctionCode/.test(out);
    const hasTable = /│\s*success\s*│/.test(out);
    const ok = hasTable ? /│\s*true\s*│/.test(out) : !/\[error\]|×/.test(out);
    if (ok) return { ok: true, out };
    if (creating && attempt < 4) {
      process.stdout.write(`(创建中，${attempt * 5}s 后重试) `);
      await sleep(5000);
      continue;
    }
    return { ok: false, out };
  }
  return { ok: false, out: last.out };
};

console.log(`环境: ${env}`);
console.log(`CLI : ${cli}`);
console.log('');

if (listOnly) {
  const { out, code } = await call(`cloud functions list --env ${env} --project ${ROOT}`);
  if (!out.trim()) {
    console.error('✗ CLI 返回空输出（exit=' + code + '）。通常是：IDE 未运行 / 服务端口未开启 / 项目未打开。');
    process.exit(2);
  }
  console.log(out.trim());
  process.exit(0);
}

const ok = [];
const bad = [];
for (const name of names) {
  process.stdout.write(`→ 部署 ${name} ... `);
  const { ok: good, out } = await deployOne(name);
  if (good) {
    ok.push(name);
    console.log('✓');
  } else {
    bad.push(name);
    console.log('✗');
    console.log(out.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  }
}

console.log('');
console.log(`完成：成功 ${ok.length} 个${ok.length ? `（${ok.join('、')}）` : ''}${bad.length ? `，失败 ${bad.length} 个（${bad.join('、')}）` : ''}`);
if (bad.length) {
  console.log('');
  console.log('排查提示：');
  console.log('  1. 开发者工具必须在运行，且「设置 → 安全设置 → 服务端口」已开启');
  console.log('  2. 报 FUNCTION_NOT_FOUND 说明还没部署成功，不是代码问题');
  console.log('  3. 超时/网络错误可重跑；单个函数也可 npm run deploy:cf -- <名字>');
  process.exit(1);
}
