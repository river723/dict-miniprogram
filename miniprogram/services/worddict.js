/**
 * 词库查询 —— 云数据库 worddict 集合，按字母前缀查询（沿用 server by-letter 思路）。
 * 全量词库不打包进小程序（规避 2MB 主包限制），启动时按需懒加载并缓存。
 */
import { callCloud } from './cloud';

const CACHE_KEY = 'mg_worddict_cache';
const CACHE_DATE_KEY = 'mg_worddict_cache_date';

let cache = null;

const loadCache = () => {
  if (!cache) {
    try { cache = wx.getStorageSync(CACHE_KEY) || null; } catch { cache = null; }
  }
  return cache;
};

/**
 * 词库查询：keyword 走服务端正则前缀查询（search），无 keyword 才按整字母取（byLetter）。
 * 两者都已在云函数侧分页取全量，避免 limit(1000) 静默截断。
 */
export async function searchWorddict({ all = false, prefix = '', keyword = '' } = {}) {
  if (all) {
    if (loadCache() && cache.length > 0) return cache;
    const res = await callCloud('worddict', { action: 'all' });
    cache = res.words || [];
    try {
      wx.setStorageSync(CACHE_KEY, cache);
      wx.setStorageSync(CACHE_DATE_KEY, Date.now());
    } catch {}
    return cache;
  }
  if (keyword) {
    const res = await callCloud('worddict', { action: 'search', keyword });
    return { words: res.words || [], truncated: false };
  }
  const res = await callCloud('worddict', { action: 'byLetter', prefix });
  return { words: res.words || [], truncated: !!res.truncated };
}

export const worddictCacheStale = () => {
  const t = wx.getStorageSync(CACHE_DATE_KEY) || 0;
  return Date.now() - t > 7 * 86400000; // 一周过期
};
