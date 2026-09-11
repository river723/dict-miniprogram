/**
 * seed 云函数 —— 词库播种 / 环境初始化，一次性工具，不参与日常业务。
 *
 * 存在的理由：4801 条词库数据手动导入太累，脚本导入又要腾讯云密钥。
 * 词库总共才 3.6MB，直接放进本函数的 data/ 目录随代码一起上传，
 * 部署后在小程序「设置 → 数据初始化」点一下就能全量灌进去。
 *
 * 注意：wx-server-sdk 的 collection.add() 只支持单条，没有批量插入，
 * 所以用「有限并发 + 时间预算」的方式跑，超时了返回 next 断点续跑，
 * 靠 completed[] 精确记录哪些真正写成功了，保证不重不漏。
 *
 * action:
 *   ensureCollections   幂等建齐集合
 *   stats               各集合文档数
 *   info                数据源信息 + 云端现有条数
 *   importWorddict      导入词库，{ from, size, concurrency, timeBudgetMs, skipExisting }
 *                       返回 { done, next, imported, failed, skipped, total }；done=false 时
 *                       把 next 再作为 from 传进来继续。
 *                       默认幂等：写入前先载入云端已有的 word_id 并跳过，重复点也不会插重。
 *   dedupeWorddict      去重体检 / 清理重复：不加 confirm 只出报告，{ confirm: true } 才真删。
 *                       保留每个 word_id 的最早一条，多余副本按 _id 分批删除。
 *   clearWorddict       清空词库（需 confirm: true），重导前用
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DATA_COLLECTION = 'worddict';

/**
 * 词库数据源：优先用与 index.js 同级的 seed-data.js（内联 gzip+base64），
 * 找不到时退回 data/part-*.json.gz 分片。
 *
 * 为什么内联优先：曾遇到线上跑起来报 ENOENT '/var/user/data'，
 * 即子目录没有随代码包落地（云端包里有文件，但运行时目录里没有）。
 * 根目录的 .js 模块与入口同级，最不容易出意外。
 */
const DATA_DIR = path.join(__dirname, 'data');
const INLINE_DATA = path.join(__dirname, 'seed-data.js');

const SYSTEM_COLLECTIONS = [
  { name: 'words', desc: '生词本' },
  { name: 'study_records', desc: '学习记录' },
  { name: 'study_plans', desc: '复习计划' },
  { name: 'wrong_questions', desc: '错题本' },
  { name: 'user_settings', desc: '用户设置' },
  { name: DATA_COLLECTION, desc: '词库（建议所有用户可读 + prefix 索引）' },
  { name: 'content_files', desc: '云存储路径→fileID 映射' },
];

let cache = null;
let dataSource = ''; // 'inline' | 'files' —— 记录这次实际用的数据源

/** 诊断用：把 __dirname 里的实际内容列出来，出错时能一眼看出数据到底在不在。 */
function describeDir(dir) {
  try {
    const names = fs.readdirSync(dir).sort();
    return `${dir} -> [${names.slice(0, 40).join(', ')}${names.length > 40 ? `, …共 ${names.length} 项` : ''}]`;
  } catch (e) {
    return `${dir} -> (读取失败：${e && e.message})`;
  }
}

/** 分片文件列表。dir 省略时读 data/；传入 __dirname 可用于兜底「子目录被拍平」的情况。 */
function listDataFiles(dir = DATA_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json.gz') || f.endsWith('.json'))
    .sort();
}

/** 从某个目录读取全部分片并拼接。 */
function readChunks(dir) {
  const acc = [];
  for (const f of listDataFiles(dir)) {
    const buf = fs.readFileSync(path.join(dir, f));
    const text = f.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    acc.push(...JSON.parse(text));
  }
  return acc;
}

