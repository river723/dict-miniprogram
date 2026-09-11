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

/** 全量刷新（自动配词候选池用），带本地缓存。 */
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
  return callCloud('worddict', { action: 'byLetter', prefix, keyword });
}

export const worddictCacheStale = () => {
  const t = wx.getStorageSync(CACHE_DATE_KEY) || 0;
  return Date.now() - t > 7 * 86400000; // 一周过期
};
