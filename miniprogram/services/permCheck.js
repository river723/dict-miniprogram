/**
 * 集合权限自检 —— 用「客户端 SDK 视角」探测各集合的读写权限是否如预期。
 *
 * ## 为什么需要它
 * 集合权限是在云开发控制台里点的，控制台点错了不会有任何报错 —— 只在
 * 真正有人越权访问时才暴露。所以必须有个能主动验证的手段。
 *
 * ## 为什么必须在客户端做
 * 云函数用的是**服务端 SDK**，它不受集合权限限制（管理端永远有全权限），
 * 所以在云函数里查集合永远成功，**测不出权限对不对**。
 * 唯一能真实反映「普通用户能不能访问」的，是小程序的客户端 SDK。
 * 所以这个探测跑在**小程序端**：wx.cloud.database() 走客户端通道，
 * 会被集合权限规则拦截。
 *
 * ## 判定逻辑
 * 对每个集合做两次尝试：
 *   1. 读 → 期望被拒（客户端不可读）
 *   2. 写 → 期望被拒（客户端不可写）
 * 结果分三档：
 *   - locked  : 读写都被拒 → ✓ 符合「仅管理端可读写」
 *   - readable: 读成功 → ✗ 后门（客户端能读，白名单会泄漏）
 *   - writable: 写成功 → ✗ 后门（客户端能写，普通用户能给自己发管理员！）
 *
 * ⚠ 写探测会真的尝试插入一条测试文档。如果权限恰好是「可写」，
 *   那条文档会被写进去（自己创建的，_openid 是当前用户）。
 *   为了不留垃圾，成功写入后会立刻删除；删除失败则在返回里标出来。
 *   探测用的文档带 __mg_perm_probe 标记，便于事后识别与清理。
 *
 * ⚠ 探测只在**开发者本人**的机器上跑（小程序端），openid 是管理员本人，
 *   对 admins 集合而言管理员也是「非创建者」（文档由云函数写入，无 _openid），
 *   所以 admins 的探测结果对普通用户同样成立。
 */
import { callCloud } from './cloud';

/** 需要「客户端不可读不可写」的集合（服务端专用集合）。 */
const SERVER_ONLY = ['admins'];

/**
 * 需要「客户端可读」的集合（前端可能直连读的公开数据）。
 * 本项目当前前端 0 处直连数据库，全走云函数 → 实际不需要任何可读集合，
 * 但保留这个清单以便将来前端要直连时能立刻复用。
 */
const CLIENT_READABLE = [];

const PROBE_MARK = '__mg_perm_probe';

/** 用客户端 SDK 试读一个集合。 */
function probeRead(collName) {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database();
      db.collection(collName).limit(1).get({
        success: (res) => resolve({ ok: true, count: (res.data || []).length }),
        fail: (err) => resolve({ ok: false, errMsg: (err && err.errMsg) || String(err) }),
      });
    } catch (e) {
      resolve({ ok: false, errMsg: (e && e.message) || String(e) });
    }
  });
}

/** 用客户端 SDK 试写一个集合，并尝试清理掉探测文档。 */
function probeWrite(collName) {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database();
      const ref = db.collection(collName);
      ref.add({
        data: { [PROBE_MARK]: 1, probe_at: new Date().toISOString() },
        success: (res) => {
          // 写成功了 —— 说明是后门！立刻清理。
          const id = res && res._id;
          if (!id) {
            resolve({ ok: true, cleaned: false, note: '写入成功但拿不到 _id，无法清理' });
            return;
          }
          db.collection(collName).doc(id).remove({
            success: () => resolve({ ok: true, cleaned: true }),
            fail: (err) => resolve({
              ok: true,
              cleaned: false,
              note: `写入成功但删除失败（${(err && err.errMsg) || err}），请手动清理 ${collName}/${id}`,
            }),
          });
        },
        fail: (err) => resolve({ ok: false, errMsg: (err && err.errMsg) || String(err) }),
      });
    } catch (e) {
      resolve({ ok: false, errMsg: (e && e.message) || String(e) });
    }
  });
}

/**
 * 自检单个集合的权限。
 * @returns {Promise<{name:string, status:string, read:object, write:object, expected:string, ok:boolean}>}
 */
async function checkCollection(collName) {
  const expected = SERVER_ONLY.includes(collName) ? '客户端不可读写'
    : (CLIENT_READABLE.includes(collName) ? '客户端可读' : '客户端不可读写');

  const read = await probeRead(collName);
  const write = await probeWrite(collName);

  let status;
  if (!read.ok && !write.ok) {
    status = 'locked';
  } else if (read.ok && write.ok) {
    status = 'open';
  } else {
    status = read.ok ? 'readable' : 'writable';
  }

  const ok = expected === '客户端可读' ? read.ok : (!read.ok && !write.ok);

  return {
    name: collName,
    expected,
    status,
    ok,
    read,
    write,
    hint: ok ? '' : buildHint(status, collName),
  };
}

function buildHint(status, collName) {
  switch (status) {
    case 'open':
      return `⚠ ${collName} 客户端读写都不受限 —— 严重后门。控制台 → 数据库 → ${collName} → 权限设置 → 选「仅管理端可读写」。`;
    case 'readable':
      return `⚠ ${collName} 客户端可读 —— 白名单内容会泄漏给所有用户。改成「仅管理端可读写」。`;
    case 'writable':
      return `⚠ ${collName} 客户端可写 —— 普通用户能给自己写一条白名单记录，直接绕过全部鉴权。改成「仅管理端可读写」。`;
    default:
      return '';
  }
}

/**
 * 跑完整自检。
 * @param {string[]} names 要检查的集合名；不传则检查 SERVER_ONLY 全部
 * @returns {Promise<{ok:boolean, results:Array, summary:string}>}
 */
export async function checkCollectionPermissions(names) {
  const list = (names && names.length) ? names : SERVER_ONLY.slice();
  const results = [];
  for (const name of list) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkCollection(name));
  }
  const bad = results.filter((r) => !r.ok);
  const summary = bad.length
    ? `${bad.length}/${results.length} 个集合权限不符合预期：${bad.map((r) => r.name).join('、')}`
    : `全部 ${results.length} 个集合权限符合预期`;
  return { ok: !bad.length, results, bad, summary };
}

/**
 * 顺带查自己的管理员身份（一次性给出「权限 + 身份」两个结论）。
 */
export async function checkAdminAndPermissions() {
  const [who, perm] = await Promise.all([
    callCloud('admin', { action: 'whoami' }, { silent: true }).catch((e) => ({
      ok: false, error: (e && e.message) || String(e),
    })),
    checkCollectionPermissions(),
  ]);
  return {
    identity: {
      ok: !!who.ok,
      openid: who.openid || '',
      isAdmin: !!who.isAdmin,
      error: who.error || '',
    },
    permissions: perm,
  };
}
