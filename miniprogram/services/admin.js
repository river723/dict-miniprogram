/**
 * 管理员身份 —— 前端侧的唯一入口。
 *
 * 设计要点：
 * - 身份由微信云开发在云函数侧注入 OPENID，前端拿不到、也伪造不了；
 *   前端只负责「问一次云端我是不是管理员」，用来决定是否显示管理入口。
 * - 前端判断**不是安全边界**。真正的闸门在 seed / contentseed / setup 三个云函数
 *   内部（服务端校验 OPENID）。即便有人绕过前端直接调云函数，也会被服务端挡下。
 * - 这里的缓存只为「设置页每次 onShow 少一次网络往返」，TTL 5 分钟；
 *   白名单变更后最迟 5 分钟生效（或手动 clearAdminCache()）。
 */
import { callCloud } from './cloud';

const CACHE_KEY = 'mg_admin_state';
const CACHE_TTL = 5 * 60 * 1000;

let memCache = null; // { isAdmin, openid, at }

/** 读取缓存（内存优先，其次本地存储）。 */
function readCache() {
  if (memCache && Date.now() - memCache.at < CACHE_TTL) return memCache;
  try {
    const raw = wx.getStorageSync(CACHE_KEY);
    if (raw && typeof raw.isAdmin === 'boolean' && Date.now() - (raw.at || 0) < CACHE_TTL) {
      memCache = raw;
      return raw;
    }
  } catch (e) {
    /* 存储读取失败忽略 */
  }
  return null;
}

function writeCache(state) {
  const next = { ...state, at: Date.now() };
  memCache = next;
  try {
    wx.setStorageSync(CACHE_KEY, next);
  } catch (e) {
    /* 存储写入失败忽略 */
  }
  return next;
}

/** 清缓存（白名单变更后可主动调用）。 */
export function clearAdminCache() {
  memCache = null;
  try {
    wx.removeStorageSync(CACHE_KEY);
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 查当前用户的管理员身份。
 * @param {boolean} force 忽略缓存强制回源
 * @returns {Promise<{isAdmin: boolean, openid: string}>}
 *   查不到时返回 isAdmin=false（fail-closed：宁可少显示入口，不可多显示）。
 */
export async function fetchAdminState(force = false) {
  if (!force) {
    const cached = readCache();
    if (cached) return { isAdmin: cached.isAdmin, openid: cached.openid || '' };
  }
  try {
    const res = await callCloud('admin', { action: 'whoami' }, { silent: true });
    const state = {
      isAdmin: !!res.isAdmin,
      openid: res.openid || '',
    };
    return writeCache(state);
  } catch (e) {
    // admin 云函数未部署 / 网络失败 → 一律按非管理员处理。
    // 失败要安全（fail-closed）：宁可管理员多点一次导航，也不能让普通用户看到管理入口。
    return { isAdmin: false, openid: '' };
  }
}

/** 同步读缓存（不发起网络请求）。页面首屏渲染前用，避免闪一下再消失。 */
export function peekAdminState() {
  const cached = readCache();
  return { isAdmin: !!(cached && cached.isAdmin), openid: (cached && cached.openid) || '' };
}
