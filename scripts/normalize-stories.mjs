/**
 * 规范化外部生成的故事数据，使其与小程序「系列故事」的既有消费形态一致。
 *
 * 背景：上游 scripts/build-content-data.mjs 从 ../memo-grad/src/data/stories.json 读数据，
 * 该文件是按「纯文本 + words 列表」形态被消费的：
 *   - 高亮完全由 utils/story.js#buildSegments → markWords(p.en, words) 依据 words 列表匹配；
 *   - story.js 与 article.js 都不会剥离 `**`（article.js#parseArticle 的 segments 只用于文稿页，
 *     故事页不走它）。
 * 而外部工具产出的新故事把目标词写成了 Markdown 粗体 `**word**`（9237 处），
 * 另有 12 处畸形标记（`***word***` / `****word****`）和少量斜体星号（`*probably ignored*`）。
 * 若直接替换，正文会字面渲染出 `**privilege**` 这样的星号。
 *
 * 所以这里统一清洗：去掉全部强调星号，还原为纯文本，并校验结果与旧版形态一致。
 *
 * 用法：
 *   node scripts/normalize-stories.mjs <输入.json> <输出.json>
 *   node scripts/normalize-stories.mjs <输入.json>            # 只体检，不写文件
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath) {
  console.error('用法: node scripts/normalize-stories.mjs <输入.json> [输出.json]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(inPath), 'utf8'));

/** 统计文本里的星号情况，用于清洗前后对比。 */
function starStats(s) {
  const str = String(s || '');
  return {
    total: (str.match(/\*/g) || []).length,
    bold: (str.match(/\*\*/g) || []).length,
    single: (str.match(/(?<!\*)\*(?!\*)/g) || []).length,
    triple: (str.match(/\*{3,}/g) || []).length,
  };
}

/**
 * 剥离强调标记。顺序很重要：
 *   1. 先吃掉 3 个及以上的连续星号（`***x***` / `****x****`）—— 若只按 `**` 两两替换，
 *      奇数个星号会残留一个孤星；
 *   2. 再吃掉成对的 `**`（粗体）；
 *   3. 最后吃掉成对的单个 `*`（斜体）；
 *   4. 任何残留的孤立星号一并清掉 —— 正文里本来就不该有星号。
 */
function stripEmphasis(input) {
  return String(input || '')
    .replace(/\*{3,}/g, '')       // *** **  →  ''
    .replace(/\*\*/g, '')         // **      →  ''
    .replace(/\*(?=[^*]*\*)/g, '') // 成对单个星号的前一个
    .replace(/\*/g, '');          // 兜底：剩余孤立星号
}

const before = { bold: 0, single: 0, triple: 0 };
const after = { bold: 0, single: 0, triple: 0 };
let changedFields = 0;

const chapters = raw.chapters.map((ch) => {
  const next = { ...ch };
  for (const key of ['content', 'translation']) {
    const s0 = starStats(ch[key]);
    before.total = (before.total || 0) + s0.total;
    before.bold += s0.bold;
    before.single += s0.single;
    before.triple += s0.triple;

    const cleaned = stripEmphasis(ch[key]);
    if (cleaned !== ch[key]) changedFields += 1;

    const s1 = starStats(cleaned);
    after.total = (after.total || 0) + s1.total;
    after.bold += s1.bold;
    after.single += s1.single;
    after.triple += s1.triple;

    next[key] = cleaned;
  }
  return next;
});

const out = { ...raw, chapters };

console.log('=== 清洗统计 ===');
console.log(`字段被改写：${changedFields} 个`);
console.log(`星号总数  ${before.total} → ${after.total}`);
console.log(`  双星(粗体)  ${before.bold} → ${after.bold}`);
console.log(`  单星(斜体)  ${before.single} → ${after.single}`);
console.log(`  三连及以上  ${before.triple} → ${after.triple}`);

if (after.total !== 0) {
  console.error('✗ 仍有星号残留，请检查 stripEmphasis 规则');
  process.exit(1);
}

if (!outPath) {
  console.log('\n（未指定输出路径，仅体检，未写文件）');
  process.exit(0);
}

// 校验：字段齐备 + 类型正确。
// 注意 summary 是【字符串】不是数组（与旧版一致，story-read 直接当文本渲染），别想当然。
const REQUIRED = ['id', 'title', 'content', 'translation', 'words', 'word_count', 'theme', 'summary'];
const problems = [];
out.chapters.forEach((c) => {
  REQUIRED.forEach((k) => {
    const v = c[k];
    if (v === undefined || v === null || v === '') problems.push(`ch${c.id} 缺 ${k}`);
  });
  if (!Array.isArray(c.words) || c.words.length === 0) problems.push(`ch${c.id} words 非数组或为空`);
  if (!Array.isArray(c.summary) && typeof c.summary !== 'string') {
    problems.push(`ch${c.id} summary 类型异常（${typeof c.summary}），应为 string`);
  }
});
if (problems.length) {
  console.error('✗ 结构校验未过：');
  problems.slice(0, 20).forEach((p) => console.error('  ' + p));
  process.exit(1);
}

writeFileSync(resolve(outPath), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\n✓ 已写出 ${outPath}`);
