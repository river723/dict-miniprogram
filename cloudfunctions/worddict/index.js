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
      case 'all': {
        // 自动配词候选池：全量。分页取完（首版数据约 5000+ 词）。
        const MAX = 1000;
        let skip = 0;
        let all = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = await db.collection(COL)
            .field({ word: true, definitions: true, pronunciation_uk: true, pronunciation_us: true, frequency: true, difficulty: true })
            .skip(skip).limit(MAX).get();
          all = all.concat(res.data);
          if (res.data.length < MAX) break;
          skip += MAX;
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
