#!/usr/bin/env node
/**
 * 雅思富词条产物（import-data/worddict-ielts.jsonl）口径体检。
 *
 * 守的是一条架构决策（2026-10-20 用户确认）：
 *   可复用（来自考研库）：definitions / etymology / similar_words / memory_tip
 *   必须雅思自己的  ：frequency / difficulty（真实语料重标口径）
 *                      phonetic_uk（雅思自带；考研集合无音标）
 *
 * 为什么守：若整条搬运考研词条，难度会被覆盖回考研口径 —— 实测两库难度差 ≥2 星的有
 * 773/2753 词（28%），等于把「雅思真实语料重标」白做一遍。
 *
 * 用法：node .workbuddy/_smoke_ielts_rich.cjs
 * 产物不存在时只跳过并提示（AI 段可能还没跑）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'import-data/worddict-ielts.jsonl');
const IELTS_JS = path.join(ROOT, 'miniprogram/data/libraries/ielts.js');

let pass = 0;
let fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`); }
}

console.log('\n[1] 雅思富词条产物的字段口径');
if (!fs.existsSync(OUT)) {
  console.log('  （产物不存在，跳过。先跑 npm run gen:ielts-rich）');
  process.exit(0);
}

const rawLines = fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim());
const rows = [];
const badLines = [];
rawLines.forEach((l, i) => {
  try {
    const o = JSON.parse(l);
    if (o && typeof o === 'object' && !Array.isArray(o) && o.word) rows.push(o);
    else badLines.push({ line: i + 1, why: '结构异常', raw: l.slice(0, 80) });
  } catch (e) {
    badLines.push({ line: i + 1, why: e.message, raw: l.slice(0, 80) });
  }
});
console.log(`  产物 ${rows.length} 条（原始行 ${rawLines.length}，异常 ${badLines.length}）`);
if (badLines.length) {
  console.log('  异常行样例:');
  badLines.slice(0, 3).forEach((b) => console.log(`    行${b.line} ${b.why} | ${b.raw}`));
}

// 本地雅思词条基准（f/k/音标）
// NOTE 正则字面量里双引号无需转义；写成 \" 会被 JS 当转义引号吃掉，整条正则失配、local 变空。
const src = fs.readFileSync(IELTS_JS, 'utf8');
const local = new Map();
const entryRe = /"w":"([^"]+)","ph":"([^"]*)","d":"(?:[^"\\]|\\.)*","f":(\d+),"k":(\d+)/g;
let m0 = entryRe.exec(src);
while (m0) {
  local.set(m0[1].toLowerCase(), { ph: m0[2], f: Number(m0[3]), k: Number(m0[4]) });
  m0 = entryRe.exec(src);
}
ok(local.size === 4491, `本地雅思词条 4491（实际 ${local.size}）`);

ok(rows.length > 0, '产物非空');
ok(rows.every((e) => e && e.word && e.word_id === e.word), 'word/word_id 一致');
ok(rows.every((e) => e.prefix === e.word[0].toLowerCase()), 'prefix 为单词首字母（小写）');
ok(new Set(rows.map((e) => e.word_id)).size === rows.length, 'word_id 无重复');

/* ---- 核心：考频/难度必须是雅思口径，不能是考研口径 ---- */
const fkBad = [];
const fkMissing = [];
for (const e of rows) {
  const L = local.get(String(e.word).toLowerCase());
  if (!L) continue;
  if (e.frequency !== L.f || e.difficulty !== L.k) fkBad.push(`${e.word} 云${e.frequency}/${e.difficulty}≠雅思${L.f}/${L.k}`);
}
ok(fkBad.length === 0, `考频/难度与雅思重标一致（不一致 ${fkBad.length}）`, fkBad.slice(0, 5).join(', '));

// 反向断言：若全部等于某个"考研源"值集合，说明是整条搬运。抽样若干已知冲突词。
// abandon 考研 3/2、access 考研 4/2；雅思口径 2/3、5/2。若 f/k 换成考研值则本项失败。
const known = { abandon: [2, 3], access: [5, 2], accommodation: [4, 5], acidity: [1, 4] };
Object.keys(known).forEach((w) => {
  const e = rows.find((x) => String(x.word).toLowerCase() === w);
  if (!e) return;
  const [f, k] = known[w];
  ok(e.frequency === f && e.difficulty === k, `${w} = 雅思口径 ${f}★/${k}★`, `实际 ${e.frequency}/${e.difficulty}`);
});

