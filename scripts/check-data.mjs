/**
 * 数据体检：直连云数据库，打印各集合文档数 + worddict 抽样一条。
 * 用来判断「页面没内容」到底是数据没导进去，还是查询/权限的问题。
 *
 * 用法：
 *   TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/check-data.mjs --env=<云环境ID>
 */
import CloudBase from '@cloudbase/node-sdk';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const env = args.env || process.env.TCB_ENV;
if (!env) { console.error('缺少 --env=<云环境ID>'); process.exit(1); }
if (!process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) {
  console.error('缺少环境变量 TCB_SECRET_ID / TCB_SECRET_KEY');
  process.exit(1);
}

const app = CloudBase.init({ env, secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY });
const db = app.database();

const COLLECTIONS = [
  'worddict',
  'content_files',
  'words',
  'study_records',
  'study_plans',
  'wrong_questions',
  'user_settings',
];

console.log(`云环境：${env}\n`);
for (const col of COLLECTIONS) {
  try {
    const { total } = await db.collection(col).count();
    console.log(`${total > 0 ? '✓' : '·'} ${col.padEnd(16)} ${total} 条`);
  } catch (e) {
    console.log(`✗ ${col.padEnd(16)} 查询失败：${e.message}`);
  }
}

console.log('');
for (const col of ['worddict', 'content_files']) {
  try {
    const res = await db.collection(col).limit(1).get();
    if (res.data.length === 0) {
      console.log(`[${col}] 空集合 —— 需要先跑对应的导入脚本`);
      continue;
    }
    const sample = JSON.stringify(res.data[0]);
    console.log(`[${col}] 样本：${sample.slice(0, 260)}${sample.length > 260 ? '…' : ''}`);
  } catch (e) {
    console.log(`[${col}] 抽样失败：${e.message}`);
  }
}

console.log('');
try {
  const letters = await db.collection('worddict')
    .where({ prefix: 'a' }).limit(1000).get();
  console.log(`抽样查询 prefix='a'：${letters.data.length} 条${letters.data.length >= 1000 ? '（已到单页上限）' : ''}`);
} catch (e) {
  console.log(`抽样查询失败：${e.message}`);
}
