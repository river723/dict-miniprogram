/**
 * 词条补全服务 —— 统一解决「内置词库无释义 / 个别词查不到释义」。
 * 页面不再各自判断「这个词的释义从哪来」，只认这一个入口。
 *
 * 背景：小程序有两类词库，数据形态不同——
 *   · 云端词库 'all'（考研）：4801 词，带完整释义/例句/词根/记忆/易混词/难度/考频；
 *   · 词库 'ielts'（雅思）：4491 词，两层数据——
 *       ① 云端富词条集合 worddict_ielts（与考研同构，另带 phonetic_uk 音标）；
 *       ② 内置基础词条 data/libraries/ielts.js（{w, ph, d}，离线兜底）。
 *
 * 补全分层（按成本从低到高）：
 *   L1 本地内置词条 —— libraries.js#getLibraryEntry，同步、零成本、离线可用，
 *      但只有「单词+音标+整串中文释义」；
 *   L2 云端富词条   —— worddict 云函数 search（按 lib 选集合），需联网，
 *      返回结构化 definitions（含例句）/ 词根 / 记忆法 / 易混词 / 考频 / 难度。
 *
 * 两种典型用法：
 *   · 详情页要「即时渲染 + 到达后无缝升级」：先 enrichSync 拿本地词条上屏，
 *     再 enrichCloud 拿富词条覆盖（见 dictionary-word-detail）；
 *   · 只要一个答案：enrichOne（L1 优先， miss 才走 L2）。
 *
 * 缓存：进程内双 Map（L2 层与混合层分开，避免 L1 的简明结果挡住 L2 富结果），
 * key = `${libId}|${word.toLowerCase()}`。
 */
import { getLibraryEntry } from './libraries';
import { searchWorddict } from './worddict';

const oneCache = new Map();   // enrichOne：libId|word → 词条|null
const cloudCache = new Map(); // enrichCloud：libId|word → 富词条|null
const cacheKey = (libId, word) => `${libId || ''}|${String(word).toLowerCase()}`;

const num = (n, dflt) => (Number.isFinite(Number(n)) ? Number(n) : dflt);

/**
 * 云端词条 → 统一富词条结构。
 * 兼容两个集合的字段差异：雅思集合用 phonetic_uk，考研集合无音标字段。
 */
function fromCloudEntry(hit) {
  const definitions = (Array.isArray(hit.definitions) ? hit.definitions : [])
    .filter((d) => d && String(d.meaning || '').trim())
    .map((d) => ({
      part_of_speech: String(d.part_of_speech || d.pos || '').trim(),
      meaning: String(d.meaning || '').trim(),
      example: String(d.example || '').trim(),
      is_core: !!d.is_core,
      is_rare_sense: !!d.is_rare_sense,
    }));
  // part_of_speech 可能自带点（"v."/"vt."），归一成「恰好一个点」再拼，避免 "v.."
  const posOf = (p) => {
    const s = String(p || '').trim();
    return s ? `${s.replace(/\.+$/, '')}.` : '';
  };
  const parts = definitions.map((d) => {
    const pos = posOf(d.part_of_speech);
    return pos ? `${pos} ${d.meaning}` : d.meaning;
  });
  const similarWords = (Array.isArray(hit.similar_words) ? hit.similar_words : [])
    .filter((s) => s && String(s.word || '').trim())
    .map((s) => ({
      word: String(s.word).trim(),
      relation: ['spelling', 'meaning', 'pronunciation'].includes(s.relation) ? s.relation : 'spelling',
      description: String(s.description || '').trim(),
    }));
  return {
    word: hit.word,
    ph: hit.phonetic_uk || hit.pronunciation_uk || hit.pronunciation_us || '',
    // 兼容字段：义项串（列表行/兜底展示用）；富内容走下面的结构化字段
    def: parts.join('；').slice(0, 300),
    src: 'cloud',
    definitions,
    etymology: String(hit.etymology || '').trim(),
    similar_words: similarWords,
    memory_tip: String(hit.memory_tip || '').trim(),
    frequency: num(hit.frequency, 1),
    difficulty: num(hit.difficulty, 3),
    extra: hit, // 原始云文档，调用方要冷门字段时从这里取
  };
}

