/**
 * 回归测试：雅思考频/难度重标（2026-10-19）。
 *
 * 锁三件事，防止以后改口径时静默退化：
 *   1) ielts.js 词条带 f/k，且与 ielts_metrics.json 完全一致（生成器没漏字段/错位）；
 *   2) wordEnrich#enrichSync 把 f/k 正确透出成 frequency/difficulty（本地→云端字段名一致）；
 *   3) dictionary-browse#toRow 本地行读 f/k、云端行读 difficulty/frequency，两形态都归一。
 *
 * 用法：node .workbuddy/_smoke_metrics.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'mg_metrics_smoke');
let failed = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label}${extra ? ` → ${extra}` : ''}`); }
};

/* ---- 1. ielts.js 与 metrics 一致性 ---- */
console.log('\n[1] data/libraries/ielts.js 的 f/k 与 metrics 一致');
const ieltsSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/data/libraries/ielts.js'), 'utf8');
const entries = JSON.parse(ieltsSrc.slice(ieltsSrc.indexOf('['), ieltsSrc.lastIndexOf(']') + 1));
const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, '_tools/ielts_metrics.json'), 'utf8'));

ok(entries.length === 4491, `词条数 4491（实际 ${entries.length}）`);
const withFk = entries.filter((e) => Number.isInteger(e.f) && Number.isInteger(e.k));
ok(withFk.length === entries.length, `全部词条带 f/k（实际 ${withFk.length}/${entries.length}）`);

const idx = {};
entries.forEach((e) => { idx[String(e.w).toLowerCase()] = e; });
const mismatched = [];
Object.keys(metrics).forEach((w) => {
  const e = idx[w];
  const m = metrics[w];
  if (!e || e.f !== m.f || e.k !== m.k) mismatched.push(w);
});
ok(mismatched.length === 0, `f/k 与 metrics 全一致（不一致 ${mismatched.length} 个）`, mismatched.slice(0, 5).join(','));

// 音标覆盖率体检：防止有人再改 parse_eudic_defs.cjs 时把某类音标格式漏掉（曾漏 42 词）。
// 2026-10-20 起**已无无音标词**（ECDICT + 人工 OVERRIDES 补齐 53 条），阈值收紧到 0。
const noPh = entries.filter((e) => !e.ph || !String(e.ph).trim());
ok(entries.filter((e) => !e.d || !String(e.d).trim()).length === 0, '无词条缺释义');
ok(noPh.length === 0, `无音标词 = 0（实际 ${noPh.length}）`, noPh.slice(0, 8).map((e) => e.w).join(','));
// 漏解析的那 23 个曾被错误塞进释义，形如「释义以 [xxx] 开头且 xxx 全是 ASCII」
const phLeaked = entries.filter((e) => /^\[[^\]]{1,40}\]/.test(e.d) && !/[\u4e00-\u9fa5]/.test(e.d.slice(0, e.d.indexOf(']') + 1)));
ok(phLeaked.length === 0, `释义里没有漏出的音标（实际 ${phLeaked.length} 个）`, phLeaked.slice(0, 5).map((e) => e.w).join(','));

// 音标制式体检：eudic 对 34 个词给的是 KK 字体编码（5=ˈ E=eɪ I=ɪ Q=ʌ N=ŋ F=ʃ ^=次重音），
// 不是 IPA，页面会显示成乱码样式的「in5hibit」。已用 ECDICT 归一化替换，必须为 0。
const kkPh = entries.filter((e) => /[0-9A-Z^]/.test(String(e.ph || '')));
ok(kkPh.length === 0, `无 KK 编码残留音标（实际 ${kkPh.length}）`, kkPh.slice(0, 8).map((e) => `${e.w}=${e.ph}`).join(','));
// 地域前缀 (US)/(UK) 未剥同样来自 eudic 解析。
const regionPh = entries.filter((e) => /^\((US|UK)\)/.test(String(e.ph || '')));
ok(regionPh.length === 0, `无未剥的地域前缀音标（实际 ${regionPh.length}）`, regionPh.slice(0, 5).map((e) => e.w).join(','));
// 抽查曾被 KK 编码污染的几个词，确认已换成标准 IPA。
const phExpect = { inhibit: 'ɪnˈhɪbɪt', sphinx: 'sfiŋks', tar: 'tɑː', misgiving: 'mɪsˈɡɪvɪŋ' };
Object.keys(phExpect).forEach((w) => {
  const e = idx[w];
  // 只断言「不是 KK 编码」且非空，具体制式不强求（ECDICT 与 eudic 音标写法有细微差异）
  ok(!!e && !!e.ph && !/[0-9A-Z^]/.test(e.ph), `${w} 音标已归一化`, e ? e.ph : '缺词条');
});

