/**
 * 校验：miniprogram 下所有 .js 跑 `node --check`，所有 .json 做 JSON.parse，
 * WXML 检查 {{ }} 配对，WXSS 检查 {} 配对；
 * 额外检查：
 *   - app.json 里每个 page 是否四件套（js/json/wxml/wxss）齐备；
 *   - app.json tabBar 的 iconPath / selectedIconPath 是否存在；
 *   - 每个 json 的 usingComponents 路径是否能解析到组件（*.json 存在）；
 *   - 页面 js 里出现 "/pages/xxx/yyy" 字符串是否都在 app.json 的 pages 列表中。
 * 结果写入 .workbuddy/_check_report.json（stdout 在本环境抓不到）。
 * 注意用 .cjs：项目 package.json 是 "type": "module"。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const OUT = path.join(__dirname, '_check_report.json');

const jsFiles = [];
const jsonFiles = [];
const wxmlFiles = [];
const wxssFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.js')) jsFiles.push(p);
    else if (entry.name.endsWith('.json')) jsonFiles.push(p);
    else if (entry.name.endsWith('.wxml')) wxmlFiles.push(p);
    else if (entry.name.endsWith('.wxss')) wxssFiles.push(p);
  }
}
walk(ROOT);

const jsErrors = [];
const jsonErrors = [];
const wxmlWarnings = [];
const wxssWarnings = [];
const structureErrors = [];

for (const f of jsFiles) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    jsErrors.push({
      file: path.relative(ROOT, f),
      error: (r.stderr || '').split('\n').slice(0, 8).join('\n').trim(),
    });
  }
}

for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    jsonErrors.push({ file: path.relative(ROOT, f), error: String(e.message) });
  }
}

for (const f of wxmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const open = (src.match(/\{\{/g) || []).length;
  const close = (src.match(/\}\}/g) || []).length;
  if (open !== close) {
    wxmlWarnings.push({ file: path.relative(ROOT, f), error: `{{ }} 不配对: ${open} vs ${close}` });
  }
}

for (const f of wxssFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  if (open !== close) {
    wxssWarnings.push({ file: path.relative(ROOT, f), error: `{} 不配对: ${open} vs ${close}` });
  }
}

// ---------- app.json 结构 ----------
let appJson = null;
try {
  appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
} catch (e) {
  structureErrors.push({ file: 'app.json', error: '无法解析' });
}

const abs = (rel) => path.join(ROOT, rel.replace(/^\//, ''));

if (appJson) {
  for (const page of appJson.pages || []) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const p = path.join(ROOT, `${page}.${ext}`);
      if (!fs.existsSync(p)) structureErrors.push({ file: `${page}.${ext}`, error: `页面缺少 ${ext} 文件` });
    }
  }

  for (const item of (appJson.tabBar && appJson.tabBar.list) || []) {
    if (item.pagePath && !(appJson.pages || []).includes(item.pagePath)) {
      structureErrors.push({ file: 'app.json', error: `tabBar 页面不在 pages 列表: ${item.pagePath}` });
    }
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (item[key] && !fs.existsSync(abs(item[key]))) {
        structureErrors.push({ file: item[key], error: `tabBar 图标不存在（${item.text}）` });
      }
    }
  }
}

// ---------- usingComponents 解析 ----------
for (const f of jsonFiles) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const uc = j.usingComponents;
  if (!uc || typeof uc !== 'object') continue;
  for (const [name, target] of Object.entries(uc)) {
    const base = target.startsWith('/') ? abs(target) : path.resolve(path.dirname(f), target);
    if (!fs.existsSync(`${base}.json`) || !fs.existsSync(`${base}.wxml`)) {
      structureErrors.push({
        file: path.relative(ROOT, f),
        error: `usingComponents["${name}"] 解析不到组件: ${target}`,
      });
    }
  }
}

// ---------- 页面跳转目标 ----------
const declaredPages = new Set((appJson && appJson.pages) || []);
const navRe = /['"`]\/?(pages\/[A-Za-z0-9_\-/]+?)(\?[^'"`]*)?['"`]/g;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = navRe.exec(src)) !== null) {
    const target = m[1];
    if (!declaredPages.has(target)) {
      structureErrors.push({
        file: path.relative(ROOT, f),
        error: `跳转目标未在 app.json 注册: /${target}`,
      });
    }
  }
}

// ---------- 图标名是否在字体子集内 ----------
const iconWarnings = [];
let iconKeys = new Set();
try {
  const iconsSrc = fs.readFileSync(path.join(ROOT, 'theme', 'icons.js'), 'utf8');
  const block = iconsSrc.slice(iconsSrc.indexOf('const ICONS'), iconsSrc.indexOf('function iconChar'));
  let m;
  const keyRe = /'([a-z0-9-]+)':/g;
  while ((m = keyRe.exec(block)) !== null) iconKeys.add(m[1]);

  // 码位防回归检查。
  // 背景：JS 的 \uXXXX 转义只吃 4 位，'\uf0708' 会被解析成 U+F070 + 字符 '8'，
  // 图标就渲染成「豆腐块 + 字母」；补充平面字符配合 WebView 自定义字体的渲染
  // 在部分机型上也不可靠。所以图标码位必须全部落在 BMP 内。
  // 若这里报错，重跑 .workbuddy/build_icons.py 重新生成即可（它已做 BMP 重映射）。
  const badCp = [];
  const escRe = /'([a-z0-9-]+)':\s*'\\u([0-9a-fA-F]+)'/g;
  let mm;
  while ((mm = escRe.exec(block)) !== null) {
    if (mm[2].length !== 4) badCp.push(mm[1] + '=\\u' + mm[2]);
  }
  const litRe = /'([a-z0-9-]+)':\s*'([^'\\]+)'/g;
  while ((mm = litRe.exec(block)) !== null) {
    for (const ch of mm[2]) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) badCp.push(mm[1] + '=U+' + cp.toString(16));
    }
  }
  if (badCp.length) {
    iconWarnings.push({
      file: 'theme/icons.js',
      error:
        '图标码位超出 BMP（需重跑 build_icons.py 重映射）: ' +
        badCp.slice(0, 5).join(', ') +
        (badCp.length > 5 ? ' 等 ' + badCp.length + ' 个' : ''),
    });
  }
} catch {
  iconWarnings.push({ file: 'theme/icons.js', error: '无法读取图标表' });
}

const iconRefs = new Map(); // name -> [files]
/** wx.showToast 的 icon 取值（none/success/loading/error），不是图标字体名，排除。 */
const TOAST_ICONS = new Set(['none', 'success', 'loading', 'error', 'fail', 'exception']);
const addRef = (name, file) => {
  if (!name || TOAST_ICONS.has(name)) return;
  if (!iconRefs.has(name)) iconRefs.set(name, []);
  iconRefs.get(name).push(file);
};

