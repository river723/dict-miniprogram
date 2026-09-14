/**
 * 打包真题 + 故事数据，内联进 contentseed 云函数（gzip + base64 单文件）。
 *
 * 为什么内联：seed 云函数已踩过坑 —— 子目录（data/*.gz）不保证随代码包落地，
 * 而同级 .js 模块最稳。所以这里生成 contentseed/content-data.js，
 * 与 index.js 同目录，部署时随代码一起上传。
 *
 * 用法：node scripts/build-content-data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = resolve(ROOT, '../memo-grad/src/data');

const exams = JSON.parse(readFileSync(join(SRC, 'realExams.json'), 'utf8'));
const stories = JSON.parse(readFileSync(join(SRC, 'stories.json'), 'utf8'));

/** 展开成「云存储路径 → 内容对象」的扁平平清单，与 upload-content.mjs 完全一致。 */
const entries = [];

// ---- 真题：按年份 + 卷别拆篇 ----
const examIndex = [];
for (const year of exams) {
  for (const s of ['english1', 'english2']) {
    if (!year[s]) continue;
    const id = `${year.year}-${s === 'english1' ? 'e1' : 'e2'}`;
    entries.push({
      path: `content/exams/${id}.json`,
      body: { id, year: year.year, type: s, ...year[s] },
    });
    examIndex.push({
      id,
      year: year.year,
      title: `${year.year} 考研英语（${s === 'english1' ? '一' : '二'}）`,
    });
  }
}
entries.push({ path: 'content/exams/index.json', body: { exams: examIndex } });

// ---- 故事：按章拆篇 + 索引 ----
for (const ch of stories.chapters) {
  entries.push({ path: `content/stories/${ch.id}.json`, body: ch });
}
entries.push({
  path: 'content/stories/index.json',
  body: {
    series_title: stories.series_title,
    total_chapters: stories.total_chapters,
    chapters: stories.chapters.map(({ id, title, word_count, theme, summary }) => ({
      id, title, word_count, theme, summary,
    })),
  },
});

// ---- 序列化 + gzip + base64 ----
const payload = JSON.stringify(entries);
const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
const b64 = gz.toString('base64');

const out = `/**
 * 自动生成，请勿手改 —— 由 scripts/build-content-data.mjs 产出。
 *
 * 内容清单：${entries.length} 个文件（真题 ${examIndex.length} 套 + 索引 1 + 故事 ${stories.chapters.length} 章 + 索引 1）。
 * 原始 JSON ${(payload.length / 1024).toFixed(0)} KB → gzip ${(gz.length / 1024).toFixed(0)} KB。
 * 解出后是 [{ path, body }]，由 index.js 逐条写入云存储并登记 content_files。
 */
module.exports = {
  GZ_B64: '${b64}',
  COUNT: ${entries.length},
  RAW_BYTES: ${Buffer.byteLength(payload, 'utf8')},
};
`;

const outDir = resolve(ROOT, 'cloudfunctions/contentseed');
writeFileSync(join(outDir, 'content-data.js'), out, 'utf8');
console.log(`✓ contentseed/content-data.js`);
console.log(`  文件数 ${entries.length}（真题套卷 ${examIndex.length} + 索引 1 + 故事 ${stories.chapters.length} + 索引 1）`);
console.log(`  原始 ${(payload.length / 1024).toFixed(0)} KB → gzip ${(gz.length / 1024).toFixed(0)} KB → base64 ${(b64.length / 1024).toFixed(0)} KB`);