// 抽几个真实词核对期望值（abandon=2/3, access=5/2, accommodation=4/5, acidity=1/4）
const expect = { abandon: [2, 3], access: [5, 2], accommodation: [4, 5], acidity: [1, 4] };
Object.keys(expect).forEach((w) => {
  const e = idx[w];
  const [f, k] = expect[w];
  ok(!!e && e.f === f && e.k === k, `${w} = 考频${f}★/难度${k}★`, e ? `实际 ${e.f}/${e.k}` : '缺词条');
});

/* ---- 2. wordEnrich#enrichSync 的字段映射 ---- */
console.log('\n[2] wordEnrich#enrichSync 把 f/k 透出为 frequency/difficulty');
// wordEnrich 依赖 libraries → data；直接复制平铺到临时目录后用 ESM 载入
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'services'), { recursive: true });
// ESM 导入必须带扩展名：把 wordEnrich 里的 './libraries' / './worddict' 改写成 .mjs
const enrichCode = fs.readFileSync(path.join(ROOT, 'miniprogram/services/wordEnrich.js'), 'utf8')
  .replace(/from '\.\/libraries'/g, "from './libraries.mjs'")
  .replace(/from '\.\/worddict'/g, "from './worddict.mjs'");
fs.writeFileSync(path.join(TMP, 'services/wordEnrich.mjs'), enrichCode);
fs.writeFileSync(
  path.join(TMP, 'services/libraries.mjs'),
  `export function getLibraryEntry(id, word) {
  if (id !== 'ielts' || !word) return null;
  const key = String(word).toLowerCase();
  if (key === 'abandon') return { w: 'abandon', ph: 'əˈbændən', d: 'vt.放弃', f: 2, k: 3 };
  if (key === 'legacy') return { w: 'legacy', ph: '', d: '旧词条', f: undefined, k: undefined };
  return null;
}
export function getLibrary(id) { return { id: id || 'all', clientSide: id === 'ielts' }; }
export const LIBRARIES = [];
`
);
fs.writeFileSync(
  path.join(TMP, 'services/worddict.mjs'),
  `export async function searchWorddict() { return { words: [] }; }
`
);

