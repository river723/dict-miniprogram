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
        const prefix = (event.prefix || 'a').toLowerCase();
        const res = await db.collection(COL).where({ prefix }).limit(1000).get();
        return { ok: true, words: res.data };
      }
      case 'search': {
        const kw = (event.keyword || '').toLowerCase().trim();
        if (!kw) return { ok: true, words: [] };
        const res = await db.collection(COL)
          .where(_.or([
            { word: db.RegExp({ regexp: `^${escapeRe(kw)}`, options: 'i' }) },
          ]))
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
