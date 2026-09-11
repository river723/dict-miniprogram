/**
 * 免密钥方案：把词库导成「每行一个 JSON 对象」的 .json 文件，按首字母拆分，
 * 然后在「云开发控制台 → 数据库 → worddict 集合 → 导入」逐个导入即可。
 * （控制台要求 JSON 文件每行一个对象，不能是数组）
 *
 * 用法：
 *   node scripts/export-jsonl.mjs
 * 产物：import-data/worddict-<字母>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = resolve(ROOT, 'import-data');

const raw = JSON.parse(readFileSync(resolve(ROOT, '../memo-grad/src/data/worddict.json'), 'utf8'));
const entries = Object.entries(raw.results);

const groups = new Map();
for (const [word, v] of entries) {
  const key = /^[a-z]/i.test(word) ? word[0].toLowerCase() : '_other';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({
    word_id: word,
    word,
    prefix: key === '_other' ? '' : key,
    definitions: v.definitions || [],
    etymology: v.etymology || '',
    similar_words: v.similar_words || [],
    memory_tip: v.memoryTip || '',
    frequency: v.examFrequency ?? 0,
    difficulty: v.suggestedDifficulty ?? 3,
  });
}

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [key, docs] of [...groups.entries()].sort()) {
  const file = resolve(OUT, `worddict-${key}.json`);
  // JSON Lines：一行一个对象
  writeFileSync(file, docs.map((d) => JSON.stringify(d)).join('\n'), 'utf8');
  total += docs.length;
  console.log(`worddict-${key}.json  ${docs.length} 条  ${(docs.length / 100).toFixed(0)}%`);
}
console.log(`\n共 ${total} 条，已生成到 import-data/，去云开发控制台 worddict 集合逐个「导入」即可`);
