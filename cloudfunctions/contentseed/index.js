/**
 * contentseed 云函数 —— 真题 / 故事内容播种，一次性工具，不参与日常业务。
 *
 * 存在的理由：官方开发者工具 CLI 的 cloud 子命令只有 env / functions，
 * 没有 storage / database，所以没法用「IDE 登录态」跑 scripts/upload-content.mjs
 * 那种走 secretId/secretKey 的脚本。这里的替代方案是：
 * 把内容数据内联进本函数（content-data.js，gzip+base64），随代码包上传，
 * 部署后由云函数自己用管理员权限写入云存储 + 登记 content_files 索引 —— 全程零密钥。
 *
 * 数据形态与 scripts/upload-content.mjs 完全一致：
 *   content/exams/{year}-e1|e2.json、content/exams/index.json
 *   content/stories/{id}.json、content/stories/index.json
 *
 * action:
 *   info        数据源信息 + 云端已登记条数（排查第一手信息）
 *   ensureCollection  幂等创建 content_files 集合
 *   import      逐条 uploadFile + 写索引，返回 { done, next, uploaded, failed, total }
 *               断点续跑：done=false 时把 next 作为 from 传回来继续
 *   verify      按 path 抽查若干条，确认能 downloadFile 并解析出 JSON
 *   clear       清空内容（云存储 + 索引），需 confirm
 */
const cloud = require('wx-server-sdk');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL_FILES = 'content_files';

const DATA_FILE = path.join(__dirname, 'content-data.js');

/** 解析内联数据（带缓存）。 */
let cache = null;
let dataSource = '';

function loadEntries() {
  if (cache) return cache;
  try {
    const mod = require(DATA_FILE);
    const raw = zlib.gunzipSync(Buffer.from(mod.GZ_B64, 'base64')).toString('utf8');
    cache = JSON.parse(raw);
    dataSource = 'inline';
    return cache;
  } catch (e) {
    throw new Error(
      `内容数据未随代码包上传（${e && e.message}）。请先执行 npm run content:build，再重新部署 contentseed。` +
        `目录实况：${describeDir(__dirname)}`
    );
  }
}

function describeDir(dir) {
  try {
    const names = fs.readdirSync(dir).sort();
    return `${dir} -> [${names.slice(0, 40).join(', ')}]`;
  } catch (e) {
    return `${dir} -> (读取失败：${e && e.message})`;
  }
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'info':
        return { ok: true, ...(await info()) };
      case 'ensureCollection':
        return { ok: true, report: await ensureCollection() };
      case 'import':
        return { ok: true, ...(await doImport(event)) };
      case 'verify':
        return { ok: true, ...(await verify(event)) };
      case 'clear':
        return await doClear(event);
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
};

async function info() {
  let total = -1;
  let loadError = '';
  try {
    total = loadEntries().length;
  } catch (e) {
    loadError = (e && e.message) || String(e);
  }
  let indexed = -1;
  let countError = '';
  try {
    indexed = (await db.collection(COL_FILES).count()).total;
  } catch (e) {
    countError = (e && e.message) || String(e);
  }
  return {
    total,
    source: dataSource,
    indexed,
    remaining: total > 0 && indexed > 0 ? Math.max(0, total - indexed) : total,
    loadError,
    countError,
    dirname: __dirname,
    dirnameListing: describeDir(__dirname),
  };
}

/** 幂等建集合：已存在会抛错，忽略即可。 */
async function ensureCollection() {
  const report = [];
  for (const name of [COL_FILES]) {
    try {
      await db.createCollection(name);
      report.push({ name, status: 'created' });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const existed = /exist|已存在|ALREADY_EXISTS|-501001/i.test(msg);
      report.push({ name, status: existed ? 'exists' : 'failed', msg: existed ? '' : msg });
    }
  }
  return report;
}

/**
 * 分批导入。uploadFile 比数据库写慢得多，单条实测约 200-600ms，
 * 所以预算压到 2.5 秒（默认超时 3 秒），到点主动返回断点，由页面续跑。
 * 幂等：写索引前先删同 path 的旧记录，云存储同 path 覆盖上传。
 */
