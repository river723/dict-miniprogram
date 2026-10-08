/**
 * 把「独立短篇故事集」（anthology）格式转换成小程序既有的「系列故事」格式。
 *
 * ## 为什么需要这一步
 *
 * 上游外部工具产出的新故事集是 `{ meta, pieces }` 结构，字段与小程序消费形态不同：
 *
 * | anthology（输入）        | 小程序（输出）              |
 * |--------------------------|-----------------------------|
 * | meta.project             | series_title                |
 * | meta.pieces (数量)       | total_chapters              |
 * | meta.total_words         | total_words                 |
 * | pieces[].title_zh        | chapters[].title            |
 * | pieces[].en_body         | chapters[].content          |
 * | pieces[].zh_body         | chapters[].translation      |
 * | pieces[].target_count    | chapters[].word_count       |
 * | pieces[].genre           | chapters[].theme            |
 * | pieces[].words[].w       | chapters[].words (string[]) |
 * | （无）                    | chapters[].summary          |
 *
 * ## 两个必须处理的破坏性差异
 *
 * 1. **words 从 string[] 变成 object[]**
 *    前端 `utils/article.js#markWords` 执行 `String(w).replace(...)`，
 *    传对象会得到 `"[object Object]"` → 正则匹配不到任何东西 → 整篇零高亮。
 *    所以这里拍平成 `words[].w`；原对象的 pos/zh/tip/role/field 按需丢弃。
 *
 * 2. **正文里的 Markdown 星号**
 *    `en_body` 为标记目标词写入了几万处 `**`，`zh_body` 有单星斜体（法庭证词引文）。
 *    小程序的 `utils/story.js` 不做任何剥离（只有 `article.js#parseArticle` 会剥，
 *    而故事页不走它），直接使用会字面渲染出星号。
 *    这里统一清洗为纯文本 —— 高亮本来就由 words 列表驱动，不依赖星号。
 *
 * ## 用法
 *
 *   node scripts/adapt-anthology.mjs <输入.json> <输出.json>
 *   node scripts/adapt-anthology.mjs <输入.json>              # 只体检
 *
 * 也可用 npm：npm run stories:adapt -- <输入.json> <输出.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error('用法: node scripts/adapt-anthology.mjs <输入.json> [输出.json]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(inPath), 'utf8'));

if (!raw.pieces || !Array.isArray(raw.pieces)) {
  console.error('✗ 输入不是 anthology 格式（顶层应有 pieces 数组）');
  process.exit(1);
}

/**
 * 剥离强调标记。顺序很重要（与 scripts/normalize-stories.mjs 保持一致）：
 *   1. 先吃 3+ 连续星号（`***x***`）—— 只按 `**` 两两替换会残留孤星；
 *   2. 再吃成对 `**`；
 *   3. 再吃成对单个 `*`；
 *   4. 兜底任何剩余孤立星号。
 * 正文里本来就不该有星号，全清即可。
 */
function stripEmphasis(input) {
  return String(input || '')
    .replace(/\*{3,}/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*(?=[^*]*\*)/g, '')
    .replace(/\*/g, '');
}

/**
 * 规范换行：把任意长度的连续换行统一成 `\n\n`（段落分隔）。
 *
 * 上游数据混用了 `\n` 与 `\n\n`，且同一篇的 en/zh 用法还不一致
 * （详见 docs/故事数据对齐问题清单.md）。这里统一成前端期望的 `\n\n`，
 * 前端 `buildBilingualPairs` 的 `split(/\n\n+/)` 才能正确切段。
 */
