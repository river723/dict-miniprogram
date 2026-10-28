/**
 * admin 云函数 —— 管理员身份自证 + 管理员白名单管理。
 *
 * 存在的理由：项目没有账号体系，身份完全依赖微信云开发注入的 OPENID。
 * 本函数是「我是谁 / 我是不是管理员」的唯一权威入口，前端据此隐藏管理入口，
 * 而真正的闸门在各写操作云函数内部（seed / contentseed / setup）。
 *
 * action:
 *   whoami        任何人可调。返回 { openid, isAdmin } —— 前端用它决定
 *                 是否显示「词库初始化」入口。openid 是本人标识，暴露给本人无害。
 *   listAdmins    仅管理员。列出 admins 集合里的白名单。
 *   grantAdmin    仅管理员。{ openid, note } 把某个 openid 加入白名单。
 *                 写入后立即生效，不需要重新部署任何云函数。
 *   revokeAdmin   仅管理员。{ openid } 移出白名单。
 *   ensureCollection  仅管理员。幂等建 admins 集合（也可由 setup 云函数建）。
 *
 * ⚠ 关于「谁能把别人加进白名单」：grantAdmin 本身要求已是管理员，
 *   且 admins 集合的客户端权限须设为「仅管理端可读写」——
 *   云函数用服务端 SDK 写入不受客户端权限限制，而客户端 SDK 读不到也写不了，
 *   这样普通用户无法自己给自己发管理员。
 *   📌 控制台里的选项名是「仅管理端可读写」（= 客户端不可读写），
 *      没有「所有用户不可读写」这种选项名，别找错。
 */
const cloud = require('wx-server-sdk');
const {
  ADMIN_COLLECTION,
  isAdmin,
  forbidden,
  ensureAdminsCollection,
} = require('./admin-guard');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 从各种脏输入里提取一个像样的 openid（28 位、o 开头）。 */
function normalizeOpenid(raw) {
  const s = String(raw || '').trim();
  // 微信 openid 形如 oXXXX...（当前 28 字符）。不硬性校验长度，
  // 只排除明显不是 openid 的输入，避免把空串/超长串写进集合。
  if (!s || s.length > 64) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return '';
  return s;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  try {
    switch (event.action) {
      case 'whoami': {
        const admin = await isAdmin(OPENID, db);
        return { ok: true, openid: OPENID || '', isAdmin: admin };
      }

      case 'ensureCollection': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        await ensureAdminsCollection(db);
        return { ok: true, collection: ADMIN_COLLECTION };
      }

      case 'listAdmins': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        const res = await db.collection(ADMIN_COLLECTION).limit(200).get();
        const admins = (res.data || []).map((d) => ({
          openid: d.openid || '',
          note: d.note || '',
          added_at: d.added_at || '',
        }));
        return { ok: true, admins };
      }

      case 'grantAdmin': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        const target = normalizeOpenid(event.openid);
        if (!target) return { ok: false, error: 'openid 格式不对' };
        await ensureAdminsCollection(db);
        const exist = await db.collection(ADMIN_COLLECTION)
          .where({ openid: target }).limit(1).get();
        if (exist.data && exist.data.length) {
          return { ok: true, already: true, openid: target };
        }
        await db.collection(ADMIN_COLLECTION).add({
          data: {
            openid: target,
            note: String(event.note || '').slice(0, 60),
            added_at: new Date().toISOString(),
          },
        });
        return { ok: true, granted: true, openid: target };
      }

      case 'revokeAdmin': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        const target = normalizeOpenid(event.openid);
        if (!target) return { ok: false, error: 'openid 格式不对' };
        const res = await db.collection(ADMIN_COLLECTION)
          .where({ openid: target }).limit(1).get();
        const docs = res.data || [];
        if (!docs.length) return { ok: true, removed: 0, openid: target };
        await db.collection(ADMIN_COLLECTION).doc(docs[0]._id).remove();
        return { ok: true, removed: 1, openid: target };
      }

      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    console.error('[admin]', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
};
