/**
 * 控制台兜底方案：把词库导成**单个** JSON Lines 文件，一次导入完。
 *
 * 控制台单文件导入上限是 50MB，而这里总共才 3.6MB，所以不需要拆 26 个。
 * 用法：npm run export:single → import-data/worddict-all.json
 *      → 云开发控制台 → 数据库 → worddict → 导入 → 选 Insert 模式
 *
 * 注意：必须用 Insert 而不是 Upsert 之外的重复导入会产生重复数据，
 * 重导前请先清空集合。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = resolve(ROOT, '../memo-grad/src/data/worddict.json');
const OUT = resolve(ROOT, 'import-data');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const docs = Object.entries(raw.results).map(([word, v]) => ({
  word_id: word,
  word,
  prefix: /^[a-z]/i.test(word) ? word[0].toLowerCase() : '',
  definitions: v.definitions || [],
  etymology: v.etymology || '',
  similar_words: v.similar_words || [],
  memory_tip: v.memoryTip || '',
  frequency: v.examFrequency ?? 0,
  difficulty: v.suggestedDifficulty ?? 3,
}));

mkdirSync(OUT, { recursive: true });
const file = resolve(OUT, 'worddict-all.json');
// JSON Lines：一行一个对象（控制台要求，不能是数组）
const text = docs.map((d) => JSON.stringify(d)).join('\n');
writeFileSync(file, Buffer.from(text, 'utf8'));
console.log(`worddict-all.json  ${docs.length} 条  ${(Buffer.byteLength(text) / 1024 / 1024).toFixed(2)}MB`);
console.log('去控制台 worddict 集合点一次「导入」即可（冲突处理选 Insert）');
