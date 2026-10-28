/**
 * admin-guard 接线 —— 把权威源同步到各云函数目录。
 *
 * 为什么要同步而不是共用一份：微信云开发里每个云函数目录独立打包上传，
 * 运行时无法 require 兄弟目录的文件（`../_shared/x.js` 不可用）。
 * 所以需要鉴权的云函数各存一份副本，用本脚本保证它们永远一致。
 *
 * 用法：node .workbuddy/admin_wire.cjs           # 检查（dry-run），只报告差异
 *       node .workbuddy/admin_wire.cjs --apply   # 实际写入
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 权威源用 .cjs：项目根 package.json 是 "type": "module"，
// 而云函数目录下的 package.json 没有该字段（= CommonJS），
// 所以副本在云函数里必须叫 admin-guard.js 才能被 require('./admin-guard') 解析。
const SRC = path.join(ROOT, 'scripts', 'lib', 'admin-guard.cjs');
const DEST_NAME = 'admin-guard.js';
const TARGET_DIRS = ['seed', 'contentseed', 'setup', 'admin'];

const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(SRC)) {
  console.error(`✗ 权威源不存在：${SRC}`);
  process.exit(1);
}

const src = fs.readFileSync(SRC, 'utf8');
const report = [];

for (const dir of TARGET_DIRS) {
  const targetDir = path.join(ROOT, 'cloudfunctions', dir);
  if (!fs.existsSync(targetDir)) {
    report.push({ dir, status: 'missing-func-dir' });
    continue;
  }
  const dest = path.join(targetDir, DEST_NAME);
  const exists = fs.existsSync(dest);
  const same = exists && fs.readFileSync(dest, 'utf8') === src;
  if (same) {
    report.push({ dir, status: 'ok' });
    continue;
  }
  if (APPLY) {
    fs.writeFileSync(dest, src, 'utf8');
    report.push({ dir, status: exists ? 'updated' : 'created' });
  } else {
    report.push({ dir, status: exists ? 'differs' : 'missing' });
  }
}

const bad = report.filter((r) => !['ok', 'updated', 'created'].includes(r.status));

console.log(`权威源: ${path.relative(ROOT, SRC)}`);
console.log(`目标  : ${TARGET_DIRS.join(', ')}`);
console.log('');
for (const r of report) {
  const mark = ['ok', 'updated', 'created'].includes(r.status) ? '✓' : '✗';
  console.log(`  ${mark} ${r.dir.padEnd(14)} ${r.status}`);
}
console.log('');

if (bad.length) {
  if (APPLY) {
    console.error(`✗ 有 ${bad.length} 个目标未就绪（云函数目录不存在？）`);
    process.exit(1);
  }
  console.log('→ 有差异，执行 `node .workbuddy/admin_wire.cjs --apply` 同步');
  process.exit(1);
}

console.log(APPLY ? '✓ 已同步' : '✓ 全部一致');
