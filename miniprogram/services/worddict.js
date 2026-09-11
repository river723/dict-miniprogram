/**
 * 词库查询 —— 云数据库 worddict 集合。
 * 全量词库不打包进小程序（规避 2MB 主包限制），也不整包拉回客户端：
 * 小程序链路单次响应上限 1MB，而词库 4801 条约 3.4MB，一次拉全量必然失败。
 * 所以「按字母浏览」「关键词搜索」「自动配词挑词」全部由云函数处理，只回传需要的那部分。
 */
import { callCloud } from './cloud';

/**
 * 词库查询：keyword 走服务端正则前缀查询（search），无 keyword 才按整字母取（byLetter）。
 * 两者都已在云函数侧分页取全量，避免 limit(1000) 静默截断。
 */
export async function searchWorddict({ prefix = '', keyword = '' } = {}) {
  if (keyword) {
    const res = await callCloud('worddict', { action: 'search', keyword });
    return { words: res.words || [], truncated: false };
  }
  const res = await callCloud('worddict', { action: 'byLetter', prefix });
  return { words: res.words || [], truncated: !!res.truncated };
}

/**
 * 服务端挑选自动配词候选（原 AutoWordService 的候选池逻辑已挪到云函数里）。
 * @param {{exclude?: string[], ignored?: string[], limit?: number, seed?: number}} opts
 * @returns {Promise<{words: Array, candidates: number}>} candidates=0 表示候选池空
 */
export async function pickWorddict({ exclude = [], ignored = [], limit = 10, seed = 0 } = {}) {
  const res = await callCloud('worddict', {
    action: 'pick',
    exclude,
    ignored,
    limit,
    seed,
  });
  return { words: res.words || [], candidates: Number(res.candidates) || 0 };
}
