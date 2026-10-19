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
 * 词库查询：keyword 走服务端正则前缀查询（search），无 keyword 才按整字母取（byLetter）。
 * 两者都已在云函数侧分页取全量，避免 limit(1000) 静默截断。
 * @param {{prefix?: string, keyword?: string, lib?: string}} opts
 */
export async function searchWorddict({ prefix = '', keyword = '', lib = 'all' } = {}) {
  if (keyword) {
    const res = await callCloud('worddict', { action: 'search', keyword, lib });
    return { words: res.words || [], truncated: false };
  }
  const res = await callCloud('worddict', { action: 'byLetter', prefix, lib });
  return { words: res.words || [], truncated: !!res.truncated };
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
 * @param {string} [lib='all'] 词库 id
 * @returns {Promise<number>}
 */
export async function countWorddict(lib = 'all') {
  const res = await callCloud('worddict', { action: 'count', lib });
  return Number(res.total) || 0;
}
