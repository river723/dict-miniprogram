const fs = require('fs');
const eudic = fs.readFileSync('../_IELTS_tmp.eudic');
const lex = new Set(fs.readFileSync('words.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const BLOCK_START = 251495, BLOCK_END = 284500;
const chunk = eudic.slice(BLOCK_START, BLOCK_END);
// 取 [a-z] 段（不 lowercase：大写释义头/中文会自然断句）
const runs = [];
let cur = '';
for (let i = 0; i < chunk.length; i++) {
  const c = chunk[i];
  if (c >= 0x61 && c <= 0x7a) cur += String.fromCharCode(c);
  else { if (cur.length >= 2) runs.push(cur); cur = ''; }
}
if (cur.length >= 2) runs.push(cur);

const MAXLEN = 30;
function fmm(run) {
  const out = []; let p = 0;
  while (p < run.length) {
    let m = false; const rem = Math.min(MAXLEN, run.length - p);
    for (let L = rem; L >= 1; L--) { const s = run.slice(p, p + L); if (lex.has(s)) { out.push(s); p += L; m = true; break; } }
    if (!m) p += 1;
  }
  return out;
}
// 全文 FMM 词序列（文件顺序），仅保留长度>=3 的（去掉边界碎片如 ha/oh/ut）
let seq = [];
for (const r of runs) for (const w of fmm(r)) if (w.length >= 3) seq.push(w);
console.log('total FMM words (len>=3):', seq.length);

// 最长非降子序列（LNDS）：词头条是全局字母序主干，释义乱序词被排除
const n = seq.length;
const dp = new Array(n).fill(1);
const prev = new Array(n).fill(-1);
let best = 0, bestI = 0;
for (let i = 0; i < n; i++) {
  for (let j = 0; j < i; j++) {
    if (seq[j] <= seq[i] && dp[j] + 1 > dp[i]) { dp[i] = dp[j] + 1; prev[i] = j; }
  }
  if (dp[i] > best) { best = dp[i]; bestI = i; }
}
const lnds = [];
for (let k = bestI; k !== -1; k = prev[k]) lnds.push(seq[k]);
lnds.reverse();
const uniq = [...new Set(lnds)].sort();
console.log('LNDS length:', best, '| unique:', uniq.length);
console.log('first 40:', uniq.slice(0, 40).join(' '));
console.log('last 25:', uniq.slice(-25).join(' '));
['accommodation', 'accomplishment', 'acquaintance', 'accessible', 'abandon', 'zone', 'zoology', 'witness', 'yield', 'zebra', 'bank', 'computer', 'environment', 'frequency'].forEach((w) => {
  console.log('  check', w, '=>', uniq.includes(w) ? 'OK' : 'MISSING');
});
fs.writeFileSync('ielts_words.json', JSON.stringify(uniq));
console.log('written ielts_words.json');
// 首字母分布
const hist = {};
for (const w of uniq) { const c = w[0]; hist[c] = (hist[c] || 0) + 1; }
console.log('letter histogram:', Object.keys(hist).sort().map((c) => c + ':' + hist[c]).join(' '));