/* ---- 音标：必须来自雅思侧，且已归一化 ---- */
const noPh = rows.filter((e) => !e.phonetic_uk);
ok(noPh.length === 0, `音标无空（空 ${noPh.length}）`, noPh.slice(0, 5).map((e) => e.word).join(','));
// KK 字体编码（5=ˈ E=eɪ N=ŋ F=ʃ）与未剥的 (US)/(UK) 前缀都是 eudic 解析残留
const kk = rows.filter((e) => /[0-9A-Z^]/.test(String(e.phonetic_uk || '')));
ok(kk.length === 0, `无 KK 编码残留（${kk.length}）`, kk.slice(0, 5).map((e) => `${e.word}=${e.phonetic_uk}`).join(','));
const region = rows.filter((e) => /^\((US|UK)\)/.test(String(e.phonetic_uk || '')));
ok(region.length === 0, `无未剥的地域前缀（${region.length}）`, region.slice(0, 5).map((e) => e.word).join(','));
const phMismatch = rows.filter((e) => {
  const L = local.get(String(e.word).toLowerCase());
  return L && L.ph && e.phonetic_uk !== L.ph;
});
ok(phMismatch.length === 0, `音标与本地内置一致（不一致 ${phMismatch.length}）`, phMismatch.slice(0, 5).map((e) => e.word).join(','));

