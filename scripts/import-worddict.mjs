/**
 * 词库导入：memo-grad src/data/worddict.json → 云数据库 worddict 集合。
 * 幂等：按 word_id（= 单词本身）去重 upsert，与 SyncService 去重语义一致。
 * memo-grad 数据更新后重跑本脚本即可。
 *
 * 用法：
 *   node scripts/import-worddict.mjs --env=<云环境ID> [--limit=100]
 * 凭据走环境变量 TCB_SECRET_ID / TCB_SECRET_KEY（腾讯云 API 密钥）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import CloudBase from '@cloudbase/node-sdk';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const env = args.env || process.env.TCB_ENV;
if (!env) {
  console.error('缺少 --env=<云环境ID> 或 TCB_ENV');
  process.exit(1);
}

const app = CloudBase.init({ env, secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY });
const db = app.database();

const raw = JSON.parse(readFileSync(resolve(ROOT, '../memo-grad/src/data/worddict.json'), 'utf8'));
const entries = Object.entries(raw.results);
console.log(`共 ${entries.length} 个词条`);

const BATCH = 100;
const limit = args.limit ? Number(args.limit) : Infinity;
let imported = 0, skipped = 0;

for (let i = 0; i < entries.length && imported < limit; i += BATCH) {
  const slice = entries.slice(i, i + BATCH);
  const docs = slice.map(([word, v]) => ({
    word_id: word,
    word,
    prefix: word[0].toLowerCase(),
    definitions: v.definitions || [],
    etymology: v.etymology || '',
    similar_words: v.similar_words || [],
    memory_tip: v.memoryTip || '',
    frequency: v.examFrequency ?? 0,
    difficulty: v.suggestedDifficulty ?? 3,
  }));

  // 查已有 word_id，仅插入缺失（导入幂等）
  const ids = docs.map((d) => d.word_id);
  const existRes = await db.collection('worddict')
    .where({ word_id: db.command.in(ids) })
    .limit(1000)
    .get();
  const existSet = new Set(existRes.data.map((d) => d.word_id));

  // 批量写：一次 add 一个数组（SDK 支持 Object | Object[]），比逐条快两个数量级
  const todo = docs.filter((d) => !existSet.has(d.word_id));
  if (limit < Infinity) {
    const room = limit - imported;
    todo.splice(Math.max(0, room));
  }
  if (todo.length > 0) {
    await db.collection('worddict').add(todo);
    imported += todo.length;
  }
  skipped += docs.length - todo.length;
  console.log(`进度 ${Math.min(i + BATCH, entries.length)}/${entries.length}（新增 ${imported} / 跳过 ${skipped}）`);
}

console.log(`完成：新增 ${imported}，已存在跳过 ${skipped}`);
console.log('提醒：首次导入后请在云开发控制台为 worddict 集合建 prefix 索引，读权限设为「所有用户可读」。');
