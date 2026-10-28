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
 *   auditCollections  仅管理员。审计共享集合的数据完整性：
 *                     探测残留（permCheck 写探测插进来的测试文档）、
 *                     词库文档数与预期基线的偏差。服务端 SDK 不受集合权限限制，
 *                     所以即便集合被设成「客户端可写」，也能查出被污染的痕迹。
 *   cleanupProbes     仅管理员。清理污染文档（带 __mg_perm_probe 标记的 +
 *                     带 _openid 的客户端注入文档）。
 *
 * ⚠ 关于「谁能把别人加进白名单」：grantAdmin 本身要求已是管理员，
 *   且 admins 集合的客户端权限须设为「所有用户不可读写」——
 *   云函数用服务端 SDK 写入不受客户端权限限制，而客户端 SDK 读不到也写不了，
 *   这样普通用户无法自己给自己发管理员。
 *   📌 控制台显示名是「所有用户不可读写」（= 客户端不可读写）；
 *      官方文档术语叫「仅管理端可读写」，但控制台不显示这几个字，别照着找。
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

/**
 * 需要审计的共享集合 + 预期文档数基线。
 * ⚠ 基线只是「导入完应该是多少」，用于发现异常漂移，不是硬约束：
 *   词库可能因为后续补词而变多，所以偏差只提示、不阻断。
 */
const SHARED_COLLECTIONS = [
  { name: 'admins', desc: '管理员白名单', expect: null },
  { name: 'worddict', desc: '考研词库', expect: 4801 },
  { name: 'worddict_ielts', desc: '雅思词库', expect: 4491 },
  { name: 'content_files', desc: '内容文件索引', expect: null },
];

/** 探测残留标记：与前端 miniprogram/services/permCheck.js 的 PROBE_MARK 一致。 */
const PROBE_MARK = '__mg_perm_probe';

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

      case 'auditCollections': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        return await auditCollections();
      }

      case 'cleanupProbes': {
        if (!(await isAdmin(OPENID, db))) return forbidden();
        return await cleanupProbes(event);
      }

      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    console.error('[admin]', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
};

/**
 * 审计共享集合的数据完整性。
 *
 * 为什么需要：前端「安全自检」的写探测会往共享集合里真插一条测试文档
 * （客户端可写时才插得进去）。如果权限恰好是「客户端可写」而删除又失败，
 * 那条文档会留在生产集合里 → 词库总数被污染（浏览页显示的数字就不准了）。
 * 服务端 SDK 不受集合权限限制，所以即便集合门户大开也能查出这些痕迹。
 *
 * ⚠ 两种污染要分开查：
 *   ① 带 __mg_perm_probe 标记的 → 自检工具插的测试文档
 *   ② 带 _openid 的            → **客户端插的**（服务端写入的记录不会自动带
 *      _openid）→ 可能是别人手动/恶意插进去的，标记查不出来，只能靠 _openid 揪。
 *      ⚠ admins 里带 _openid 的条目 = 有人试图给自己发管理员，已被 admin-guard
 *        拒绝承认（只认无 _openid 的服务端条目），但仍应清掉。
 */
