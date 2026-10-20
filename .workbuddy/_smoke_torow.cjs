/**
 * 定向单测：dictionary-browse 的 toRow —— 同一函数要吃两种词条形态。
 *   cloud=true  云端词条 {word, definitions[], phonetic_uk, difficulty, frequency}
 *   cloud=false 本地词条 {w, ph, d}
 * 做法：按 import 传递闭包自动拷贝依赖（平铺 + 补 .mjs），
 * 页面源码把 Page({...}) 中和成普通对象字面量后追加 export。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-torow-'));
const copied = new Set();

/** 拷贝 rel 及其全部本地依赖到 TMP（平铺、.mjs），返回出口文件名。 */
function copyWithDeps(rel) {
  const base = path.basename(rel).replace(/\.js$/, '');
  if (copied.has(base)) return `${base}.mjs`;
  copied.add(base);
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = src.replace(/from '(\.[^']*)'/g, (mm, p) => {
    const abs = path.resolve(path.dirname(`${ROOT}/${rel}`), p).replace(/\\/g, '/');
    const jsPath = fs.existsSync(abs) ? abs : `${abs}.js`;
    if (!fs.existsSync(jsPath)) return mm; // 第三方包（node: 前缀不会进这个分支）
    const depRel = path.relative(ROOT, jsPath).replace(/\\/g, '/');
    return `from './${copyWithDeps(depRel)}'`;
  });
  fs.writeFileSync(path.join(TMP, `${base}.mjs`), out);
  return `${base}.mjs`;
}

['miniprogram/services/worddict.js',
  'miniprogram/services/libraries.js',
  'miniprogram/utils/theme.js',
].forEach(copyWithDeps);

// 页面源码：依赖先就位，再中和 Page({ 为对象字面量，追加 export
let page = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/dictionary-browse/dictionary-browse.js'), 'utf8');
page = page.replace(/from '(\.[^']*)'/g, (mm, p) => {
  const abs = path.resolve(`${ROOT}/miniprogram/pages/dictionary-browse`, p).replace(/\\/g, '/');
  const jsPath = fs.existsSync(abs) ? abs : `${abs}.js`;
  if (!fs.existsSync(jsPath)) return mm;
  return `from './${copyWithDeps(path.relative(ROOT, jsPath).replace(/\\/g, '/'))}'`;
});
page = page.replace('Page({', 'const __pageDef = {').replace(/\}\);\s*$/, '};');
page += '\nexport { toRow, seededShuffle, pad5, fmtNum };\n';
fs.writeFileSync(path.join(TMP, 'browse.mjs'), page);

const cloudIelts = {
  word: 'asthma', phonetic_uk: 'ˈæsmə', difficulty: 3, frequency: 2,
  definitions: [{ part_of_speech: 'n.', meaning: '哮喘', example: 'Cold air triggers asthma.', is_core: true }],
};
const cloudKyoyo = {
  word: 'abandon', difficulty: 2, frequency: 0,
  definitions: [{ part_of_speech: 'v.', meaning: '抛弃；放弃', example: 'They abandon the plan.' }],
};
const localEntry = { w: 'zinc', ph: 'ziŋk', d: 'n.锌;vt.镀锌' };

(async () => {
  const m = await import(pathToFileURL(path.join(TMP, 'browse.mjs')).href);
  const { toRow } = m;

  const a = toRow(cloudIelts, true);
  const b = toRow(cloudKyoyo, true);
  const c = toRow(localEntry, false);

  console.log('雅思云行:', JSON.stringify(a));
  console.log('考研云行:', JSON.stringify(b));
  console.log('本地行  :', JSON.stringify(c));

  const checks = [
    ['雅思云行：word/释义/音标', a.word === 'asthma' && a.meaning === '哮喘' && a.ph === 'ˈæsmə'],
    ['雅思云行：isLocal=false → 显示星/方', a.isLocal === false && a.stars === '★★★☆☆'],
    ['考研云行：无音标字段 → ph 空串', b.ph === '' && b.word === 'abandon'],
    ['考研云行：考频 0 → squares 空', b.squares === '□□□□□'],
    ['本地行：w/d/ph 取到', c.word === 'zinc' && c.meaning === 'n.锌;vt.镀锌' && c.ph === 'ziŋk'],
    ['本地行：isLocal=true → WXML 走音标分支', c.isLocal === true],
    ['本地行：难度缺省 3 → 三星', c.stars === '★★★☆☆'],
    ['key 全小写', a.key === 'asthma' && c.key === 'zinc'],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  checks.forEach(([n, ok]) => console.log(`${ok ? '✓' : '✗'} ${n}`));
  fs.rmSync(TMP, { recursive: true, force: true });
  if (failed.length) { console.error(`\n${failed.length} 项未过`); process.exit(1); }
  console.log('\ntoRow 单测通过');
})().catch((e) => { console.error('失败：', e); process.exit(1); });
