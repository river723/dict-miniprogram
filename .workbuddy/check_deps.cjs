/**
 * 依赖解析校验：把小程序里所有「相对路径引用」全部解析一遍，
 * 确保开发者工具重新编译时不会出现 xxx not found。
 *
 * 覆盖范围：
 *   1. WXML 的 <wxs src> / <import src> / <include src>
 *   2. 页面 & 自定义组件 JSON 的 usingComponents
 *   3. app.json 的 pages / tabBar 图标 / window 资源
 *   4. JS 的 require() 相对路径（只管项目内，node_modules 跳过）
 *
 * 用法：node .workbuddy/check_deps.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MINI = path.join(ROOT, 'miniprogram');
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy']);

const missing = [];
const found = { wxs: 0, src: 0, components: 0, requires: 0, assets: 0, pages: 0 };

const exists = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
};
const existsDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
};

function report(kind, fromFile, target, resolvedPath) {
  missing.push({ kind, from: fromFile, target, resolved: resolvedPath });
}

function walk(dir, cb) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

// ---------- 1. WXML 资源引用 ----------
function checkWxml(file) {
  const src = fs.readFileSync(file, 'utf8');
  const base = path.dirname(file);
  const rel = path.relative(MINI, file).replace(/\\/g, '/');

  // <wxs src="..." module="..." /> 也允许 src 为单引号
  const wxsRe = /<wxs\b[^>]*?\bsrc=["']([^"']+)["']/g;
  let m;
  while ((m = wxsRe.exec(src)) !== null) {
    const t = m[1];
    if (/^(https?:)?\/\//.test(t)) continue;
    const rp = path.resolve(base, t);
    found.wxs += 1;
    if (!exists(rp)) report('wxs-src', rel, t, path.relative(MINI, rp).replace(/\\/g, '/'));
  }

  // <import src="..." /> / <include src="..." />
  const srcRe = /<(?:import|include|template)\b[^>]*?\bsrc=["']([^"']+)["']/g;
  while ((m = srcRe.exec(src)) !== null) {
    const t = m[1];
    if (/^(https?:)?\/\//.test(t)) continue;
    const rp = path.resolve(base, t);
    found.src += 1;
    if (!exists(rp)) report('wxml-src', rel, t, path.relative(MINI, rp).replace(/\\/g, '/'));
  }

  // 行号定位（辅助报错信息）
  src.split('\n').forEach((line, i) => {
    const mt = line.match(/<wxs\b[^>]*?\bsrc=["']([^"']+)["']/);
    if (mt && missing.length) {
      const last = missing[missing.length - 1];
      if (last.kind === 'wxs-src' && last.target === mt[1]) last.line = i + 1;
    }
  });
}

// ---------- 2. JSON 的 usingComponents ----------
/**
 * 解析组件/模块路径：小程序允许省略扩展名，
 * `/components/mg-icon/index` 实际指向 index.js / index.json / index.wxml / index.wxss 这一组。
 * 返回命中的实际文件名，全部未命中返回 null。
 */
const resolveTarget = (absPath) => {
  if (exists(absPath)) return absPath;
  for (const ext of ['.js', '.json', '.wxml', '.wxss', '.wxs']) {
    if (exists(absPath + ext)) return absPath + ext;
  }
  if (existsDir(absPath)) {
    for (const names of ['index.js', 'index.json', 'index.wxml', 'index.wxss']) {
      if (exists(path.join(absPath, names))) return path.join(absPath, names);
    }
  }
  return null;
};

function checkComponentsJson(file, label) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return;
  }
  const base = path.dirname(file);
  const uc = j.usingComponents || {};
  for (const tag of Object.keys(uc)) {
    const t = uc[tag];
    found.components += 1;
    if (/^plugin:\/\//.test(t)) continue;
    const absPath = t.startsWith('/') ? path.join(MINI, t) : path.resolve(base, t);
    const hit = resolveTarget(absPath);
    if (!hit) {
      report(
        t.startsWith('/') ? 'usingComponents(absolute)' : 'usingComponents',
        label,
        `${tag} -> ${t}`,
        path.relative(MINI, absPath).replace(/\\/g, '/')
      );
      continue;
    }
    // 组件至少要有一份 wxml，否则编译期会报 component not found
    const stem = hit.replace(/\.(js|json|wxml|wxss|wxs)$/, '');
    if (!exists(stem + '.wxml') && !existsDir(stem)) {
      report('usingComponents(no wxml)', label, `${tag} -> ${t}`, path.relative(MINI, stem).replace(/\\/g, '/'));
    }
  }
}