async function auditCollections() {
  const report = [];
  for (const c of SHARED_COLLECTIONS) {
    const row = { name: c.name, desc: c.desc, expect: c.expect };
    try {
      const total = (await db.collection(c.name).count()).total;
      row.count = total;

      // 探测残留：只按标记字段查，不扫全表
      const probes = await db.collection(c.name)
        .where({ [PROBE_MARK]: db.command.exists(true) })
        .limit(50)
        .get();
      row.probeCount = (probes.data || []).length;
      row.probeIds = (probes.data || []).map((d) => d._id);

      // ⚠ 客户端插入的文档：服务端/控制台写入的记录**不会**自动生成 _openid，
      //   只有小程序端创建的才带 → 共享集合里带 _openid 的就是客户端插进来的。
      //   数量不限，只报个数 + 少量样本（词库集合可能很多）。
      const injected = await db.collection(c.name)
        .where({ _openid: db.command.exists(true) })
        .limit(50)
        .get();
      row.injectedCount = (injected.data || []).length;
      row.injectedSample = (injected.data || []).slice(0, 5).map((d) => ({
        _id: d._id,
        word: d.word || d.path || '',
        probe: !!d[PROBE_MARK],
      }));

      // 与基线比：偏差只提示，不当成错误（词库可能后续补词）
      if (c.expect != null) {
        row.diff = total - c.expect;
        row.countOk = row.diff === 0;
      }
    } catch (e) {
      row.error = (e && e.message) || String(e);
    }
    report.push(row);
  }
  const polluted = report.filter((r) => (r.probeCount || 0) > 0);
  const injected = report.filter((r) => (r.injectedCount || 0) > 0);
  const drifted = report.filter((r) => r.countOk === false);
  const issues = polluted.length || injected.length || drifted.length;
  return {
    ok: true,
    report,
    probeTotal: polluted.reduce((n, r) => n + r.probeCount, 0),
    injectedTotal: injected.reduce((n, r) => n + r.injectedCount, 0),
    polluted: polluted.map((r) => r.name),
    injected: injected.map((r) => r.name),
    drifted: drifted.map((r) => r.name),
    summary: issues
      ? `发现 ${polluted.length} 个集合有探测残留、${injected.length} 个集合有客户端插入的文档、${drifted.length} 个集合文档数偏离基线`
      : '共享集合数据完整，无探测残留、无客户端插入文档、文档数符合基线',
  };
}

/**
 * 清理共享集合里的污染文档：
 *   ① 带 __mg_perm_probe 标记的（自检插的测试文档）
 *   ② 带 _openid 的（客户端插进来的 —— 共享集合里这类文档本就不该存在）
 * 逐条删而不是批量 where.remove —— 后者在服务端 SDK 里语义不够稳，
 * 且逐条删能把失败的文档单独报告出来。
 *
 * ⚠ 只在共享集合上做。带 _openid 的文档在共享集合里一定是外来物
 *   （服务端写入的记录不会自动带 _openid），删掉不会误伤业务数据。
 */
async function cleanupProbes(event) {
  const only = event && event.collection ? String(event.collection) : '';
  const targets = only
    ? SHARED_COLLECTIONS.filter((c) => c.name === only)
    : SHARED_COLLECTIONS;
  if (!targets.length) {
    return { ok: false, error: `未知集合名：${only}（可清理：${SHARED_COLLECTIONS.map((c) => c.name).join('、')}）` };
  }

  const detail = [];
  let removed = 0;
  for (const c of targets) {
    let ids = [];
    try {
      const res = await db.collection(c.name)
        .where({ [PROBE_MARK]: db.command.exists(true) })
        .limit(100)
        .get();
      ids = (res.data || []).map((d) => d._id);
    } catch (e) {
      detail.push({ name: c.name, removed: 0, error: (e && e.message) || String(e) });
      continue;
    }
    // 再捞一批「带 _openid 但没有探测标记」的 —— 那是被别人插进来的
    try {
      const res2 = await db.collection(c.name)
        .where({
          _openid: db.command.exists(true),
          [PROBE_MARK]: db.command.exists(false),
        })
        .limit(100)
        .get();
      ids = ids.concat((res2.data || []).map((d) => d._id));
    } catch (e) {
      /* 捞不到就只清探测标记那批，不算失败 */
    }
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await db.collection(c.name).doc(id).remove();
        ok += 1;
      } catch (e) {
        failed.push({ id, error: (e && e.message) || String(e) });
      }
    }
    removed += ok;
    detail.push({ name: c.name, found: ids.length, removed: ok, failed });
  }
  return {
    ok: true,
    removed,
    detail,
    summary: removed ? `已清理 ${removed} 条污染文档` : '没有需要清理的污染文档',
  };
}