function normalizeBreaks(input) {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

const STAR_RE = /\*/g;
function starCount(s) {
  return (String(s || '').match(STAR_RE) || []).length;
}

const chapters = [];
const problems = [];
const warnings = [];

let starsBefore = 0;
let wordsBefore = 0;

for (const p of raw.pieces) {
  // ---- words：object[] → string[] ----
  if (!Array.isArray(p.words) || p.words.length === 0) {
    problems.push(`篇${p.id} words 缺失或为空`);
    continue;
  }
  const wordList = p.words
    .map((w) => (typeof w === 'string' ? w : w && w.w))
    .filter((w) => typeof w === 'string' && w.trim())
    .map((w) => w.trim());
  wordsBefore += wordList.length;

  // ---- 正文清洗 ----
  starsBefore += starCount(p.en_body) + starCount(p.zh_body);
  const content = normalizeBreaks(stripEmphasis(p.en_body));
  const translation = normalizeBreaks(stripEmphasis(p.zh_body));

  // ---- 段落数一致性检查（前端按下标 1:1 配对，不等就会错位）----
  const enParas = content.split(/\n\n+/).filter(Boolean).length;
  const zhParas = translation.split(/\n\n+/).filter(Boolean).length;
  if (enParas !== zhParas) {
    problems.push(`篇${p.id} ${p.title_zh || ''} 中英段数不等（en ${enParas} / zh ${zhParas}），中英对照会错位`);
  }

  // ---- 标题：优先中文（小程序是中文界面）----
  const title = String(p.title_zh || p.title_en || '').trim();
  if (!title) problems.push(`篇${p.id} 缺标题（title_zh 与 title_en 均空）`);

  // ---- theme：genre 本身已是中文，直接透传 ----
  const theme = String(p.genre || '').trim();
  if (!theme) warnings.push(`篇${p.id} 缺 genre（theme 将为空）`);

  // ---- summary：上游没有，用「题材 + 词数」合成一句，供详情页副标题 ----
  const summary = theme ? `${theme} · 本篇含 ${wordList.length} 个目标词` : `本篇含 ${wordList.length} 个目标词`;

  chapters.push({
    id: p.id,
    title,
    content,
    translation,
    words: wordList,
    word_count: wordList.length,
    theme,
    summary,
  });
}

// ---- 汇总 ----
const totalWords = chapters.reduce((s, c) => s + c.words.length, 0);
const seriesTitle = (raw.meta && (raw.meta.series_title || raw.meta.project)) || '系列故事';
const stateWords = (raw.meta && raw.meta.total_words) || 0;

console.log('=== anthology → chapters 转换 ===');
console.log(`篇数        ${chapters.length} / ${raw.pieces.length}`);
console.log(`系列标题    ${seriesTitle}`);
console.log(`词汇合计    ${totalWords}${stateWords ? `（数据自报 ${stateWords}${totalWords === stateWords ? ' ✓' : ' ✗ 不一致'}）` : ''}`);
console.log(`星号清洗    ${starsBefore} → 0`);
console.log(`段落对齐    ${chapters.length - problems.filter((x) => x.includes('段数不等')).length} / ${chapters.length} 篇一致`);

if (warnings.length) {
  console.log('\n! 警告：');
  warnings.slice(0, 10).forEach((w) => console.log('  ' + w));
}

if (problems.length) {
  console.error('\n✗ 存在阻断性问题：');
  problems.slice(0, 30).forEach((x) => console.error('  ' + x));
  console.error(`\n共 ${problems.length} 条。修正数据后重试。`);
  process.exit(1);
}

if (stateWords && totalWords !== stateWords) {
  console.error(`\n✗ 词汇合计与 meta.total_words 不符（${totalWords} ≠ ${stateWords}）`);
  process.exit(1);
}

if (!outPath) {
  console.log('\n（未指定输出路径，仅体检，未写文件）');
  process.exit(0);
}

const out = {
  series_title: seriesTitle,
  total_chapters: chapters.length,
  total_words: totalWords,
  chapters,
};

writeFileSync(resolve(outPath), JSON.stringify(out, null, 2) + '\n', 'utf8');

const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
console.log(`\n✓ 已写出 ${outPath}`);
console.log(`  ${(bytes / 1024).toFixed(0)} KB，${chapters.length} 章 / ${totalWords} 词`);
console.log('\n下一步：npm run content:build，再部署 contentseed');
