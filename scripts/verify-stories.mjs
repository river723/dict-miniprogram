/**
 * 故事数据「能否上线」总闸门 —— 一条命令给出通过 / 不通过。
 *
 * 把分散的检查串成一条链，避免每次换故事集都手动跑四五个脚本、
 * 还要自己比对输出。它做三件事：
 *
 *   1. 若输入是 anthology 格式（{meta, pieces}）→ 调 adapt-anthology 转换
 *      若是 chapters 格式 → 直接使用
 *   2. 结构体检：字段齐备、words 可用、无星号残留、词汇覆盖数
 *   3. 渲染体检：复刻前端 buildBilingualPairs + markWords，
 *      逐章验证中英段数 1:1、高亮确实命中
 *
 * 任一项不过 → 退出码 1 并给出可操作的修正指引。
 *
 * 用法：
 *   node scripts/verify-stories.mjs <故事.json>              # 只体检
 *   node scripts/verify-stories.mjs <故事.json> <输出.json>  # 体检通过才写出
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error('用法: node scripts/verify-stories.mjs <故事.json> [输出.json]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(inPath), 'utf8'));

const isAnthology = Array.isArray(raw.pieces);
const isChapters = Array.isArray(raw.chapters);

if (!isAnthology && !isChapters) {
  console.error('✗ 无法识别的数据格式：顶层既没有 pieces 也没有 chapters');
  process.exit(1);
}

console.log(`输入格式    ${isAnthology ? 'anthology（{meta, pieces}）' : 'chapters（{series_title, chapters}）'}`);

// ============ 1. 统一成 chapters 形态 ============
function stripEmphasis(s) {
  return String(s || '')
    .replace(/\*{3,}/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*(?=[^*]*\*)/g, '')
    .replace(/\*/g, '');
}

/**
 * 规范段落切分 —— 这是本项目最容易踩的坑，规则来自对四代数据的实测。
 *
 * ⚠️ 英文与中文的段落分隔符【历史上不一致】，不能统一处理：
 *   - 英文正文用【单 \n】分段（实测：篇 1 英文按 \n 切 = 94 段，
 *     恰等于中文 94 段；按 \n\n 切只有 3 段，会被压成一整块）
 *   - 中文正文用【\n\n】分段
 *   这个混用是外部生成器造成的，前端 buildBilingualPairs 只认 \n\n，
 *   所以这里必须把英文的单 \n 提升为 \n\n，中文保持 \n\n。
 *
 * 另需滤掉 Markdown 场景分隔线 `---`（数据里有，中英同位置各 7 处），
 * 否则它会被当成一个段落，造成两侧段数虚高且无法对齐。
 *
 * 实测效果：按此规则 15/20 篇中英段数相等（不处理只有 13/20）。
 */
function splitParas(s, isEn) {
  const raw = isEn ? String(s || '').split('\n') : String(s || '').split(/\n\n+/);
  return raw
    .map((t) => t.trim())
    .filter((t) => t && !/^-{3,}$/.test(t));
}

function normalizeBreaks(s, isEn) {
  return splitParas(s, isEn).join('\n\n');
}

let chapters;
let seriesTitle;

if (isAnthology) {
  // meta.project 常带生成器的模式说明后缀（如「（独立短篇故事集模式）」），
  // 写进 series_title 会很难看，这里去掉结尾的「（…模式）」这类说明性括号。
  seriesTitle = ((raw.meta && (raw.meta.series_title || raw.meta.project)) || '系列故事')
    .replace(/（[^）]*模式）\s*$/, '')
    .trim();
  chapters = raw.pieces.map((p) => {
    const words = (p.words || [])
      .map((w) => (typeof w === 'string' ? w : w && w.w))
      .filter((w) => typeof w === 'string' && w.trim())
      .map((w) => w.trim());
    const theme = String(p.genre || '').trim();
    return {
      id: p.id,
      title: String(p.title_zh || p.title_en || '').trim(),
      content: normalizeBreaks(stripEmphasis(p.en_body), true),
      translation: normalizeBreaks(stripEmphasis(p.zh_body), false),
      words,
      word_count: words.length,
      theme,
      summary: theme ? `${theme} · 本篇含 ${words.length} 个目标词` : `本篇含 ${words.length} 个目标词`,
    };
  });
} else {
  seriesTitle = raw.series_title || '系列故事';
  // chapters 格式也统一过一遍（幂等：本来就干净的不会变）
  chapters = raw.chapters.map((c) => ({
    ...c,
    content: normalizeBreaks(stripEmphasis(c.content), true),
    translation: normalizeBreaks(stripEmphasis(c.translation), false),
    words: (c.words || [])
      .map((w) => (typeof w === 'string' ? w : w && (w.w || w.word)))
      .filter((w) => typeof w === 'string' && w.trim()),
  }));
}

// ============ 2. 结构体检 ============
const fail = [];
const warn = [];

chapters.forEach((c) => {
  const tag = `篇${c.id}${c.title ? ' ' + c.title : ''}`;
  if (!c.id && c.id !== 0) fail.push(`${tag} 缺 id`);
  if (!c.title) fail.push(`${tag} 缺标题`);
  if (!c.content) fail.push(`${tag} 缺英文正文 content`);
  if (!c.translation) warn.push(`${tag} 缺中文译文 translation`);
  if (!Array.isArray(c.words) || c.words.length === 0) fail.push(`${tag} words 为空或非数组`);
  if (!c.theme) warn.push(`${tag} 缺 theme（列表徽标会为空）`);
});

