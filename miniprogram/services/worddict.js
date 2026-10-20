/**
 * 词库查询 —— 云数据库 worddict 系列集合（由 worddict 云函数按 lib 分流）。
 * 全量词库不打包进小程序（规避 2MB 主包限制），也不整包拉回客户端：
 * 小程序链路单次响应上限 1MB，而词库 4801 条约 3.4MB，一次拉全量必然失败。
 * 所以「按字母浏览」「关键词搜索」「自动配词挑词」全部由云函数处理，只回传需要的那部分。
 *
 * lib 取值与 services/libraries.js 的词库 id 一致（'all' 考研 / 'ielts' 雅思），
 * 缺省 'all'——旧调用方不传也走考研集合，行为不变。
 */
import { callCloud } from './cloud';

/**
 * 词库 id → 云集合名。前端用它校验云函数实际查的是不是「我要的那个集合」。
 * 必须与 cloudfunctions/worddict/index.js 的 COLLECTIONS 保持一致。
 */
export const CLOUD_COLLECTION = { all: 'worddict', ielts: 'worddict_ielts' };

/**
 * 词库查询：keyword 走服务端正则前缀查询（search），无 keyword 才按整字母取（byLetter）。
 * 两者都已在云函数侧分页取全量，避免 limit(1000) 静默截断。
 *
 * ⚠️ 返回值里带 `staleCloud`：云函数实际查的集合与 lib 不符（**旧版云函数不认识 lib，
 * 会恒查考研集合**）。调用方据此忽略 words，改走本地词条，不能把考研数据当雅思展示。
 *
 * @param {{prefix?: string, keyword?: string, lib?: string}} opts
 */
export async function searchWorddict({ prefix = '', keyword = '', lib = 'all' } = {}) {
  const expect = CLOUD_COLLECTION[lib] || CLOUD_COLLECTION.all;
  const res = keyword
    ? await callCloud('worddict', { action: 'search', keyword, lib })
    : await callCloud('worddict', { action: 'byLetter', prefix, lib });
  const col = typeof res.col === 'string' ? res.col : '';
  // col 为空 = 云函数太旧、没这个字段（此时不判 stale，交给 count 那条校验）
  if (col && col !== expect) {
    return { words: [], truncated: false, staleCloud: true };
  }
  return {
    words: res.words || [],
    truncated: !!res.truncated,
    staleCloud: false,
  };
}

/**
 * 服务端挑选自动配词候选（原 AutoWordService 的候选池逻辑已挪到云函数里）。
 * @param {{exclude?: string[], ignored?: string[], limit?: number, seed?: number, lib?: string}} opts
 * @returns {Promise<{words: Array, candidates: number}>} candidates=0 表示候选池空
 */
export async function pickWorddict({ exclude = [], ignored = [], limit = 10, seed = 0, lib = 'all' } = {}) {
  const res = await callCloud('worddict', {
    action: 'pick',
    exclude,
    ignored,
    limit,
    seed,
    lib,
  });
  return { words: res.words || [], candidates: Number(res.candidates) || 0 };
}

/**
 * 词库真实总词条数（走云端 count，区别于 pick 的 candidates 短路计数器）。
 *
 * ⚠️ 同时回传云函数**实际查询的集合名** `col`：老版本云函数（未重部署）不认识 lib，
 * 会恒查考研集合并返回 4801。调用方据此判断「云端是否真的支持这个词库」，
 * 详见 dictionary-browse#ensureLocalCloudDecision。
 *
 * @param {string} [lib='all'] 词库 id
 * @returns {Promise<{total: number, col: string}>} col 为空表示云函数版本过旧、不可信
 */
export async function countWorddict(lib = 'all') {
  const res = await callCloud('worddict', { action: 'count', lib });
  return {
    total: Number(res.total) || 0,
    // 老版云函数没有这个字段 → 空串，前端据此回落本地
    col: typeof res.col === 'string' ? res.col : '',
  };
}