/**
 * 同步补全：只查本地内置词条（渲染路径要求同步时用，如列表行/首屏）。
 * 命中返回 {word, ph, def, frequency, difficulty, src:'local'}，否则 null。
 *
 * 考频/难度：内置词库条目自带 f/k（由 _tools/relabel_ielts_metrics.cjs 按真实语料
 * 频次 + AWL 学术加权、以及音节/派生/义项等客观指标算出），这里归一成长名字段透出，
 * 让本地模式与云端模式的调用方（详情页/浏览页）用同一套字段名，不需要各自判断来源。
 */
export function enrichSync(libId, word) {
  if (!word) return null;
  const e = getLibraryEntry(libId, word);
  if (!e) return null;
  const hasMetric = Number.isFinite(Number(e.f)) && Number(e.f) >= 1;
  const hasDiff = Number.isFinite(Number(e.k)) && Number(e.k) >= 1;
  const row = { word: e.w, ph: e.ph || '', def: e.d || '', src: 'local' };
  if (hasMetric) row.frequency = Number(e.f);
  if (hasDiff) row.difficulty = Number(e.k);
  return row;
}

/**
 * 云端富词条（L2）：按 libId 选云集合作精确前缀查询，返回富词条或 null。
 * 只走云端、不看本地——详情页「本地即时 + 云端升级」模式里负责升级那一步。
 * 结果进 cloudCache；null（未命中/查询失败）也缓存，避免同词重复请求。
 */
export async function enrichCloud(libId, word) {
  if (!word) return null;
  const k = cacheKey(libId, word);
  if (cloudCache.has(k)) return cloudCache.get(k);

  let row = null;
  try {
    const res = await searchWorddict({ keyword: word, lib: libId || 'all' });
    const list = res.words || [];
    const hit = list.find((w) => String(w.word).toLowerCase() === String(word).toLowerCase()) || null;
    if (hit) row = fromCloudEntry(hit);
  } catch (e) {
    console.warn('[wordEnrich] 云端补全失败', word, (e && e.errMsg) || e);
  }

  cloudCache.set(k, row);
  return row;
}

/**
 * 完整补全（混合层）：本地 → 云端。返回统一词条或 null（两层都没有）。
 * 语义是「尽快给个能用的」：本地命中就用本地简明词条，不为此多等一次网络。
 * 要富词条（结构化释义/词根/记忆法）请用 enrichCloud。
 * @param {string} libId 词库 id（决定本地层查哪张表、云端选哪个集合）
 * @param {string} word  单词
 */
export async function enrichOne(libId, word) {
  if (!word) return null;
  const k = cacheKey(libId, word);
  if (oneCache.has(k)) return oneCache.get(k);

  const local = enrichSync(libId, word);
  if (local) {
    oneCache.set(k, local);
    return local;
  }

  const row = await enrichCloud(libId, word);
  oneCache.set(k, row);
  return row;
}

/**
 * 批量补全：words 为单词数组，逐词走 enrichOne，受限并发（默认 6）。
 * 返回 Map：小写单词 → 词条|null。调用方自行把结果合并进自己的行对象。
 * 已命中本地层的词不发起云端请求。
 */
export async function enrichBatch(libId, words, concurrency = 6) {
  const out = new Map();
  const uniq = [];
  (words || []).forEach((w) => {
    const k = String(w).toLowerCase();
    if (!k || out.has(k)) return;
    out.set(k, enrichSync(libId, w)); // 先同步填本地层
    if (!out.get(k)) uniq.push(w);
  });

  let idx = 0;
  const worker = async () => {
    while (idx < uniq.length) {
      const w = uniq[idx];
      idx += 1;
      // eslint-disable-next-line no-await-in-loop
      out.set(String(w).toLowerCase(), await enrichOne(libId, w));
    }
  };
  const size = Math.max(1, Math.min(concurrency, uniq.length));
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

/** 清空进程内缓存（切词库/调试用）。 */
export function clearEnrichCache() {
  oneCache.clear();
  cloudCache.clear();
}