/** 读取全部词库数据（首次调用后缓存在实例内存里，断点续跑不用重复解析）。 */
function loadAll() {
  if (cache) return cache;
  const problems = [];

  // 1) 内联模块
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require('./seed-data');
    if (Array.isArray(mod)) {
      cache = mod;
      dataSource = 'inline';
      return cache;
    }
    if (typeof mod === 'string' && mod.length > 0) {
      cache = JSON.parse(zlib.gunzipSync(Buffer.from(mod, 'base64')).toString('utf8'));
      dataSource = 'inline';
      return cache;
    }
    problems.push(`seed-data.js 内容格式不对（应为 base64 字符串或数组，实际是 ${typeof mod}）`);
  } catch (e) {
    problems.push(`require('./seed-data') 失败：${e && e.message}`);
  }

  // 2) data/ 分片
  try {
    const files = listDataFiles(DATA_DIR);
    if (files.length > 0) {
      cache = readChunks(DATA_DIR);
      dataSource = 'files';
      return cache;
    }
    problems.push(`${DATA_DIR} 下没有 .json.gz / .json 分片`);
  } catch (e) {
    problems.push(`读取 ${DATA_DIR} 失败：${e && e.message}`);
  }

  // 3) 兜底：分片被拍平到函数根目录的情况
  try {
    const flat = listDataFiles(__dirname).filter((f) => f.startsWith('part-'));
    if (flat.length > 0) {
      cache = readChunks(__dirname);
      dataSource = 'files-flat';
      return cache;
    }
  } catch (e) {
    problems.push(`扫描 ${__dirname} 失败：${e && e.message}`);
  }

  throw new Error(
    `词库数据未随代码包上传。请执行 npm run seed:build 后重新部署 seed 云函数。` +
      `排查信息：${problems.join('；')}。目录实况：${describeDir(__dirname)}`,
  );
}

