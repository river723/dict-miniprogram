// 用 ECDICT 修复 ielts.js 中的问题音标（legacy KK 编码 / (US) 前缀 / 空）。
// 只改音标字段，释义/考频/难度一律不动。
// 用法：node _tools/fix_phonetics_from_ecdict.cjs [--apply]
// 默认只打印 diff，加 --apply 才写文件。

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'miniprogram', 'data', 'libraries', 'ielts.js');
const DB = path.join(__dirname, 'ecdict_src', 'package', 'db', 'cdict2w.db');

// 只有三类才算「有问题」：KK 字体编码残留、地域前缀、空。
// ⚠ 不要把「多读音条目」（如 ˈkɔːdʒəl, ˈkɔːdiəl）算成问题—— 那是真 IPA，
//   曾因顺带清理尾分号而误伤 7 个正常条目。
function isBadPh(ph) {
  if (!ph) return true;                          // 空
  if (/[0-9A-Z^]/.test(ph)) return true;         // KK 编码：5=ˈ E=eɪ I=ɪ Q=ʌ N=ŋ F=ʃ ^=次重音
  if (/^\((US|UK)\)/.test(ph)) return true;     // 地域前缀未剥
  return false;
}

// ECDICT 旧式音标 → 标准 IPA。实测要点：
//  ① 剥前导尾缀时**不能**碰 ':'，否则 tar 'tɑ:' 会丢长音号（曾踩）。
//  ② 前导 '.' / ',' 在 ECDICT 里表示次重音符 → ˌ（orthopedic ',ɔːθəu…'）。
//  ③ '^' 是 legacy 次重音符 → ˌ（postgraduate 'pәust'^rædjuit'）。
//  ④ ' → ˈ、ә → ə、: → ː。
//  ⑤ ECDICT 的重音符位置不可靠（misgiving 'mis'^iviŋ 会产出 词中重音 ˈˌiviŋ，
//     postgraduate 'pәust'^rædjuit 同理）→ 统一只保留**词首第一个**重音符。
function normalize(ph) {
  let s = String(ph || '').trim();
  s = s.replace(/^[^ˈˌa-zA-Zəæɑɒɔɛɪʊʌəθðʃʒŋɡː']+/, '');  // 只剥非音标类前导符，保留 ':'
  s = s.replace(/[,;]\s*$/, '');                          // 尾部分隔符
  s = s.replace(/[əә]/g, 'ə');
  s = s.replace(/\^/g, 'ˌ');
  s = s.replace(/'/g, 'ˈ');
  s = s.replace(/:/g, 'ː');
  s = s.replace(/\s*\(\)/g, '');                           // 空括号
  // 只留词首一个重音符（ˌ 或 ˈ），其余删除
  const marks = s.match(/[ˈˌ]/g) || [];
  let kept = 0;
  s = s.replace(/[ˈˌ]/g, () => (kept++ === 0 ? 'ˈ' : ''));
  // 若首个重音符不在词首（例如 ˈ 直接跟了辅音），也接受现状——eudic 亦有 'flæʃ' 这类无重音形式
  void marks;
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ECDICT 查不到、eudic 也没有的词：人工补音标（英式 IPA，与现有一致：əʊ / ɑː / ˌ）。
// 覆盖 10 个连字符词/英式拼写/派生词 —— 这些不是解析 bug，是两源同时缺失。
const OVERRIDES = {
  'air-conditioning': 'ˌeəkənˈdɪʃənɪŋ',
  'aminoacid': 'ˌæmɪnəʊˈæsɪd',
  'cosy': 'ˈkəʊzi',
  'distil': 'dɪˈstɪl',
  'eminently': 'ˈemɪnəntli',
  'entrenched': 'ɪnˈtrentʃt',
  'fleeting': 'ˈfliːtɪŋ',
  'fractionally': 'ˈfrækʃənəli',
  'pharmaceutist': 'ˌfɑːməˈsjuːtɪst',
  'well-to-do': 'ˌweltəˈduː',
  'X-ray': 'ˈeksreɪ',
};

// ECDICT 是美式词典，英式拼写（distil / jeopardise / cosy）在其中查不到 → 试常见变体。
function variants(word) {
  const base = word.replace(/-/g, '');
  const out = [word, base];
  // 英式 → 美式：-ise→-ize, -our→-or, -re→-er, 双写辅音还原(distil→distill)
  out.push(base.replace(/ise$/, 'ize'), base.replace(/our$/, 'or'), base.replace(/re$/, 'er'));
  const m = base.match(/^(.*?)([bcdfglmnprt])\2(l|y|ed|ing|er|est)$/);
  if (m) out.push(m[1] + m[2] + m[3]);
  out.push(base + 'e', base + 's');
  if (/y$/.test(base)) out.push(base.replace(/y$/, 'i') + 'es');
  return out;
}

function lookup(map, word) {
  for (const t of variants(word)) {
    const hit = map.get(String(t).toLowerCase());
    if (hit) return hit;
  }
  return '';
}

function main() {
  const apply = process.argv.includes('--apply');
  const src = fs.readFileSync(TARGET, 'utf8');
  const db = new DatabaseSync(DB);
  const map = new Map();
  for (const r of db.prepare('select word, phonetic from stardict').all()) {
    if (r.phonetic) map.set(String(r.word).toLowerCase(), r.phonetic);
  }

  const entryRe = /\{"w":"([^"]+)","ph":"([^"]*)"/g;
  const changes = [];
  const unresolved = [];
  let entries = 0;
  let badTotal = 0;

  const next = src.replace(entryRe, (m, w, ph) => {
    entries++;
    if (!isBadPh(ph)) return m;
    badTotal++;
    const override = OVERRIDES[w];
    if (override) {
      changes.push({ w, from: ph || '(空)', to: override, via: '人工' });
      return `{"w":"${w}","ph":"${override}"`;
    }
    const raw = lookup(map, w);
    if (!raw) {
      unresolved.push({ w, ph });
      return m;
    }
    const norm = normalize(raw);
    if (!norm) { unresolved.push({ w, ph }); return m; }
    changes.push({ w, from: ph || '(空)', to: norm });
    return `{"w":"${w}","ph":"${norm}"`;
  });

  console.log(`扫描 ${entries} 条；问题音标 ${badTotal} 条；ECDICT 可修 ${changes.length}；无解 ${unresolved.length}`);
  for (const c of changes) console.log(`  ${c.w.padEnd(16)} ${c.from.padEnd(28)} → ${c.to}`);
  if (unresolved.length) {
    console.log('\n仍无解（需另一手来源或人工）:');
    for (const u of unresolved) console.log(`  ${u.w.padEnd(16)} 现值 ${u.ph || '(空)'}`);
  }
  console.log('\n自检：写入后若仍残留 KK 字符，则归一化有漏。');
  const after = (apply ? next : src).match(/"ph":"[^"]*[0-9A-Z^][^"]*"/g) || [];
  console.log('  含 KK 残留的音标条目：', after.length);

  if (!apply) {
    console.log('\n（预览模式，加 --apply 写入）');
    return;
  }
  fs.writeFileSync(TARGET, next, 'utf8');
  console.log(`\n已写入 ${TARGET}`);
}

main();