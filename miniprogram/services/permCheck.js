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
 * ## ⚠ 共享集合 vs 用户私有集合（重要，别一视同仁）
 * 官方基础权限只有四种，而**四种模式下小程序端永远不能写他人创建的数据**
 * （平台按 _openid 强制隔离，见官方「权限管理」文档的权限矩阵）。所以：
 *   - **共享集合**（admins / worddict / worddict_ielts / content_files）：
 *     客户端能写 = 全站数据被污染 / 鉴权被绕过 → 真后门，必须写探测。
 *   - **用户私有集合**（words / study_* / user_settings）：
 *     权限是「仅创建者可读写」时客户端能读写**自己的**数据，这是**安全状态**，
 *     不是后门。而且真写进去一条脏数据会污染用户自己的生词本/学习记录。
 *     → 这几个只做读探测，不做写探测。
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

/**
 * 全部集合的权限期望（权威清单）。
 *
 * 📌 本项目前端 0 处直连数据库（全部走云函数）→ **所有**集合都应该是
 *   「仅管理端可读写」（= 小程序端读不了也写不了）。
 *   ⚠ 控制台里**没有**「所有用户不可读写」这个选项名，别找错。
 *
 * ⚠ 为什么 user_* / words / study_* 这些「用户自己的数据」也要锁：
 *   它们的客户端权限是「仅创建者可读写」时，普通用户能读到自己 openid 的记录，
 *   但**读不到别人的**（_openid 隔离）。这层隔离由平台保证，比我们自己写的
 *   where({_openid}) 更可靠 → 所以「仅创建者可读写」对用户私有集合是**可接受**的。
 *   而全局共享集合（admins / worddict / worddict_ielts / content_files）
 *   必须锁死：客户端可写 = 任何人都能改全站数据。
 *
 * 风险分级：
 *   - critical：共享集合，可写 = 直接破坏全站数据 / 绕过鉴权
 *   - low：用户私有集合，「仅创建者可读写」即可接受（_openid 隔离由平台保证）
 */
const EXPECT = [
  { name: 'admins', desc: '管理员白名单', risk: 'critical' },
  { name: 'worddict', desc: '考研词库', risk: 'critical' },
  { name: 'worddict_ielts', desc: '雅思词库', risk: 'critical' },
  { name: 'content_files', desc: '内容文件索引', risk: 'critical' },
  { name: 'words', desc: '生词本', risk: 'low' },
  { name: 'study_records', desc: '学习记录', risk: 'low' },
  { name: 'study_plans', desc: '复习计划', risk: 'low' },
  { name: 'wrong_questions', desc: '错题本', risk: 'low' },
  { name: 'user_settings', desc: '用户设置', risk: 'low' },
];

/** 需要「客户端不可读不可写」的集合（服务端专用集合）。 */
const SERVER_ONLY = EXPECT.map((e) => e.name);

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

/**
 * 用客户端 SDK 试写一个集合，并尝试清理掉探测文档。
 *
 * ⚠ 共享集合若恰好「客户端可写」，这条测试文档会真的写进生产数据。
 *   所以这里必须**当场删掉**，并把删除结果如实带回（cleaned / note）——
 *   删不掉时要让用户看得见，否则生产集合里会留垃圾（词库总数被污染）。
 *   服务端有 admin#cleanupProbes 可兜底清理。
 */
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
              id,
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
async function checkCollection(meta) {
  const { name, risk } = meta;
  // 用户私有集合（words/study_* 等）不写探测：
  //   官方保证「小程序端不能写他人创建的数据」，即使权限是「仅创建者可读写」，
  //   客户端能写成功也只影响自己那条 → 不算后门。
  //   而且真写进去一条脏数据会污染用户的生词本/学习记录，得手动清。
  //   共享集合（admins/worddict/...）才是「客户端能写 = 全站被污染」的真后门。
  const needWrite = risk === 'critical';

  const read = await probeRead(name);
  const write = needWrite ? await probeWrite(name) : { ok: null, skipped: true };

  let status;
  if (needWrite) {
    if (!read.ok && !write.ok) {
      status = 'locked';
    } else if (read.ok && write.ok) {
      status = 'open';
    } else {
      status = read.ok ? 'readable' : 'writable';
    }
  } else {
    // 用户私有集合：客户端读到的只会是自己的数据（平台按 _openid 隔离），
    // 所以「能读」不等于泄漏。只有「能读到别人的」才是问题 —— 但那需要
    // 一个真实存在的他人 openid 才能测，客户端拿不到。
    // → 这里只区分「完全读不了」（最理想）与「能读自己的」（可接受）。
    status = read.ok ? 'own' : 'locked';
  }

  const expected = risk === 'critical'
    ? '客户端不可读写'
    : '客户端只能读到自己（仅创建者可读写即可接受）';
  const ok = risk === 'critical'
    ? (!read.ok && !write.ok)
    : true; // 用户私有集合的「仅创建者可读写」是安全状态，不算问题

  return {
    name,
    desc: meta.desc,
    risk,
    expected,
    status,
    ok,
    read,
    write,
    hint: ok ? (risk === 'critical' ? '' : '（用户私有数据，_openid 隔离由平台保证，可接受）') : buildHint(status, name, write),
  };
}