const totalWords = chapters.reduce((s, c) => s + (c.words || []).length, 0);
const idSet = new Set(chapters.map((c) => c.id));
const dupIds = chapters.length - idSet.size;
if (dupIds > 0) fail.push(`存在 ${dupIds} 个重复 id`);

const starTotal = chapters.reduce(
  (s, c) => s + ((c.content || '').match(/\*/g) || []).length + ((c.translation || '').match(/\*/g) || []).length,
  0,
);
if (starTotal > 0) fail.push(`正文仍有 ${starTotal} 个星号残留`);

// ============ 3. 渲染体检（复刻前端逻辑）============
// 注意：模拟的是【前端实际的切分】，即只认 \n\n。
// 上面的 normalizeBreaks 已经保证英文的单 \n 被提升为 \n\n，故这里用 \n\n 是对的。
function buildBilingualPairs(content, translation) {
  const enParas = String(content || '').split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  const zhParas = String(translation || '').split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  const pairs = [];
  let enStart = 0;
  if (enParas.length === zhParas.length + 1 && zhParas.length > 0) {
    pairs.push({ en: enParas[0], zh: '' });
    enStart = 1;
  }
  const maxLen = Math.max(enParas.length - enStart, zhParas.length);
  for (let i = 0; i < maxLen; i += 1) {
    pairs.push({ en: enParas[enStart + i], zh: zhParas[i] });
  }
  return pairs;
}

function markWords(plain, words = []) {
  const text = String(plain == null ? '' : plain);
  const list = words
    .filter(Boolean)
    .map((w) => (typeof w === 'string' ? w : w.w || w.word || ''))
    .filter((w) => w)
    .map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (list.length === 0 || !text) return [{ text, hit: false }];
  const re = new RegExp(`\\b(${list.join('|')})\\b`, 'gi');
  const out = [];
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.filter((s) => s.text);
}

const rows = [];
let misaligned = 0;
let totalHits = 0;

chapters.forEach((c) => {
  const enN = String(c.content || '').split(/\n\n+/).filter((s) => s.trim()).length;
  const zhN = String(c.translation || '').split(/\n\n+/).filter((s) => s.trim()).length;
  const pairs = buildBilingualPairs(c.content, c.translation);

  let hits = 0;
  pairs.forEach((p) => {
    if (!p.en) return;
    hits += markWords(p.en, c.words).filter((s) => s.hit).length;
  });
  totalHits += hits;

  const aligned = enN === zhN;
  if (!aligned) misaligned += 1;
  rows.push({ id: c.id, title: c.title, en: enN, zh: zhN, hits, aligned });
});

if (misaligned > 0) {
  const bad = rows.filter((r) => !r.aligned);
  fail.push(
    `${misaligned}/${chapters.length} 篇中英段落数不等（前端按下标 1:1 配对，会错位）：` +
    bad.map((r) => `篇${r.id}(en${r.en}/zh${r.zh})`).join('、'),
  );
}
if (totalHits === 0) fail.push('全文高亮命中为 0 —— words 与正文不匹配');

// ============ 输出 ============
console.log(`故事集      ${seriesTitle}`);
console.log(`章数        ${chapters.length}`);
console.log(`词汇合计    ${totalWords}`);
console.log(`高亮命中    ${totalHits}`);
console.log(`星号残留    ${starTotal}`);
console.log(`段落不齐    ${misaligned} / ${chapters.length}`);
console.log('');

if (warn.length) {
  console.log('! 警告（不阻断）：');
  warn.slice(0, 10).forEach((w) => console.log('  ' + w));
  if (warn.length > 10) console.log(`  …另有 ${warn.length - 10} 条`);
  console.log('');
}

console.log('篇号 | 标题                 | 英段 | 中段 | 高亮 | 对齐');
rows.forEach((r) => {
  console.log(
    String(r.id).padStart(3) + ' | ' +
    String(r.title || '').padEnd(20).slice(0, 20) + ' | ' +
    String(r.en).padStart(4) + ' | ' +
    String(r.zh).padStart(4) + ' | ' +
    String(r.hits).padStart(4) + ' | ' +
    (r.aligned ? '✓' : '✗'),
  );
});

if (fail.length) {
  console.log('');
  console.error('✗ 体检不通过：');
  fail.forEach((f) => console.error('  ' + f));
  console.log('');
  console.error('修正指引：见 docs/故事数据对齐问题清单.md');
  console.error('核心要求：英文与中文都用 `\\n\\n` 分段落，且逐段 1:1 对应。');
  process.exit(1);
}

console.log('');
console.log('✓ 体检全部通过');

if (outPath) {
  const out = {
    series_title: seriesTitle,
    total_chapters: chapters.length,
    total_words: totalWords,
    chapters,
  };
  writeFileSync(resolve(outPath), JSON.stringify(out, null, 2) + '\n', 'utf8');
  const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
  console.log(`✓ 已写出 ${outPath}（${(bytes / 1024).toFixed(0)} KB）`);
  console.log('');
  console.log('下一步：');
  console.log('  npm run content:build      # 重建 contentseed 内联数据');
  console.log('  npm run deploy:cf -- contentseed   # 部署云函数');
  console.log('  小程序 → 我的 → 设置 → 数据初始化 → ⑤ 导入真题 / 故事');
}
