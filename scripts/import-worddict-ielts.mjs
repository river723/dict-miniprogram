/**
 * 雅思富词条导入：import-data/worddict-ielts.jsonl → 云数据库 worddict_ielts 集合。
 *
 * 与 scripts/import-worddict.mjs（考研 → worddict 集合）的关系：
 *   同一个 worddict 云函数按 lib 参数分流到两个集合，页面零改动即可消费。
 *
 * 幂等：word_id（= 单词本身）已存在则跳过。
 *   生成脚本对每个词只写一次（断点续跑读已写 jsonl 跳过），产物内容不会变，
 *   所以「插入缺失」即等价于 upsert；若手工改过产物想强制覆盖，用 --force-update。
 *
 * 用法：
 *   node scripts/import-worddict-ielts.mjs --dry-run              # 只校验产物，不连云
 *   node scripts/import-worddict-ielts.mjs --env=<云环境ID> [--limit=100]
 *   node scripts/import-worddict-ielts.mjs --env=<云环境ID> --force-update   # 覆盖已存在词条
 * 凭据走环境变量 TCB_SECRET_ID / TCB_SECRET_KEY（腾讯云 API 密钥）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import CloudBase from '@cloudbase/node-sdk';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const COL = 'worddict_ielts';
const SRC = resolve(ROOT, 'import-data/worddict-ielts.jsonl');

/* ---------------- 产物读取与校验（离线，dry-run 也走这段） ---------------- */

function loadDocs() {
  if (!existsSync(SRC)) {
    console.error(`未找到产物 ${SRC}。请先运行：node scripts/gen-ielts-rich.mjs`);
    process.exit(1);
  }
  const seen = new Map();
  const dupes = [];
  let bad = 0;
  readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim()).forEach((l, i) => {
    try {
      const d = JSON.parse(l);
      if (!d || !d.word) { bad += 1; return; }
      const k = String(d.word).toLowerCase();
      if (seen.has(k)) dupes.push(k);
      seen.set(k, d); // 同名取最后一条
    } catch (e) {
      bad += 1;
      console.warn(`  第 ${i + 1} 行不是合法 JSON，已跳过`);
    }
  });
  if (bad > 0) console.warn(`共 ${bad} 行无法解析`);
  if (dupes.length > 0) console.warn(`发现 ${dupes.length} 个重复词（已按最后一条去重）：${dupes.slice(0, 10).join(', ')}…`);
  return Array.from(seen.values());
}

/** 入库前体检：字段缺失比缺词更致命（缺字段 = 页面渲染不出内容且不报错）。 */
function validate(docs) {
  const problems = [];
  docs.forEach((d) => {
    if (!d.word_id) problems.push(`${d.word}: 缺 word_id`);
    if (!d.prefix) problems.push(`${d.word}: 缺 prefix`);
    if (!Array.isArray(d.definitions) || d.definitions.length === 0) problems.push(`${d.word}: definitions 为空`);
    if (typeof d.etymology !== 'string') problems.push(`${d.word}: etymology 非字符串`);
    if (!Array.isArray(d.similar_words)) problems.push(`${d.word}: similar_words 非数组`);
    if (typeof d.memory_tip !== 'string') problems.push(`${d.word}: memory_tip 非字符串`);
    if (!(Number(d.frequency) >= 1 && Number(d.frequency) <= 5)) problems.push(`${d.word}: frequency 越界(${d.frequency})`);
    if (!(Number(d.difficulty) >= 1 && Number(d.difficulty) <= 5)) problems.push(`${d.word}: difficulty 越界(${d.difficulty})`);
  });
  return problems;
}

const docs = loadDocs();
console.log(`产物：${docs.length} 条（${SRC.replace(`${ROOT}/`, '')}）`);
if (docs.length === 0) {
  console.error('产物为空，无法导入。');
  process.exit(1);
}
const problems = validate(docs);
if (problems.length > 0) {
  console.error(`校验未过 ${problems.length} 处，前 10 条：`);
  problems.slice(0, 10).forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('字段校验通过。');

if (args['dry-run']) {
  const withPh = docs.filter((d) => d.phonetic_uk).length;
  const withEx = docs.filter((d) => (d.definitions || []).some((x) => x.example)).length;
  console.log(`带音标 ${withPh} 条；带例句 ${withEx} 条`);
  console.log('样本：', JSON.stringify(docs[0]).slice(0, 300));
  console.log('\n（dry-run，未连接云端）');
  process.exit(0);
}

/* ---------------- 云端导入 ---------------- */

const env = args.env || process.env.TCB_ENV;
if (!env) {
  console.error('缺少 --env=<云环境ID> 或 TCB_ENV');
  process.exit(1);
}

const app = CloudBase.init({ env, secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY });
const db = app.database();
const FORCE = !!args['force-update'];

const BATCH = 100;
const limit = args.limit ? Number(args.limit) : Infinity;
let imported = 0;
let updated = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < docs.length && imported + updated < limit; i += BATCH) {
  const slice = docs.slice(i, i + BATCH);
  const ids = slice.map((d) => d.word_id);
  const existRes = await db.collection(COL).where({ word_id: db.command.in(ids) }).limit(1000).get();
  const existSet = new Set(existRes.data.map((d) => d.word_id));

  const todo = slice.filter((d) => !existSet.has(d.word_id));
  const stale = FORCE ? slice.filter((d) => existSet.has(d.word_id)) : [];

  if (todo.length > 0) {
    try {
      await db.collection(COL).add(todo);
      imported += todo.length;
    } catch (e) {
      // 个别环境/SDK 版本不接受数组入参，回退逐条写入，保证导得进去
      console.warn(`  批量写入失败，回退逐条写入：${e.message}`);
      for (const doc of todo) {
        try {
          await db.collection(COL).add(doc);
          imported += 1;
        } catch (e2) {
          failed += 1;
          console.warn(`  跳过 ${doc.word_id}：${e2.message}`);
        }
      }
    }
  }
  for (const doc of stale) {
    try {
      await db.collection(COL).where({ word_id: doc.word_id }).update({ data: doc });
      updated += 1;
    } catch (e) {
      failed += 1;
      console.warn(`  更新失败 ${doc.word_id}：${e.message}`);
    }
  }
  skipped += slice.length - todo.length - stale.length;
  console.log(`进度 ${Math.min(i + BATCH, docs.length)}/${docs.length}（新增 ${imported} / 更新 ${updated} / 跳过 ${skipped}）`);
}

console.log(`完成：新增 ${imported}，更新 ${updated}，已存在跳过 ${skipped}，失败 ${failed}`);

// 就地校验：写没写进去，直接用云端 count 说话
try {
  const { total } = await db.collection(COL).count();
  console.log(`云端校验：${COL} 现有 ${total} 条`);
  const one = await db.collection(COL).limit(1).get();
  console.log('样本：', JSON.stringify(one.data[0] || null).slice(0, 300));
} catch (e) {
  console.warn('校验失败：', e.message);
}

console.log(`提醒：首次导入后请在云开发控制台为 ${COL} 集合建 prefix 索引，读权限设为「所有用户可读」。`);
console.log('提醒：worddict 云函数需重新部署后才会按 lib 参数读到本集合。');
