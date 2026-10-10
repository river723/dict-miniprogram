/**
 * 内容上传：memo-grad src/data/realExams.json、stories.json → 云存储。
 * 拆分上传（按套卷 / 按章），运行时小程序按篇拉取，避免单文件过大。
 * 幂等：同路径覆盖上传。
 *
 * 用法：
 *   node scripts/upload-content.mjs --env=<云环境ID>
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import CloudBase from '@cloudbase/node-sdk';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const env = args.env || process.env.TCB_ENV;
if (!env) { console.error('缺少 --env'); process.exit(1); }

const app = CloudBase.init({ env, secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY });
const db = app.database();
const COL_FILES = 'content_files';

const tmp = mkdtempSync(join(tmpdir(), 'mg-content-'));

/**
 * 上传并把「云存储路径 → fileID」写进 content_files 集合。
 * 云函数里的 cloud.downloadFile 只认完整 fileID（cloud://<env>.<bucket>/<path>），
 * bucket 段无法从环境变量推导且每个环境不同，所以这里落一张索引表，运行时按路径查。
 * 幂等：同路径先删旧记录再写新记录。
 */
const upload = async (cloudPath, obj) => {
  const local = join(tmp, cloudPath.replaceAll('/', '_'));
  writeFileSync(local, JSON.stringify(obj));
  const { fileID } = await app.uploadFile({ cloudPath, filePath: local });
  const existing = await db.collection(COL_FILES).where({ path: cloudPath }).limit(1000).get();
  for (const doc of existing.data) {
    await db.collection(COL_FILES).doc(doc._id).remove();
  }
  await db.collection(COL_FILES).add({ path: cloudPath, fileID, updated_at: Date.now() });
  console.log('uploaded', cloudPath, '->', fileID);
};

// ---- 故事：按章一文件 + 索引 ----
const stories = JSON.parse(readFileSync(resolve(ROOT, '../memo-grad/src/data/stories.json'), 'utf8'));
for (const ch of stories.chapters) {
  await upload(`content/stories/${ch.id}.json`, ch);
}
await upload('content/stories/index.json', {
  series_title: stories.series_title,
  total_chapters: stories.total_chapters,
  chapters: stories.chapters.map(({ id, title, word_count, theme, summary }) => ({
    id, title, word_count, theme, summary,
  })),
});

console.log('内容上传完成');
