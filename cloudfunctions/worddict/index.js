/**
 * worddict 云函数 —— 词库查询。
 * worddict.json（约 4.9MB）由 scripts/import-worddict.mjs 幂等导入云数据库
 * worddict 集合（按 word_id 去重），不打包进小程序。
 * 需在云控制台为 worddict 集合建立 prefix 字段索引，并将读权限设为「所有用户可读」。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COL = 'worddict';

exports.main = async (event) => {
  try {
    switch (event.action) {
      case 'byLetter': {
        // 热门字母（s/c/p…）可能远超 1000 条，必须分页取完，否则列表被静默截断
        const prefix = (event.prefix || 'a').toLowerCase();
        return { ok: true, ...(await fetchByPrefix(prefix)) };
      }
      case 'search': {
        const kw = (event.keyword || '').toLowerCase().trim();
        if (!kw) return { ok: true, words: [] };
        const res = await db.collection(COL)
          .where({ word: db.RegExp({ regexp: `^${escapeRe(kw)}`, options: 'i' }) })
          .limit(50)
          .get();
        return { ok: true, words: res.data };
      }
      case 'pick': {
        // 自动配词的候选挑选放服务端做：小程序链路单次响应上限 1MB，
        // 4801 条整包约 3.4MB，客户端「拉全量自己挑」必报 EXCEED_MAX_RESPONSE_SIZE。
        // 这里只回传最终选中的 limit 条（几百字节到几 KB）。
        return { ok: true, ...(await pick(event)) };
      }
      case 'all': {
        // ⚠️ 不要给客户端用：见 pick 的说明，4801 条会超过 1MB 响应上限。
        // 保留此 action 仅供开发者工具「云端测试」排查，且超体积时直接给出明确错误。
        const MAX = 1000;
        let skip = 0;
        let all = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = await db.collection(COL)
            .field({ word: true, word_id: true, definitions: true, frequency: true, difficulty: true })
            .skip(skip).limit(MAX).get();
          all = all.concat(res.data);
          if (res.data.length < MAX) break;
          skip += MAX;
        }
        const bytes = Buffer.byteLength(JSON.stringify(all));
        if (bytes > 900 * 1024) {
          return {
            ok: false,
            total: all.length,
            sizeMB: Math.round((bytes / 1024 / 1024) * 100) / 100,
            error: `词库 ${all.length} 条约 ${Math.round((bytes / 1024 / 1024) * 10) / 10}MB，超过小程序链路 1MB 响应上限，请改用 pick action`,
          };
        }
        return { ok: true, words: all };
      }
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    console.error('[worddict]', e);
    return { ok: false, error: e.message };
  }
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PAGE = 1000;

/** 归一化成小写字符串集合。 */
function normSet(list) {
  const set = new Set();
  if (Array.isArray(list)) for (const w of list) if (w) set.add(String(w).toLowerCase());
  return set;
}

/**
 * 服务端挑选「今日新词」。
 * 语义与原 App AutoWordService 一致：剔除生词本已有（含软删除）与忽略词后，
 * 按考频降序分档，档内用日期种子确定性洗牌（同一天结果一致），取前 limit 个。
 *
 * 优化：不扫全表。按 frequency 降序最多取 3 页（3000 条）就够挑出十个词，
 * 集满 200 个候选即提前停（top tier 才 250 条，够用且省时间）。
 *
 * event: { exclude: [word], ignored: [word], limit, seed }
 * 返回: { words, candidates, scanned }  candidates=0 表示候选池空，调用方走复习兜底
 */
async function pick(event) {
  const exclude = normSet(event.exclude);
  const ignored = normSet(event.ignored);
  const limit = Math.min(50, Math.max(1, Number(event.limit) || 10));
  const seed = Number(event.seed) || 0;
  const FIELDS = { word: true, definitions: true, frequency: true, difficulty: true };

  const groups = new Map(); // frequency -> [doc]
  let candidates = 0;
  let scanned = 0;
  let skip = 0;

  for (let page = 0; page < 3; page += 1) {
    const res = await db.collection(COL)
      .field(FIELDS)
      .orderBy('frequency', 'desc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get();
    if (!res.data.length) break;
    for (const d of res.data) {
      scanned += 1;
      const key = String(d.word || '').toLowerCase();
      if (!key || exclude.has(key) || ignored.has(key)) continue;
      candidates += 1;
      const f = Number(d.frequency) || 0;
      const g = groups.get(f);
      if (g) g.push(d);
      else groups.set(f, [d]);
    }
    skip += res.data.length;
    if (candidates >= 200 || res.data.length < PAGE) break;
  }

  // 考频降序 + 档内按日期种子确定性洗牌
  const rand = mulberry32(seed);
  const ordered = [];
  for (const f of Array.from(groups.keys()).sort((a, b) => b - a)) {
    const g = groups.get(f);
    for (let i = g.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const t = g[i];
      g[i] = g[j];
      g[j] = t;
    }
    ordered.push(...g);
  }

  return { words: ordered.slice(0, limit), candidates, scanned };
}

/** 与客户端/主仓同款确定性伪随机（同一天同一批词）。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_TOTAL = 5000; // 单个字母的保护上限，超出则认为数据异常并告知调用方

/** 按字母前缀分页取全量，返回是否被截断（供 UI 提示）。 */
async function fetchByPrefix(prefix) {
  let skip = 0;
  let words = [];
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await db.collection(COL).where({ prefix }).skip(skip).limit(PAGE).get();
    words = words.concat(res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
    if (words.length >= MAX_TOTAL) { truncated = true; break; }
  }
  return { words, truncated };
}