exports.main = async (event = {}) => {
  try {
    switch (event.action) {
      case 'ensureCollections':
        return { ok: true, report: await ensureCollections() };
      case 'stats':
        return { ok: true, stats: await stats() };
      case 'info':
        return { ok: true, ...(await info()) };
      case 'diag':
        return { ok: true, ...diag() };
      case 'importWorddict':
        return { ok: true, ...(await importWorddict(event)) };
      case 'dedupeWorddict':
        return { ok: true, ...(await dedupeWorddict(event)) };
      case 'clearWorddict':
        return await clearWorddict(event);
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
};

/** 幂等建集合：已存在会抛错，忽略即可。 */
async function ensureCollections() {
  const report = [];
  for (const c of SYSTEM_COLLECTIONS) {
    try {
      await db.createCollection(c.name);
      report.push({ name: c.name, status: 'created', desc: c.desc });
    } catch (e) {
      const msg = String((e && e.message) || e);
      const existed = /exist|已存在|ALREADY_EXISTS|-501001/i.test(msg);
      report.push({ name: c.name, status: existed ? 'exists' : 'failed', msg: existed ? '' : msg });
    }
  }
  return report;
}

async function stats() {
  const out = {};
  for (const c of SYSTEM_COLLECTIONS) {
    try {
      const r = await db.collection(c.name).count();
      out[c.name] = r.total;
    } catch {
      out[c.name] = -1; // -1 = 集合不存在或不可访问
    }
  }
  return out;
}

async function info() {
  // 数据有没有随代码包上去、走的是哪条数据源，是排查导入问题的第一手信息
  let total = -1;
  let parts = -1;
  let source = '';
  let loadError = '';
  try {
    cache = null; // 每次 info 都重新解析，避免把上一次的失败/成功状态缓存住
    total = loadAll().length;
    source = dataSource;
  } catch (e) {
    loadError = String((e && e.message) || e);
    try {
      parts = listDataFiles().length;
      if (parts > 0) source = 'files';
    } catch {}
  }
  let cloudCount = -1;
  let countError = '';
  try {
    cloudCount = (await db.collection(DATA_COLLECTION).count()).total;
  } catch (e) {
    countError = String((e && e.message) || e);
  }
  return {
    total,
    parts,
    source,
    cloudCount,
    remaining: total > 0 && cloudCount > 0 ? Math.max(0, total - cloudCount) : total,
    loadError,
    countError,
  };
}

/** 环境自证：数据在哪、运行时看到的目录长什么样。 */
function diag() {
  let resolved = '';
  let loadError = '';
  try {
    cache = null;
    resolved = `条数 ${loadAll().length}`;
  } catch (e) {
    loadError = String((e && e.message) || e);
  }
  return {
    dirname: __dirname,
    cwd: process.cwd(),
    hasInline: fs.existsSync(INLINE_DATA),
    hasDataDir: fs.existsSync(DATA_DIR),
    resolved,
    loadError,
    dirnameListing: describeDir(__dirname),
    dataListing: describeDir(DATA_DIR),
  };
}

/**
 * 分批并发写入。真正在桶时间不够时会提前收手并返回断点。
 * completed[] 按索引记录「已确认处理」，结束时从头部扫到第一个未完成的位置作为 next，
 * 这样既不重复写也不漏写。
 *
 * 幂等：写入前先把云端已有的 word_id 读进内存（skipExisting !== false 时），
 * 已存在的索引直接标记完成并计入 skipped。这样重复点「一键导入」、或者中断后重跑，
 * 都不会再产生重复数据（早期版本没有这一步，重复点就会整批再插一遍）。
 */
async function importWorddict(event) {
  const all = loadAll();
  const from = Math.max(0, Number(event.from) || 0);
  const requested = Number(event.size) || 0;
  const room = Math.max(0, all.length - from);
  const size = requested > 0 ? Math.min(requested, room) : room;
  const concurrency = Math.min(50, Math.max(1, Number(event.concurrency) || 20));
  // 小程序云函数默认 timeout 只有 3 秒，所以默认预算压到 2.2 秒：
  // 到点主动返回 { done:false, next }，由页面接着下一轮，而不是被平台掐断（-504003）。
  // 在控制台把函数超时调大后，可以传更大的 timeBudgetMs。
  const budget = Math.min(50000, Math.max(800, Number(event.timeBudgetMs) || 2200));
  const deadline = Date.now() + budget;

  const existing = event.skipExisting === false ? null : await existingWordIds();

  // 待写清单：跳过云端已有，其余按 slot（在本次区间内的下标）排队并发写
  const completed = new Array(size).fill(false);
  const todo = [];
  let skipped = 0;
  for (let k = 0; k < size; k += 1) {
    const doc = all[from + k];
    if (existing && doc && existing.has(doc.word_id)) {
      completed[k] = true; // 云端已有，视为已完成，不再写
      skipped += 1;
      continue;
    }
    todo.push({ slot: k, doc });
  }

  const errors = [];
  let imported = 0;
  let failed = 0;
  let cursor = 0;
  let stopped = false;

  const worker = async () => {
    while (true) {
      if (Date.now() > deadline) {
        stopped = true;
        return;
      }
      const j = cursor;
      if (j >= todo.length) return;
      cursor += 1;
      const { slot, doc } = todo[j];
      try {
        await db.collection(DATA_COLLECTION).add({ data: doc });
        imported += 1;
      } catch (e) {
        failed += 1;
        if (errors.length < 5) errors.push({ word: doc && doc.word, msg: String((e && e.message) || e) });
      } finally {
        completed[slot] = true;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  // next = 连续已完成区间的末端，断点续跑从这里继续
  let p = 0;
  while (p < completed.length && completed[p]) p += 1;
  const next = from + p;

  return {
    done: next >= all.length,
    from,
    next,
    imported,
    failed,
    skipped,
    errors,
    stopped, // true 表示本次是撞到时间预算才停的，不是写完了
    total: all.length,
    elapsedMs: budget - (deadline - Date.now()),
  };
}

/** 云端现有的全部 word_id。分页读取，用实际返回条数推进游标（即使平台压低 limit 也不会漏）。 */
async function existingWordIds() {
  const set = new Set();
  const PAGE = 1000;
  let skip = 0;
  for (let round = 0; round < 200; round += 1) {
    const res = await db
      .collection(DATA_COLLECTION)
      .field({ word_id: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get();
    if (!res.data.length) break;
    for (const d of res.data) if (d.word_id) set.add(d.word_id);
    skip += res.data.length;
  }
  return set;
}

/**
 * 去重体检 / 清理。
 * 默认只出报告（不传 confirm），看清楚再删；传 { confirm: true } 才真删。
 * 规则：同一个 word_id 保留 _id 最小的一条，其余作为多余副本删除。
 * 不在内置词库里的文档（可能是别的来源）只统计不删，避免误伤。
 */
async function dedupeWorddict(event) {
  const sourceIds = new Set();
  for (const d of loadAll()) if (d && d.word_id) sourceIds.add(d.word_id);

  const byId = new Map(); // word_id -> [_id, ...]
  const orphanSamples = [];
  let total = 0;
  let noWordId = 0;
  let notInSource = 0;

  const PAGE = 1000;
  let skip = 0;
  for (let round = 0; round < 200; round += 1) {
    const res = await db
      .collection(DATA_COLLECTION)
      .field({ _id: true, word_id: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get();
    if (!res.data.length) break;
    for (const d of res.data) {
      total += 1;
      if (!d.word_id) {
        noWordId += 1; // 缺字段的文档不动，单独计数
        continue;
      }
      if (!sourceIds.has(d.word_id)) {
        notInSource += 1;
        if (orphanSamples.length < 10) orphanSamples.push(d.word_id);
      }
      const arr = byId.get(d.word_id);
      if (arr) arr.push(d._id);
      else byId.set(d.word_id, [d._id]);
    }
    skip += res.data.length;
  }

  const dupSamples = [];
  const extras = [];
  let duplicateGroups = 0;
  for (const [wordId, ids] of byId) {
    if (ids.length < 2) continue;
    duplicateGroups += 1;
    if (dupSamples.length < 10) dupSamples.push({ word_id: wordId, count: ids.length });
    ids.sort();
    extras.push(...ids.slice(1)); // 保留 _id 最小的一条
  }

  const report = {
    total,
    unique: byId.size,
    duplicateGroups, // 有重复的 word_id 组数
    extraDocs: extras.length, // 多余副本总数（= 去重后能省下的条数）
    notInSource,
    noWordId,
    dupSamples,
    orphanSamples,
  };

  if (event.confirm !== true) {
    return { ...report, dryRun: true, removed: 0, done: extras.length === 0 };
  }

  // 同上：小程序云函数默认 3 秒超时，删不完就先返回，由页面接着续跑（下一轮重新扫描，安全）
  const budget = Math.min(50000, Math.max(500, Number(event.timeBudgetMs) || 2200));
  const deadline = Date.now() + budget;
  let removed = 0;
  const CONCURRENCY = 20;
  for (let i = 0; i < extras.length; i += CONCURRENCY) {
    if (Date.now() > deadline) break;
    const batch = extras.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((id) =>
        db
          .collection(DATA_COLLECTION)
          .doc(id)
          .remove()
          .then(() => true)
          .catch(() => false),
      ),
    );
    removed += results.filter(Boolean).length;
  }

  const remainingDuplicates = extras.length - removed;
  return { ...report, dryRun: false, removed, remainingDuplicates, done: remainingDuplicates === 0 };
}

/** 清空词库。
 * 云函数端不支持无 where 的 remove，所以按 _id 分批删。
 * 注意：小程序云函数默认 timeout 只有 3 秒，一次性删几千条必被平台掐断
 * （报 -504003 Invoking task timed out），所以这里做成「时间预算内能删多少删多少，
 * 返回 done/left，由页面接着多轮续跑」。删并发也不能开太大，1000 个并发 remove
 * 会被限流反而更慢。
 */
async function clearWorddict(event) {
  if (event.confirm !== true) {
    return { ok: false, error: '该操作会清空 worddict 全部数据，请传 { confirm: true }' };
  }
  const budget = Math.min(50000, Math.max(800, Number(event.timeBudgetMs) || 2000));
  const deadline = Date.now() + budget;
  const PAGE = 500;
  const CONCURRENCY = 20;
  let removed = 0;

  for (let round = 0; round < 40; round += 1) {
    if (Date.now() > deadline) {
      const left = await safeCount();
      return { ok: true, removed, done: left === 0, left, timedOut: true };
    }
    const res = await db.collection(DATA_COLLECTION).limit(PAGE).field({ _id: true }).get();
    if (!res.data.length) return { ok: true, removed, done: true, left: 0 };

    const ids = res.data.map((d) => d._id);
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const r = await Promise.all(
        batch.map((id) =>
          db
            .collection(DATA_COLLECTION)
            .doc(id)
            .remove()
            .then(() => 1)
            .catch(() => 0),
        ),
      );
      removed += r.reduce((a, b) => a + b, 0);
      if (Date.now() > deadline) break;
    }
  }

  const left = await safeCount();
  return { ok: true, removed, done: left === 0, left, timedOut: true };
}

async function safeCount() {
  try {
    return (await db.collection(DATA_COLLECTION).count()).total;
  } catch {
    return -1; // 集合不存在或不可访问
  }
}