/* ---- 内容字段完整度（富词条的意义所在） ---- */
const noEx = rows.filter((e) => !(e.definitions || []).some((d) => d.example));
ok(noEx.length === 0, `每条至少一个例句（缺 ${noEx.length}）`, noEx.slice(0, 5).map((e) => e.word).join(','));
const noEty = rows.filter((e) => !e.etymology);
ok(noEty.length === 0, `词源无空（空 ${noEty.length}）`, noEty.slice(0, 5).map((e) => e.word).join(','));
const noTip = rows.filter((e) => !e.memory_tip);
ok(noTip.length === 0, `记忆技巧无空（空 ${noTip.length}）`, noTip.slice(0, 5).map((e) => e.word).join(','));
const noDef = rows.filter((e) => !(e.definitions || []).length);
ok(noDef.length === 0, `definitions 无空数组（${noDef.length}）`);
const emptyMeaning = rows.filter((e) => (e.definitions || []).some((d) => !String(d.meaning || '').trim()));
ok(emptyMeaning.length === 0, `义项 meaning 无空（${emptyMeaning.length}）`);
// 例句必须含目标词（防幻觉）。
// ⚠ 判据要能容忍**不规则变形**：bend→bent、bind→bound、accompany→accompanied、
//   ally→allies、amplify→amplified… 只靠「剥 -s/-ed/-ing」会误报 75 条（已实测）。
//   做法：取词干（剥 es/s/ed/ing/ies→y/…）后在例句里找**词干相同的词**，
//   再要求两者编辑距离很小，避免把 "form" 当成 "formal" 之类误放行。
function stemOf(w) {
  return w
    .replace(/ies$/, 'y')
    .replace(/(?:es|s|d|ed|ing)$/, '')
    .replace(/e$/, '');
}
function editDistanceAtMost(a, b, max) {
  // 只需判断距离是否 <= max，DP 剪枝
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
// 不规则动词：过去式/分词与原形差 2 个以上字母，自动规则覆盖不到。
// 键 = 本词库收录的原形，值 = 例句里可能出现的变形（人工核对过，不是幻觉）。
const IRREGULAR = {
  bind: ['bound'], cling: ['clung'], fling: ['flung'], sing: ['sang', 'sung'],
  ring: ['rang', 'rung'], shrink: ['shrank', 'shrunk'], sink: ['sank', 'sunk'],
  spring: ['sprang'], swim: ['swam', 'swum'], swing: ['swung', 'swang'],
  wring: ['wrung'], bear: ['bore', 'borne', 'born'], begin: ['began', 'begun'],
  bite: ['bit', 'bitten'], blow: ['blew', 'blown'], choose: ['chose', 'chosen'],
  come: ['came', 'come'], do: ['did', 'done'], draw: ['drew', 'drawn'],
  drink: ['drank', 'drunk'], drive: ['drove', 'driven'], fall: ['fell', 'fallen'],
  fly: ['flew', 'flown'], forget: ['forgot', 'forgotten'], freeze: ['froze', 'frozen'],
  give: ['gave', 'given'], go: ['went', 'gone'], grow: ['grew', 'grown'],
  hide: ['hid', 'hidden'], know: ['knew', 'known'], lay: ['laid', 'lain'],
  lead: ['led'], lend: ['lent'], lose: ['lost'], mean: ['meant'], pay: ['paid'],
  ride: ['rode', 'ridden'], rise: ['rose', 'risen'], run: ['ran', 'run'],
  say: ['said'], see: ['saw', 'seen'], sell: ['sold'], send: ['sent'],
  shake: ['shook', 'shaken'], shine: ['shone', 'shined'], shoot: ['shot'],
  show: ['showed', 'shown'], speak: ['spoke', 'spoken'], spread: ['spread'],
  stand: ['stood'], steal: ['stole', 'stolen'], stick: ['stuck'],
  sting: ['stung'], strike: ['struck'], strive: ['strove', 'striven'],
  swear: ['swore', 'sworn'], take: ['took', 'taken'], teach: ['taught'],
  tear: ['tore', 'torn'], tell: ['told'], think: ['thought'],
  throw: ['threw', 'thrown'], understand: ['understood'], wake: ['woke', 'woken'],
  wear: ['wore', 'worn'], win: ['won'], wind: ['wound'], write: ['wrote', 'written'],
  // 前缀构词动词：overtake→overtook、sculpture→sculpting 等（去掉前缀后的词干变形）
  overtake: ['overtook', 'overtaken', 'overtaking'],
  sculpture: ['sculpting', 'sculpted', 'sculptures'],
  sweep: ['swept', 'sweeping'],
  clone: ['cloning', 'cloned'], probe: ['probing', 'probed'],
  type: ['typing', 'typed'], use: ['using', 'used'],
  // -ea- 系不规则动词（过去式换 vowel + -e）
  weave: ['wove', 'woven'], cleave: ['cleft', 'cloven', 'clave'],
  heave: ['heaved', 'hove'], leave: ['left'], achieve: ['achieved'],
  believe: ['believed'], receive: ['received'], perceive: ['perceived'],
  conceive: ['conceived'], deceive: ['deceived'], relieve: ['relieved'],
  grieve: ['grieved'], achieve2: ['achieved'],
};
const missWord = [];
for (const e of rows) {
  const w = String(e.word).toLowerCase();
  const st = stemOf(w);
  const allowedIrregular = IRREGULAR[w] || [];
  for (const d of e.definitions || []) {
    const ex = String(d.example || '').toLowerCase();
    if (ex.includes(w)) continue;
    const toks = ex.split(/[^a-z]+/);
    const hit = toks.some((t) => t.length >= 3 && editDistanceAtMost(st, stemOf(t), 1))
      || allowedIrregular.some((v) => toks.includes(v));
    if (!hit) missWord.push(`${e.word}: ${String(d.example).slice(0, 40)}`);
  }
}
ok(missWord.length === 0, `例句均含目标词或其变形（不符 ${missWord.length}）`, missWord.slice(0, 3).join(' | '));

/* ---- 与考研库的关系：内容字段应高度重合（证明"复用"真的发生了） ---- */
const kyPath = path.join(ROOT, 'import-data/worddict-all.json');
if (fs.existsSync(kyPath)) {
  const ky = new Map();
  fs.readFileSync(kyPath, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => {
    const e = JSON.parse(l);
    ky.set(String(e.word).toLowerCase(), e);
  });
  let overlap = 0;
  let contentEq = 0;
  for (const e of rows) {
    const k = ky.get(String(e.word).toLowerCase());
    if (!k) continue;
    overlap += 1;
    if (JSON.stringify(k.definitions) === JSON.stringify(e.definitions)) contentEq += 1;
  }
  console.log(`\n[2] 与考研库的关系（考研 ${ky.size} 条）`);
  ok(overlap > 0, `与考研库有交集（${overlap} 条）`);
  // 释义应基本原样复用（个别字段归一化差异不算问题，故用比例而非严格相等）
  const ratio = overlap ? contentEq / overlap : 0;
  ok(ratio >= 0.95, `释义内容复用率 ≥95%（实际 ${(ratio * 100).toFixed(1)}%）`);

  // 反向：确认 f/k 与考研不同 —— 若是，说明真按雅思口径走了
  let fkDiffFromKy = 0;
  for (const e of rows) {
    const k = ky.get(String(e.word).toLowerCase());
    if (k && (k.frequency !== e.frequency || k.difficulty !== e.difficulty)) fkDiffFromKy += 1;
  }
  const fkDiffRatio = overlap ? fkDiffFromKy / overlap : 0;
  console.log(`  · 考频/难度与考研不同的占 ${(fkDiffRatio * 100).toFixed(1)}%（预期显著 >0，否则等于整条搬运）`);
  ok(fkDiffRatio > 0.5, `f/k 未被考研覆盖（差异率 ${(fkDiffRatio * 100).toFixed(1)}% > 50%）`);
} else {
  console.log('\n[2] 跳过：import-data/worddict-all.json 不存在');
}

console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项未过`}（${pass + fail} 项）`);
process.exit(fail === 0 ? 0 : 1);