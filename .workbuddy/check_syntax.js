/**
 * 语法校验：对 miniprogram 下所有 .js 跑 `node --check`，所有 .json 做 JSON.parse。
 * 结果写入 .workbuddy/_check_report.json（stdout 在本环境抓不到）。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const OUT = path.join(__dirname, '_check_report.json');

const jsFiles = [];
const jsonFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.js')) jsFiles.push(p);
    else if (entry.name.endsWith('.json')) jsonFiles.push(p);
  }
}
walk(ROOT);

const jsErrors = [];
const jsonErrors = [];

for (const f of jsFiles) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    jsErrors.push({ file: path.relative(ROOT, f), error: (r.stderr || '').split('\n').slice(0, 6).join('\n').trim() });
  }
}

for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    jsonErrors.push({ file: path.relative(ROOT, f), error: String(e.message) });
  }
}

const report = {
  js_checked: jsFiles.length,
  js_errors: jsErrors,
  json_checked: jsonFiles.length,
  json_errors: jsonErrors,
  ok: jsErrors.length === 0 && jsonErrors.length === 0,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');
process.exit(0);