function buildHint(status, collName, write) {
  // 写探测真的插进去了、还没删掉 → 必须在提示里说清楚（生产数据被污染了）
  const dirty = write && write.ok && write.cleaned === false
    ? ` 另：本次探测的测试文档未能自动删除（${collName} 里可能已残留 1 条），请用 admin#cleanupProbes 清理。`
    : '';
  switch (status) {
    case 'open':
      return `⚠ ${collName} 客户端读写都不受限 —— 严重后门：任何人拿到小程序都能改全站数据。控制台 → 数据库 → ${collName} → 权限设置 → 选「仅管理端可读写」。${dirty}`;
    case 'readable':
      return `⚠ ${collName} 客户端可读 —— 共享数据会泄漏给所有用户。改成「仅管理端可读写」。${dirty}`;
    case 'writable':
      return `⚠ ${collName} 客户端可写 —— 任何人都能改全站数据（如污染词库 / 给自己发管理员）。改成「仅管理端可读写」。${dirty}`;
    default:
      return '';
  }
}

/**
 * 跑完整自检。
 * @param {string[]} [names] 只检查指定集合名；不传则检查全部 9 个
 * @returns {Promise<{ok:boolean, results:Array, bad:Array, summary:string}>}
 */
export async function checkCollectionPermissions(names) {
  const list = (names && names.length)
    ? EXPECT.filter((e) => names.includes(e.name))
    : EXPECT.slice();
  const results = [];
  for (const meta of list) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkCollection(meta));
  }
  const bad = results.filter((r) => !r.ok);
  // 共享集合单独统计 —— 那几个才是真后门，用户私有集合的差异不算问题。
  const criticalBad = bad.filter((r) => r.risk === 'critical');
  let summary;
  if (criticalBad.length) {
    summary = `${criticalBad.length} 个共享集合存在后门：${criticalBad.map((r) => r.name).join('、')}`;
  } else if (bad.length) {
    summary = `${bad.length} 个集合需注意：${bad.map((r) => r.name).join('、')}`;
  } else {
    summary = `全部 ${results.length} 个集合权限符合预期`;
  }
  return { ok: !bad.length, results, bad, criticalBad, summary };
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

/**
 * 审计共享集合的数据完整性（服务端执行）。
 *
 * ⚠ 为什么要单独做：权限自检只看「权限规则对不对」，看不出**数据有没有被污染**。
 *   写探测会往共享集合真插一条测试文档（权限开放时插得进去），
 *   若删除失败就留下一条垃圾 —— 词库总数会多 1（4801 → 4802），
 *   浏览页显示的词条数就不准了。
 *
 * 服务端 SDK 不受集合权限限制 → 即便集合门户大开也能查出痕迹。
 */
export async function auditCollections() {
  const res = await callCloud('admin', { action: 'auditCollections' }, { silent: true });
  if (!res || !res.ok) {
    throw new Error((res && res.error) || '审计失败');
  }
  return res;
}

/**
 * 清理探测残留（服务端执行，只删带 __mg_perm_probe 标记的文档）。
 * @param {string} [collection] 只清理指定集合；不传则清理全部共享集合
 */
export async function cleanupProbes(collection) {
  const res = await callCloud(
    'admin',
    collection ? { action: 'cleanupProbes', collection } : { action: 'cleanupProbes' },
    { silent: true },
  );
  if (!res || !res.ok) {
    throw new Error((res && res.error) || '清理失败');
  }
  return res;
}
