/**
 * words 云函数 —— 用户数据（words/records/plans/wrongQuestions/settings）读写。
 * _openid 由云调用自动注入，天然按用户隔离。
 * 去重语义与 memo-grad SyncService 一致：按 word_id（词文本）幂等。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  words: 'words',
  records: 'study_records',
  plans: 'study_plans',
  wrongQuestions: 'wrong_questions',
  settings: 'user_settings',
};

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    switch (event.action) {
      case 'pullAll': {
        const out = {};
        for (const [key, col] of Object.entries(COLLECTIONS)) {
          // 单次查询上限 100/1000 条，用分页循环取全量
          const res = await fetchAll(col, OPENID);
          out[key] = res;
        }
        // settings 特殊：单文档
        const s = await db.collection(COLLECTIONS.settings)
          .where({ _openid: OPENID }).limit(1).get();
        return { ok: true, words: out.words, records: out.records, plans: out.plans,
                 wrongQuestions: out.wrongQuestions, settings: s.data[0] || null };
      }
      case 'pushDirty': {
        for (const item of event.batch || []) {
          await upsertDoc(item, OPENID);
        }
        return { ok: true };
      }
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    console.error('[words]', e);
    return { ok: false, error: e.message };
  }
};

async function fetchAll(col, openid) {
  const MAX = 1000;
  let skip = 0;
  let all = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await db.collection(col).where({ _openid: openid })
      .skip(skip).limit(MAX).get();
    all = all.concat(res.data);
    if (res.data.length < MAX) break;
    skip += MAX;
  }
  return all;
}

async function upsertDoc({ collection, doc, op }, openid) {
  const col = COLLECTIONS[collection];
  if (!col) return;
  if (collection === 'settings') {
    const exists = await db.collection(col).where({ _openid: openid }).limit(1).get();
    if (exists.data.length > 0) {
      await db.collection(col).doc(exists.data[0]._id).update({ data: { ...doc, updated_at: new Date() } });
    } else {
      await db.collection(col).add({ data: { ...doc, _openid: openid } });
    }
    return;
  }
  // 按 id 幂等 upsert（与 SyncService 按 word_id 去重收敛一致）
  const exists = await db.collection(col).where({ _openid: openid, id: doc.id }).limit(1).get();
  if (exists.data.length > 0) {
    const { id, ...rest } = doc;
    await db.collection(col).doc(exists.data[0]._id).update({ data: rest });
  } else {
    await db.collection(col).add({ data: { ...doc, _openid: openid } });
  }
}
