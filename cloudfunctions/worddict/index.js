/**
 * worddict 云函数 —— 词库查询。
 * worddict.json（约 4.9MB）由 scripts/import-worddict.mjs 幂等导入云数据库
 * worddict 集合（按 word_id 去重），不打包进小程序。
 * 需在云控制台为 worddict 集合建立 prefix 字段索引，并将集合权限设为「仅管理端可读写」。
 * ⚠ **不要设成「所有用户可读」**：本项目前端 0 处直连数据库（全部走本云函数），
 *   开放客户端读权限只是白开一个泄漏面；开放写权限更是严重后门 ——
 *   任何人拿到小程序都能改全站词库。用小程序「设置 → 安全自检」可验证。
 *
 * 多词库：event.lib 选择集合，缺省 'all'（考研，向后兼容）：
 *   all   → worddict        考研 4801
 *   ielts → worddict_ielts  雅思 4491（scripts/import-worddict-ielts.mjs 导入）
 * 两个集合文档结构一致（word_id/word/prefix/definitions/etymology/similar_words/
 * memory_tip/frequency/difficulty；雅思集合额外带 phonetic_uk）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = { all: 'worddict', ielts: 'worddict_ielts' };

/** event.lib → 集合名；未知/缺省回落 'all'（考研），保证旧调用方行为不变。 */
function colOf(event) {
  return COLLECTIONS[event && event.lib] || COLLECTIONS.all;
}

exports.main = async (event) => {
  const COL = colOf(event);
  try {
    switch (event.action) {
      case 'byLetter': {
        // 热门字母（s/c/p…）可能远超 1000 条，必须分页取完，否则列表被静默截断
        const prefix = (event.prefix || 'a').toLowerCase();
        return { ok: true, col: COL, ...(await fetchByPrefix(COL, prefix)) };
      }
      case 'search': {
        const kw = (event.keyword || '').toLowerCase().trim();
        if (!kw) return { ok: true, col: COL, words: [] };
        const res = await db.collection(COL)
          .where({ word: db.RegExp({ regexp: `^${escapeRe(kw)}`, options: 'i' }) })
          .limit(50)
          .get();
        return { ok: true, col: COL, words: res.data };
      }
      case 'pick': {
        // 自动配词的候选挑选放服务端做：小程序链路单次响应上限 1MB，
        // 4801 条整包约 3.4MB，客户端「拉全量自己挑」必报 EXCEED_MAX_RESPONSE_SIZE。
        // 这里只回传最终选中的 limit 条（几百字节到几 KB）。
        return { ok: true, col: COL, ...(await pick(event, COL)) };
      }
      case 'count': {
        // 词库总词条数（供词库列表/浏览页展示真实规模）。
        // ⚠️ 千万别用 pick 的 candidates 当总数：candidates 只是自动配词算法的
        // 短路计数器（只扫 top 频率页、集满 200 即停），不是库的真实大小。
        //
        // ⚠️ 必须回传 col（实际查询的集合名）：本函数按 lib 分流，若线上部署的还是
        // **不认识 lib 的旧版**，它会恒查考研集合并返回 4801。前端原来只比「数量是否
        // ≥ 本地词条数」，4801 ≥ 4491 会被误判成「云端更全，切云端」→ 雅思浏览页
        // 整个显示成考研词表，雅思独有词（fusion/enzyme/…）全都搜不到。
        // 前端改为校验 res.col === 期望集合名，不匹配即回落本地。
        const res = await db.collection(COL).count();
        return { ok: true, total: res.total, col: COL };
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
async function pick(event, COL) {
  const exclude = normSet(event.exclude);
  const ignored = normSet(event.ignored);
  const limit = Math.min(50, Math.max(1, Number(event.limit) || 10));
  const seed = Number(event.seed) || 0;
  // 必须回传词库里已存的完整字段，否则自动配词补进生词本的词会丢词根/记忆/易混词
  // （这些字段在 worddict 集合里有存，但之前 FIELDS 没选，导致 addWord 时落到默认值空）。
  // 音标：考研集合未存（发音走 TTS 云函数）；雅思集合带 phonetic_uk，一并选出来。
  const FIELDS = {
    word: true,
    phonetic_uk: true,
    definitions: true,
    frequency: true,
    difficulty: true,
    etymology: true,
    similar_words: true,
    memory_tip: true,
  };

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

/**
 * 按字母前缀分页取全量，返回是否被截断（供 UI 提示）。
 * 只取列表需要的字段：词根/记忆法/易混词体积大且列表不展示，裁剪后可把热门字母的
 * 响应压到 1MB 链路上限以内（详情页按词精确查询时再取全文档）。
 */
async function fetchByPrefix(COL, prefix) {
  let skip = 0;
  let words = [];
  let truncated = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await db.collection(COL)
      .field({ word: true, prefix: true, phonetic_uk: true, definitions: true, frequency: true, difficulty: true })
      .where({ prefix })
      .skip(skip).limit(PAGE).get();
    words = words.concat(res.data);
    if (res.data.length < PAGE) break;
    skip += PAGE;
    if (words.length >= MAX_TOTAL) { truncated = true; break; }
  }
  return { words, truncated };
}
