#!/usr/bin/env node
/**
 * 一键部署云函数 —— 走微信开发者工具自带的 CLI，省掉在 IDE 里逐个右键。
 *
 * 前提：开发者工具已启动，且「设置 → 安全设置 → 服务端口」已开启。
 *      （CLI 会明确提示这一点，没开的话按提示打开即可）
 *
 * 用法：
 *   npm run deploy:cf                 # 部署 cloudfunctions/ 下全部云函数
 *   npm run deploy:cf -- seed         # 只部署 seed
 *   npm run deploy:cf -- --list       # 列出云端已有的云函数
 *   CLOUD_ENV=xxx npm run deploy:cf   # 临时指定环境
 *
 * 环境 ID 默认从 miniprogram/constants/index.js 的 CLOUD_ENV 读取，避免两处维护。
 */
import { spawnSync } from 'node:child_process';
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

// 默认不传 --port：让 CLI 自己去发现 IDE 已开启的服务端口。
// 千万不要硬写 3799 —— IDE 每次启动分配的是随机端口，端口对不上 CLI 会要求重启 IDE。
// 只有在 IDE 尚未启动、想让它顺带拉起服务时才用 CLOUD_ENV/CLI_PORT 显式指定。
const port = process.env.CLI_PORT || '';
const PORT_ARGS = port ? ['--port', String(port)] : [];

const call = (argv) => {
  const r = spawnSync('cmd', ['/c', cli, ...argv, ...PORT_ARGS], { encoding: 'buffer' });
  const out = `${r.stdout ? r.stdout.toString('utf8') : ''}${r.stderr ? r.stderr.toString('utf8') : ''}`;
  return { out, code: r.status };
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * 部署单个函数，带重试。
 * 首次部署时云端要先「创建」函数，紧接着上传代码会撞上
 * FailedOperation.UpdateFunctionCode「当前函数处于Creating状态」——
 * 这不是代码问题，等几秒重跑即可（第二次走的是 update 分支）。
 * 另外首次返回的是函数名列表，不是 success 表格，故两种格式都要认。
 */
const deployOne = (name) => {
  const args = ['cloud', 'functions', 'deploy', '--env', env, '--names', name, '--project', ROOT, '-r'];
  let out = '';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    out = call(args).out;
    const creating = /Creating状态|FailedOperation\.UpdateFunctionCode/.test(out);
    const hasTable = /│\s*success\s*│/.test(out);
    const success = hasTable ? /│\s*true\s*│/.test(out) : !/\[error\]|×/.test(out);
    if (success) return { ok: true, out, attempt };
    if (creating && attempt < 4) {
      process.stdout.write(`(创建中，${attempt * 5}s 后重试) `);
      sleep(5000);
      continue;
    }
    return { ok: false, out, attempt };
  }
  return { ok: false, out, attempt: 4 };
};

console.log(`环境: ${env}`);
console.log(`CLI : ${cli}`);
console.log('');

if (listOnly) {
  const { out } = call(['cloud', 'functions', 'list', '--env', env, '--project', ROOT]);
  console.log(out.trim());
  process.exit(0);
}

const ok = [];
const bad = [];
for (const name of names) {
  process.stdout.write(`→ 部署 ${name} ... `);
  const { ok: good, out } = deployOne(name);
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
