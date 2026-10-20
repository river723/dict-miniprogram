/**
 * 一次性冒烟：在 Node 里真实加载 miniprogram 服务层模块图。
 * 小程序编译器允许无扩展名 import，Node ESM 不允许 —— 先拷贝到临时目录并补 .mjs。
 * 验证点：① 模块图能解析（import 链没写错）② L1 本地补全返回正确结构。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-smoke-'));

const files = [
  'miniprogram/services/libraries.js',
  'miniprogram/services/wordEnrich.js',
  'miniprogram/services/worddict.js',
  'miniprogram/services/cloud.js',
  'miniprogram/data/libraries/ielts.js',
];

files.forEach((f) => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // 所有文件平铺进 TMP：相对 import 一律改写成 ./<basename>.mjs
  const patched = src.replace(/from '(\.[^']*)'/g, (m, p) => {
    const abs = path.resolve(path.dirname(path.join(ROOT, f)), p);
    const base = path.basename(abs).replace(/\.js$/, ''); // 无扩展名 import 也能对上
    const known = files.some((ff) => path.basename(ff).replace(/\.js$/, '') === base);
    return known ? `from './${base}.mjs'` : m;
  });
  const dest = path.join(TMP, path.basename(f).replace(/\.js$/, '.mjs'));
  fs.writeFileSync(dest, patched);
});

(async () => {
  const lib = await import(pathToFileURL(path.join(TMP, 'libraries.mjs')).href);
  const enrich = await import(pathToFileURL(path.join(TMP, 'wordEnrich.mjs')).href);

  // ① 注册表
  console.log('LIBRARIES:', lib.LIBRARIES.map((l) => `${l.id}(${l.clientSide ? '本地' : '云端'})`).join(', '));
  console.log('getLibrary("bogus") →', lib.getLibrary('bogus').id, '（未知 id 回落 all）');

  // ② 本地词条
  const a = enrich.enrichSync('ielts', 'Abandon'); // 大写也要命中
  console.log('enrichSync("ielts","Abandon") →', JSON.stringify(a && { word: a.word, ph: a.ph, def: a.def.slice(0, 30), src: a.src }));
  console.log('enrichSync("all","abandon") →', enrich.enrichSync('all', 'abandon'), '（云端库本地无词条，应为 null）');
  console.log('enrichSync("ielts","zzzznotaword") →', enrich.enrichSync('ielts', 'zzzznotaword'), '（未命中为 null）');

  // ③ 词条数
  const words = lib.getLibraryWords('ielts');
  console.log('ielts 词数:', words.length);

  // ④ 批量接口可用性（本地层）
  const batch = await enrich.enrichBatch('ielts', words.slice(0, 5));
  console.log('enrichBatch 前 5 词:', Array.from(batch.entries()).map(([k, v]) => `${k}:${v ? v.src : 'null'}`).join(', '));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n冒烟通过');
})().catch((e) => {
  console.error('冒烟失败：', e);
  process.exit(1);
});