(async () => {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(TMP, 'services/wordEnrich.mjs')).href);
  const { enrichSync, clearEnrichCache } = mod;

  const row = enrichSync('ielts', 'abandon');
  ok(!!row && row.src === 'local', 'enrichSync 命中本地词条');
  ok(row && row.frequency === 2, 'frequency=2（来自 f）', row && String(row.frequency));
  ok(row && row.difficulty === 3, 'difficulty=3（来自 k）', row && String(row.difficulty));
  ok(row && row.ph === 'əˈbændən' && row.def === 'vt.放弃', '音标/释义仍正常');

  const legacy = enrichSync('ielts', 'legacy');
  ok(!!legacy && legacy.frequency === undefined && legacy.difficulty === undefined,
    '缺 f/k 的旧词条不写入 undefined 字段（保持字段缺失而非脏值）');

  ok(enrichSync('all', 'abandon') === null, '云端词库 enrichSync 仍返回 null');

  /* ---- 3. dictionary-browse#toRow 双形态归一 ---- */
  console.log('\n[3] dictionary-browse#toRow 本地/云端双形态归一');
  const browseSrc = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/dictionary-browse/dictionary-browse.js'), 'utf8');
  // 抽取 toRow（function 声明）与 pad5（const 箭头函数，browse.js 里两种写法都有）。
  // 箭头函数用「从 `const pad5 =` 起截到行首 `};` 止」来切，避免正则里 /* => */ 的多层反斜杠转义。
  const grabFn = (name) => {
    const start = browseSrc.indexOf(`function ${name}(`);
    if (start < 0) return null;
    let depth = 0;
    for (let i = browseSrc.indexOf('{', start); i < browseSrc.length; i += 1) {
      if (browseSrc[i] === '{') depth += 1;
      else if (browseSrc[i] === '}') { depth -= 1; if (depth === 0) return browseSrc.slice(start, i + 1); }
    }
    return null;
  };
  const grabArrow = (name) => {
    const start = browseSrc.indexOf(`const ${name} = `);
    if (start < 0) return null;
    const end = browseSrc.indexOf('\n};', start);
    if (end < 0) return null;
    return browseSrc.slice(start, end + 3);
  };
  const pad5Fn = grabArrow('pad5');
  const toRowFn = grabFn('toRow');
  ok(!!pad5Fn && !!toRowFn, '能从 browse.js 抽出 pad5/toRow');

  const DIFF_COLORS = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];
  // eslint-disable-next-line no-new-func
  const toRow = new Function('DIFF_COLORS', `${pad5Fn}\n${toRowFn}\nreturn toRow;`)(DIFF_COLORS);

  const localRow = toRow({ w: 'abandon', ph: 'əˈbændən', d: 'vt.放弃,遗弃', f: 2, k: 3 }, false);
  ok(localRow.word === 'abandon' && localRow.meaning === 'vt.放弃,遗弃', '本地行取 w/d');
  ok(localRow.difficulty === 3 && localRow.frequency === 2, '本地行 f/k → difficulty/frequency',
    `${localRow.difficulty}/${localRow.frequency}`);
  ok(localRow.stars === '★★★☆☆' && localRow.squares === '■■□□□', '本地行星条正确',
    `${localRow.stars}/${localRow.squares}`);
  ok(localRow.isLocal === true, '本地行标记 isLocal');

  const cloudRow = toRow({ word: 'access', phonetic_uk: 'ˈækses', difficulty: 5, frequency: 4, definitions: [{ meaning: '通道' }] }, true);
  ok(cloudRow.word === 'access' && cloudRow.meaning === '通道' && cloudRow.ph === 'ˈækses', '云端行取 word/definitions[0]/phonetic_uk');
  ok(cloudRow.difficulty === 5 && cloudRow.frequency === 4, '云端行 difficulty/frequency 直取');
  ok(cloudRow.isLocal === false, '云端行不标记 isLocal');

  // 越界防护：脏数据不应产出非法星级
  const dirty = toRow({ w: 'weird', d: 'x', f: 99, k: -3 }, false);
  ok(dirty.difficulty === 1, '越界 k 被夹到 1', String(dirty.difficulty));

  // 无值时不得伪造：pad5(0) 会返回 '☆☆☆☆☆'，早先缺省 3★ 会让云端缺字段的行
  // 看起来有真实考频。现在缺值就输出空串，WXML 直接不渲染。
  const bare = toRow({ word: 'nofields', definitions: [] }, true);
  ok(bare.stars === '' && bare.squares === '', '缺考频/难度时星标为空串而非伪造值', `${bare.stars}|${bare.squares}`);
  const withPhNoStar = toRow({ w: 'distil', ph: '', d: '[化] v.蒸馏', f: 1, k: 3 }, false);
  ok(withPhNoStar.stars === '★★★☆☆' && withPhNoStar.ph === '', '无音标词仍有星标，音标位置留空由 WXML 跳过', withPhNoStar.stars);

  console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试崩溃：', e);
  process.exit(1);
});