for (const f of wxmlFiles) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  // 静态属性：name="xxx" / icon="xxx"（跳过含 {{ }} 的动态值）
  const attrRe = /\b(?:name|icon)="([a-zA-Z0-9-]+)"/g;
  let m;
  while ((m = attrRe.exec(src)) !== null) addRef(m[1], rel);
  // 动态三元里的静态图标名，例如 name="{{playing ? 'volume-high' : 'ear-hearing'}}"
  // 只取三元分支的字面量（? 'a' : 'b'）；若把整个表达式里的字符串都当图标名，
  // 条件里的比较值（如 filter === 'real'）会被误报为缺失图标。
  const ternaryRe = /\b(?:name|icon)="\{\{[^}]*\}\}"/g;
  while ((m = ternaryRe.exec(src)) !== null) {
    const inner = m[0];
    const branchRe = /\?\s*'([a-zA-Z0-9-]+)'\s*:\s*'([a-zA-Z0-9-]+)'/g;
    let s;
    while ((s = branchRe.exec(inner)) !== null) {
      addRef(s[1], rel);
      addRef(s[2], rel);
    }
  }
}

for (const f of jsFiles) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  // icon: 'xxx' / icon: "xxx"
  const jsRe = /\bicon:\s*['"]([a-zA-Z0-9-]+)['"]/g;
  let m;
  while ((m = jsRe.exec(src)) !== null) addRef(m[1], rel);
}

for (const [name, files] of iconRefs) {
  if (!iconKeys.has(name)) {
    iconWarnings.push({
      file: [...new Set(files)].join(', '),
      error: `图标名不在字体子集内，会退化为 fallback：${name}`,
    });
  }
}

const report = {
  js_checked: jsFiles.length,
  js_errors: jsErrors,
  json_checked: jsonFiles.length,
  json_errors: jsonErrors,
  wxml_checked: wxmlFiles.length,
  wxml_warnings: wxmlWarnings,
  wxss_checked: wxssFiles.length,
  wxss_warnings: wxssWarnings,
  structure_errors: structureErrors,
  icon_names_referenced: iconRefs.size,
  icon_warnings: iconWarnings,
  ok:
    jsErrors.length === 0 &&
    jsonErrors.length === 0 &&
    wxmlWarnings.length === 0 &&
    wxssWarnings.length === 0 &&
    structureErrors.length === 0 &&
    iconWarnings.length === 0,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');
process.exit(0);
