/**
 * 从 IELTS_Basic_Vocabulary.eudic 解压并解析出「单词 → 音标 + 中文释义」。
 *
 * 格式（逆向结论，2026-10-19 核实）：
 *   - 释义内容是**分块 zlib 压缩**存储的，每块解压后正好 16384 字节；按 offset 顺序拼接得完整内容流。
 *   - 词条形如：
 *       <b>beneficial</b><div><div>[<font face="Lucida Sans Unicode">beniˈfiʃəl</font>]<br />
 *       adj.有益的,受益的,[法律]有使用权的<br />adj.有益的,得位的,[律]有使用权的</div></div>
 *     - 音标在 <font face="Lucida Sans Unicode"> 内、外层包一对方括号；
 *     - 义项之间用 <br /> 分隔；义项内部「词性.释义,释义」，[法律] 这类方括号注记是正文，保留。
 *
 * 用法：node _tools/parse_eudic_defs.cjs
 * 输入：_tools/_IELTS_src.eudic（用户提供的词库文件归档副本）
 * 输出：_tools/ielts_defs.json = { word: { ph, def } }，def 为去重后前 2 个义项，以「；」连接
 */
const fs = require('fs');
const zlib = require('zlib');

const SRC = '_tools/_IELTS_src.eudic';
const OUT = '_tools/ielts_defs.json';
const MAX_SENSES = 2; // 每个词最多保留几个义项（控制包体积）
const MAX_DEF_LEN = 120; // 单个词释义长度上限

const b = fs.readFileSync(SRC);

// 1) 收集所有 zlib 块（以解压后恰为 16384 字节判定，排除块内 0x78 误触发）
const blocks = [];
for (let i = 0; i < b.length - 2; i += 1) {
  if (b[i] === 0x78 && (b[i + 1] === 0x01 || b[i + 1] === 0x9c || b[i + 1] === 0xda)) {
    try {
      const out = zlib.inflateSync(b.slice(i));
      if (out.length === 16384) blocks.push({ off: i, out });
    } catch (e) { /* 非块起点，忽略 */ }
  }
}
blocks.sort((x, y) => x.off - y.off);
if (blocks.length === 0) {
  console.error('未找到 zlib 块，源文件格式可能不符');
  process.exit(1);
}
const full = Buffer.concat(blocks.map((x) => x.out)).toString('utf8');
console.log('zlib blocks:', blocks.length, '| 解压总长:', full.length);

// 2) 按 <b>word</b> 切词条
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
// 压缩块尾部可能有 NUL Padding，控制字符一律剥掉
const squeeze = (s) => s.replace(/[\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim();
const isWord = (w) => /^[a-zA-Z][a-zA-Z'-]*$/.test(w);

const entries = {}; // 统一用小写 key，另存首选拼写
const re = /<b>([^<]+)<\/b>/g;
let m;
const marks = [];
while ((m = re.exec(full)) !== null) marks.push({ word: m[1].trim(), at: m.index, end: m.index + m[0].length });

for (let i = 0; i < marks.length; i += 1) {
  const { word, end } = marks[i];
  if (!isWord(word)) continue;
  const stop = i + 1 < marks.length ? marks[i + 1].at : full.length;
  const body = full.slice(end, stop);

  // 音标：[<font ...>xxx</font>] → 取 font 内容
  const phMatch = body.match(/\[<font face="Lucida Sans Unicode">([^<]*)<\/font>\]/);
  const ph = phMatch ? squeeze(phMatch[1]) : '';

  // 释义：剥掉音标块后按 <br /> 切段、去标签、去重、限量
  const rest = body.replace(/\[<font face="Lucida Sans Unicode">[^<]*<\/font>\]/g, '');
  const senses = rest
    .split(/<br\s*\/?>/gi)
    .map((s) => squeeze(stripTags(s)))
    .filter(Boolean);
  const uniq = [];
  senses.forEach((s) => { if (!uniq.includes(s)) uniq.push(s); });
  let def = uniq.slice(0, MAX_SENSES).join('；');
  if (def.length > MAX_DEF_LEN) def = `${def.slice(0, MAX_DEF_LEN - 1)}…`;
  if (!def) continue;

  const key = word.toLowerCase();
  if (!entries[key]) entries[key] = { word, ph, def };
}

const keys = Object.keys(entries);
console.log('parsed headwords:', keys.length);

// 3) 质量报告
const noPh = keys.filter((k) => !entries[k].ph);
const phrases = keys.filter((k) => entries[k].word.includes(' '));
console.log('无音标:', noPh.length, noPh.slice(0, 20).join(','));
console.log('含空格词组:', phrases.length, phrases.slice(0, 10).join(','));
const avg = keys.reduce((s, k) => s + entries[k].def.length, 0) / keys.length;
console.log('释义平均长:', avg.toFixed(0), '字');

fs.writeFileSync(OUT, JSON.stringify(entries));
console.log('written:', OUT, '| bytes:', fs.statSync(OUT).size);