async function doImport(event) {
  const entries = loadEntries();
  const from = Math.max(0, Number(event.from) || 0);
  const room = Math.max(0, entries.length - from);
  const requested = Number(event.size) || 0;
  const size = requested > 0 ? Math.min(requested, room) : room;
  const budget = Math.min(50000, Math.max(800, Number(event.timeBudgetMs) || 2500));
  const deadline = Date.now() + budget;
  const started = Date.now();

  let uploaded = 0;
  let failed = 0;
  const errors = [];
  let next = from;

  for (let i = 0; i < size; i += 1) {
    if (Date.now() > deadline) break;
    const entry = entries[from + i];
    if (!entry) break;
    try {
      await uploadOne(entry.path, entry.body);
      uploaded += 1;
      next = from + i + 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 5) errors.push({ path: entry.path, msg: String((e && e.message) || e) });
      // 不推进 next：下次重试这一条
      break;
    }
  }

  return {
    done: next >= entries.length,
    next,
    uploaded,
    failed,
    total: entries.length,
    elapsedMs: Date.now() - started,
    errors,
  };
}

async function uploadOne(cloudPath, body) {
  const { fileID } = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(JSON.stringify(body), 'utf8'),
  });
  // 索引登记（幂等：先删旧）
  const existing = await db.collection(COL_FILES).where({ path: cloudPath }).limit(100).get();
  for (const doc of existing.data) {
    await db.collection(COL_FILES).doc(doc._id).remove();
  }
  await db.collection(COL_FILES).add({
    data: { path: cloudPath, fileID, updated_at: Date.now() },
  });
  return fileID;
}

/** 抽查：按 path 取 fileID，下载并解析，确认内容真的可用。 */
async function verify(event) {
  const count = Math.min(20, Math.max(1, Number(event.count) || 5));
  const entries = loadEntries();
  const samples = event.paths && event.paths.length
    ? event.paths
    : pickSamples(entries.map((e) => e.path), count);

  const results = [];
  for (const p of samples) {
    try {
      const { data } = await db.collection(COL_FILES).where({ path: p }).limit(1).get();
      if (!data || data.length === 0) {
        results.push({ path: p, ok: false, msg: '索引里没有这条' });
        continue;
      }
      const res = await cloud.downloadFile({ fileID: data[0].fileID });
      const obj = JSON.parse(res.fileContent.toString('utf-8'));
      results.push({ path: p, ok: true, bytes: res.fileContent.length, keys: Object.keys(obj).slice(0, 8) });
    } catch (e) {
      results.push({ path: p, ok: false, msg: String((e && e.message) || e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return { checked: results.length, ok: okCount, failed: results.length - okCount, results };
}

function pickSamples(paths, n) {
  if (paths.length <= n) return paths;
  const step = Math.floor(paths.length / n);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(paths[Math.min(paths.length - 1, i * step)]);
  return out;
}

async function doClear(event) {
  if (!event.confirm) {
    const indexed = await db.collection(COL_FILES).count().then((r) => r.total).catch(() => -1);
    return { ok: true, done: false, needConfirm: true, indexed };
  }
  const budget = Math.min(50000, Math.max(800, Number(event.timeBudgetMs) || 2500));
  const deadline = Date.now() + budget;

  let removed = 0;
  let left = -1;
  while (Date.now() < deadline) {
    const batch = await db.collection(COL_FILES).limit(20).get();
    if (!batch.data.length) break;
    for (const doc of batch.data) {
      if (Date.now() > deadline) break;
      try {
        await cloud.deleteFile({ fileList: [doc.fileID] });
      } catch (e) {
        // 云存储文件可能已不存在，忽略即可
      }
      await db.collection(COL_FILES).doc(doc._id).remove();
      removed += 1;
    }
  }
  left = await db.collection(COL_FILES).count().then((r) => r.total).catch(() => -1);
  return { ok: true, done: left === 0, removed, left };
}
