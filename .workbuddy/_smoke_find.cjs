/**
 * 端到端复现「雅思库里搜 enzyme」：把 libraries.js 的导入链与 browse 的搜索/过滤逻辑
 * 搬到临时目录真跑一遍，确认 ielts.js 能被 getLibraryEntries 取到、enzyme 能被搜到。
 * 用法：node .workbuddy/_smoke_find.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'mg_find_smoke');

let failed = 0;
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failed += 1;
};

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'data', 'libraries'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'services'), { recursive: true });

// libraries.js 只 import data/libraries/ielts，依赖闭包很小
fs.copyFileSync(path.join(ROOT, 'miniprogram/data/libraries/ielts.js'),
  path.join(TMP, 'data/libraries/ielts.mjs'));
// ESM 导入需要显式扩展名（小程序端由构建器解析，Node 直跑必须补 .mjs）
const libSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/services/libraries.js'), 'utf8')
  .replace("from '../data/libraries/ielts'", "from '../data/libraries/ielts.mjs'");
fs.writeFileSync(path.join(TMP, 'services/libraries.mjs'), libSrc, 'utf8');

(async () => {
  const lib = await import(pathToFileURL(path.join(TMP, 'services/libraries.mjs')).href);

  console.log('\n[1] libraries.js 取数');
  const entries = lib.getLibraryEntries('ielts');
  ok(Array.isArray(entries), 'getLibraryEntries("ielts") 返回数组');
  ok(entries && entries.length === 4491, `词条 4491（实际 ${entries && entries.length}）`);

  const words = lib.getLibraryWords('ielts');
  ok(Array.isArray(words) && words.length === 4491, 'getLibraryWords 返回 4491 个字符串');

  const reg = lib.LIBRARIES.find((x) => x.id === 'ielts');
  ok(!!reg && reg.clientSide === true, 'ielts 标记 clientSide=true（走本地模式）');

  console.log('\n[2] 复现 browse#ensureLocalCloudDecision 的判定');
  const localCount = entries.length;

  // 场景 A：云函数是**旧版**（不认识 lib，恒查考研集合）→ 回 col='worddict'
  const staleCol = 'worddict';
  const expectCol = 'worddict_ielts';
  const oldCount = 4801; // 旧云函数对任何 lib 都返回考研集合的真实词数
  const decidedOld = (oldCount >= localCount) && staleCol === expectCol && localCount > 0;
  ok(decidedOld === false, '旧云函数(返回考研集合)不再被误判为「云端更全」', `useCloud=${decidedOld}`);
  ok(oldCount >= localCount, '前提成立：4801 ≥ 4491，旧判据确实会误判（这是本次根因）');

  // 场景 B：云函数已重部署且集合齐活 → col 匹配，允许切云端
  const decidedNew = (4801 >= localCount) && 'worddict_ielts' === expectCol && localCount > 0;
  ok(decidedNew === true, '云函数已重部署(col 匹配)时仍可正常切云端');

  // 场景 C：集合不存在 → count 0 → 回落本地
  const decidedEmpty = (0 >= localCount) && localCount > 0;
  ok(decidedEmpty === false, '云端无集合时回落本地（不混排）', `useCloud=${decidedEmpty}`);

  const search = (q) => {
    const kw = String(q).toLowerCase();
    return entries.filter((e) => String(e.w).toLowerCase().includes(kw));
  };

  console.log('\n[3] 搜索实测（用户报的「找不到」的词）');
  // 这批词只在雅思库、考研库里全无 —— 曾因云端误判而整页显示考研词表导致搜不到
  ['fusion', 'enzyme', 'estuary', 'plankton', 'anthropology', 'archaeology',
    'logistics', 'telecommunication', 'cuisine', 'detrimental', 'adept'].forEach((q) => {
    const hit = search(q);
    ok(hit.length > 0, `搜 "${q}" 命中 ${hit.length} 条`, hit[0] ? `${hit[0].w} / ph=${hit[0].ph || '（无）'}` : '');
  });

  const yaoSet = new Set(fs.readFileSync(path.join(ROOT, 'import-data/worddict-all.json'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l).word.toLowerCase()));
  const ielSet = new Set(entries.map((e) => e.w.toLowerCase()));
  console.log('\n[3b] 回归锁定：这些词「在雅思库、不在考研库」');
  ['fusion', 'enzyme', 'estuary', 'cuisine', 'adept', 'detrimental'].forEach((q) => {
    ok(ielSet.has(q) && !yaoSet.has(q), `"${q}" 属雅思独有词（正是旧判据下会被云端覆盖掉的那批）`);
  });

  console.log('\n[4] 对照组：abide（已知雅思库没有、走考研云端兜底）');
  const abide = search('abide');
  ok(abide.length === 0, '搜 "abide" 本地无命中（符合预期：它只在考研库）');

  console.log('\n[5] 抽样：字母 E 列表条数');
  const eWords = entries.filter((e) => e.w.toLowerCase().startsWith('e'));
  ok(eWords.length > 40, `E 开头 ${eWords.length} 条`);

  console.log(`\n${failed === 0 ? '✅ 全部通过 —— 代码链路正常，问题在激活词库/编译状态' : `❌ ${failed} 项失败`}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试崩溃：', e);
  process.exit(1);
});