// ---------- 3. app.json ----------
function checkAppJson() {
  const file = path.join(MINI, 'app.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const p of j.pages || []) {
    found.pages += 1;
    for (const ext of ['.js', '.json', '.wxml']) {
      const rp = path.join(MINI, p + ext);
      if (!exists(rp)) report('app.json page', 'app.json', `${p}${ext}`, p + ext);
    }
    const wxss = path.join(MINI, p + '.wxss');
    if (!exists(wxss)) missing.push({ kind: 'app.json page(wxss,允许缺省)', from: 'app.json', target: p + '.wxss', resolved: p + '.wxss' });
  }

  const tb = j.tabBar || {};
  for (const it of tb.list || []) {
    if (it.pagePath && !(j.pages || []).includes(it.pagePath)) {
      report('tabBar pagePath 未注册', 'app.json', it.pagePath, it.pagePath);
    }
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (!it[key]) continue;
      found.assets += 1;
      const rp = path.join(MINI, it[key]);
      if (!exists(rp)) report(`tabBar ${key}`, 'app.json', it[key], it[key]);
    }
  }

  for (const sp of j.subPackages || j.subpackages || []) {
    for (const p of sp.pages || []) {
      found.pages += 1;
      const full = path.join(sp.root || '', p);
      if (!exists(path.join(MINI, full + '.wxml'))) report('subpackage page', 'app.json', `${full}.wxml`, `${full}.wxml`);
    }
  }
}

// ---------- 4. JS require 相对路径 ----------
function checkJsRequire(file) {
  const src = fs.readFileSync(file, 'utf8');
  const base = path.dirname(file);
  const rel = path.relative(MINI, file).replace(/\\/g, '/');
  // 同时支持 ESM: import x from './y' / import './y' / export * from './y'
  const re = /(?:\brequire\(\s*|from\s+)['"](\.[^'"]+)['"]/g;
  let m;
  let idx = 0;
  while ((m = re.exec(src)) !== null) {
    let t = m[1];
    idx += 1;
    found.requires += 1;
    let rp = path.resolve(base, t);
    if (exists(rp)) continue;
    // 允许省略扩展名
    let ok = false;
    for (const ext of ['.js', '.json', '.wxs']) {
      if (exists(rp + ext)) { ok = true; break; }
    }
    if (!ok && existsDir(rp) && exists(path.join(rp, 'index.js'))) ok = true;
    if (!ok) report('require', rel, t, path.relative(MINI, rp).replace(/\\/g, '/'));
  }
  void idx;
}

// ---------- 执行 ----------
walk(MINI, (f) => {
  const rel = path.relative(MINI, f).replace(/\\/g, '/');
  if (f.endsWith('.wxml')) checkWxml(f);
  else if (f.endsWith('.js')) checkJsRequire(f);
  else if (f.endsWith('.json') && (rel.startsWith('pages/') || rel.startsWith('components/'))) {
    checkComponentsJson(f, rel);
  }
});
checkAppJson();

// ---------- 输出 ----------
const realMissing = missing.filter((m) => !m.kind.includes('允许缺省'));
const softMissing = missing.filter((m) => m.kind.includes('允许缺省'));

console.log('=== 依赖解析校验 ===');
console.log(
  `已解析: wxs引用 ${found.wxs} · wxml引用 ${found.src} · 组件 ${found.components} · require ${found.requires} · 资源 ${found.assets} · 页面 ${found.pages}`
);
console.log(`硬缺失 ${realMissing.length} · 软缺失(页面无wxss,可接受) ${softMissing.length}`);

if (realMissing.length) {
  console.log('\n--- 缺失明细 ---');
  for (const m of realMissing) {
    console.log(`[${m.kind}] ${m.from}${m.line ? ':' + m.line : ''}`);
    console.log(`   引用 "${m.target}"  →  解析为 "${m.resolved}"（不存在）`);
  }
} else {
  console.log('\n全部引用均可解析，不存在 xxx not found。');
}
if (softMissing.length) {
  console.log('\n--- 缺 wxss 的页面（可接受，但建议补齐以免影响样式导入）---');
  softMissing.forEach((m) => console.log('  ' + m.target));
}

const out = path.join(__dirname, '_deps_report.json');
fs.writeFileSync(out, JSON.stringify({ ok: realMissing.length === 0, counts: found, missing: realMissing, soft: softMissing }, null, 2), 'utf8');
console.log(`\n报告已写入 ${out}`);
process.exit(realMissing.length ? 1 : 0);
