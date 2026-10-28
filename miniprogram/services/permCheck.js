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
 * ## ⚠⚠ 控制台显示名 ≠ 官方文档术语名（最容易踩的坑，已踩过）
 * 官方文档把四种权限叫「仅管理端可读写」等，但**控制台里根本不显示这几个字**。
 * 2026 版微信开发者工具：云开发 → 数据库 → 集合列表 → 点开集合 → **「数据权限」**
 * 标签页，五个单选项，实际显示的是：
 *   1. 所有用户可读，仅创建者可读写   （= 文档术语「仅创建者可写，所有人可读」）
 *   2. 仅创建者可读写                 （= 文档术语「仅创建者可读写」）
 *   3. 所有用户可读                   （= 文档术语「仅管理端可写，所有人可读」）
 *   4. 所有用户不可读写               （= 文档术语「仅管理端可读写」）← 共享集合只要这一个
 *   5. 自定义安全规则                 （等价写法：{ "read": false, "write": false }）
 * 顺序是宽松→严格；第 4 项右边写着「适用场景：后台流水数据等」。
 * ⚠ 所以给用户的提示**必须用控制台的显示名**，照文档术语让他去找，他会找不到。
 * ⚠ 模式 2「仅创建者可读写」**不是**安全模式 —— 客户端照样能往共享集合里
 *   插文档（详见下面「为什么仍算后门」）。
 *
 * ## 判定逻辑（共享集合）
 * 对每个共享集合做两次尝试：
 *   1. 读 → 看客户端能不能读到**别人/服务端**的数据
 *   2. 写 → 看客户端能不能插文档（插进去就立刻删）
 * 结果分档：
 *   - locked   : 读写都被拒           → ✓ 符合「所有用户不可读写」
 *   - ownWrite : 读不到，但能插        → ✗ 后门（「仅创建者可读写」）
 *   - publicWrite: 读到 + 能插         → ✗✗ 严重后门（「所有用户可读，仅创建者可读写」）
 *   - readable : 读到，但插不了        → ✗ 泄漏（「所有用户可读」）
 *
 * ## ⚠ 为什么「仅创建者可读写」对共享集合仍是后门（关键，别想当然）
 * 平台按 `_openid` 隔离「谁能读写**哪条**数据」，但**云函数读集合时不带
 * `_openid` 过滤** —— 服务端看到的是全表。
 * 于是：客户端在共享集合里插一条自己的文档 → 这条文档对**全站所有用户**
 * 都可见（服务端查询会把它查出来）。
 *   · `admins`：插一条 `{openid:"自己的openid"}` → 云函数 isAdmin 查得到
 *     → **普通用户直接把自己变成管理员，绕过全部鉴权**。
 *   · `worddict`/`worddict_ielts`：插一条假词条 → 全站用户都能搜到，
 *     而且 `count()` 会虚高（浏览页显示的词条数就不准了）。
 *   · `content_files`：插一条假映射 → 内容索引被污染。
 * 唯一能挡住这些的只有「**所有用户不可读写**」（客户端读写全被拒；官方文档
 * 把这个模式叫「仅管理端可读写」，但控制台不显示这个名字）。
 *
 * ## ⚠ 共享集合 vs 用户私有集合（重要，别一视同仁）
 * 官方四种模式下小程序端永远不能写他人创建的数据（平台按 _openid 强制隔离）。所以：
 *   - **共享集合**（admins / worddict / worddict_ielts / content_files）：
 *     客户端能写 = 全站数据被污染 / 鉴权被绕过 → 真后门，必须写探测。
 *   - **用户私有集合**（words / study_* / user_settings）：
 *     权限是「仅创建者可读写」时客户端能读写**自己的**数据，这是**安全状态**，
 *     不是后门。而且真写进去一条脏数据会污染用户自己的生词本/学习记录。
 *     → 这几个只做读探测，不做写探测。
 *
 * ⚠ 写探测会真的尝试插入一条测试文档。插入成功时（说明权限开放）
 *   那条文档会被写进去（自己创建的，_openid 是当前用户）。
 *   为了不留垃圾，成功写入后会立刻删除；删除失败则在返回里标出来。
 *   探测用的文档带 __mg_perm_probe 标记，便于事后识别与清理。
 *   ⚠ 但**只有本工具插的**才带标记；若有人手动/恶意插过不带标记的，
 *     服务端 auditCollections 会按「文档带 _openid」把它揪出来（见下）。
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
 *   「所有用户不可读写」（= 小程序端读不了也写不了）。
 *   ⚠ 官方文档术语叫「仅管理端可读写」，但**控制台不显示这个名字**，别照着找。
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

/**
 * 需要「客户端可读」的集合（前端可能直连读的公开数据）。
 * 本项目当前前端 0 处直连数据库，全走云函数 → 实际不需要任何可读集合，
 * 但保留这个清单以便将来前端要直连时能立刻复用。
 */
const CLIENT_READABLE = [];

/** 探测残留标记：与云函数 admin/index.js 的 PROBE_MARK 一致。 */
const PROBE_MARK = '__mg_perm_probe';

/**
 * 四种基础权限在**控制台「数据权限」页里实际显示的名字**。
 * ⚠ 这里故意用显示名而不是官方术语名 —— 提示文案要能让用户直接照着点。
 *   对照表见文件头「控制台显示名 ≠ 官方文档术语名」。
 *   ADMIN_ONLY 的官方文档术语是「仅管理端可读写」，控制台不显示这几个字。
 */
const PERM_MODE = {
  ADMIN_ONLY: '所有用户不可读写',
  CREATOR_RW: '仅创建者可读写',
  CREATOR_W_ALL_READ: '所有用户可读，仅创建者可读写',
  ADMIN_W_ALL_READ: '所有用户可读',
};

/**
 * 用客户端 SDK 试读一个集合。
 *
 * 返回：
 *   ok            —— 查询本身是否被拒（false = 客户端完全读不到）
 *   count         —— 读回来的条数（0 = 被 _openid 过滤掉了，等于读不到别人数据）
 *   globalReadable—— 读回来的文档里有没有**没有 _openid** 的（= 服务端/控制台
 *                    创建的全局共享数据）。服务端写入的记录不会自动带 _openid，
 *                    客户端写入的才带 → 这就是「客户端读到了全局数据」的判据。
 */
function probeRead(collName) {
  return new Promise((resolve) => {
    try {
      const db = wx.cloud.database();
      db.collection(collName).limit(3).get({
        success: (res) => {
          const docs = res.data || [];
          resolve({
            ok: true,
            count: docs.length,
            globalReadable: docs.some((d) => !d || !d._openid),
          });
        },
        fail: (err) => resolve({
          ok: false,
          count: 0,
          globalReadable: false,
          errMsg: (err && err.errMsg) || String(err),
        }),
      });
    } catch (e) {
      resolve({ ok: false, count: 0, globalReadable: false, errMsg: (e && e.message) || String(e) });
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
 * 推断当前是官方四种模式里的哪一种（只对共享集合有意义）。
 *
 * 判据（共享集合的正常文档由服务端写入 → **没有** _openid）：
 *   读被拒 + 写被拒        → 所有用户不可读写        ✓ 安全
 *   读被拒 + 写通          → 异常组合（能写 = 仍是后门）
 *   读到全局数据 + 写通    → 所有用户可读，仅创建者可读写  ✗✗ 严重
 *   读到全局数据 + 写被拒  → 所有用户可读            ✗ 泄漏
 *   只读到自己的 + 写通    → 仅创建者可读写          ✗ 能插 = 污染
 *   只读到自己的 + 写被拒  → 非基础四选一（自定义规则）或集合为空 → 暂按安全
 *
 * ⚠ 为什么用 globalReadable（有没有读到**没有 _openid** 的文档）而不是「读到了几条」：
 *   「仅创建者可读写」模式下客户端**能**读到自己的文档（自检插的探测文档就有
 *   _openid）→ 条数 > 0 但拿到的全是自己的数据，这不构成泄漏。
 *   真正的泄漏标志是「读到了服务端创建的全局数据」（服务端写入的记录不会
 *   自动生成 _openid）。
 */
function inferMode(read, write) {
  const canWrite = !!(write && write.ok);
  const readOk = !!(read && read.ok);
  const global = !!(read && read.globalReadable);
  if (!readOk && !canWrite) return PERM_MODE.ADMIN_ONLY;
  if (!readOk && canWrite) return '写通读不通（异常组合）';
  if (global && canWrite) return PERM_MODE.CREATOR_W_ALL_READ;
  if (global && !canWrite) return PERM_MODE.ADMIN_W_ALL_READ;
  if (canWrite) return PERM_MODE.CREATOR_RW;
  return `${PERM_MODE.ADMIN_W_ALL_READ}（未读到全局数据，模式待复检）`;
}

/**
 * 自检单个集合的权限。
 * @returns {Promise<{name:string, status:string, mode:string, ok:boolean, ...}>}
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
  let ok;
  let mode = '';
  let needRecheck = false;

  if (needWrite) {
    const canWrite = !!write.ok;
    // 「客户端能读到服务端创建的全局数据」= 真泄漏。
    // ⚠ 判据不是「读到了几条」，而是「读到的文档有没有 _openid」：
    //   服务端/控制台写入的记录**不会**自动带 _openid，客户端写入的才带。
    //   「仅创建者可读写」下客户端能读到自己的文档（带 _openid）→ 不算泄漏。
    const leak = !!read.ok && !!read.globalReadable;
    if (!canWrite && !leak) {
      // 读不到全局数据 + 插不进文档 = 「所有用户不可读写」→ 符合预期
      status = 'locked';
      ok = true;
    } else if (canWrite && leak) {
      // 既能读全站数据、又能插文档 → 最严重
      status = 'publicWrite';
      ok = false;
    } else if (canWrite) {
      // 插得进（即便读不到全局数据）→ 共享集合的后门：
      //   服务端读集合不带 _openid 过滤，插进去的内容对全站可见；
      //   admins 更是能直接给自己发管理员。
      status = 'ownWrite';
      ok = false;
    } else {
      // 插不进、但读得到全局数据 → 泄漏
      status = 'readable';
      ok = false;
      if (!read.count) needRecheck = true;
    }
    mode = inferMode(read, write);
  } else {
    // 用户私有集合：客户端读到的只会是自己的数据（平台按 _openid 隔离），
    // 所以「能读」不等于泄漏。只有「能读到别人的」才是问题 —— 但那需要
    // 一个真实存在的他人 openid 才能测，客户端拿不到。
    // → 这里只区分「完全读不了」（最理想）与「能读自己的」（可接受）。
    status = read.ok ? 'own' : 'locked';
    ok = true;
  }

  const expected = risk === 'critical'
    ? '客户端不可读写（控制台选「所有用户不可读写」）'
    : '客户端只能读到自己（「仅创建者可读写」即可接受）';

  return {
    name,
    desc: meta.desc,
    risk,
    expected,
    status,
    mode,
    ok,
    needRecheck,
    read,
    write,
    hint: ok
      ? (risk === 'critical' ? '' : '（用户私有数据，_openid 隔离由平台保证，可接受）')
      : buildHint(status, name, write, mode),
  };
}

function buildHint(status, collName, write, mode) {
  // 写探测真的插进去了、还没删掉 → 必须在提示里说清楚（生产数据被污染了）
  const dirty = write && write.ok && write.cleaned === false
    ? ` 另：本次探测的测试文档未能自动删除（${collName} 里可能已残留 1 条），请用 admin#cleanupProbes 清理。`
    : '';
  // ⚠ 必须写控制台里的**显示名**「所有用户不可读写」——官方文档术语叫
  //   「仅管理端可读写」，但控制台里压根没有这几个字，照术语找会找不到。
  const FIX = `控制台 → 数据库 → 集合列表 → 点开 ${collName} → 「数据权限」标签页 → 选第 4 项「${PERM_MODE.ADMIN_ONLY}」（适用场景写着「后台流水数据等」的那个；官方文档里它的术语名是「仅管理端可读写」）。`;
  switch (status) {
    case 'publicWrite':
      return `⚠ ${collName} 当前是「${mode}」：客户端既能读全站数据、又能往里插文档 —— 严重后门，任何人拿到小程序都能改全站数据。${FIX}${dirty}`;
    case 'ownWrite':
      return `⚠ ${collName} 当前是「${mode}」：客户端读不到别人的数据，但**能往共享集合里插文档** —— 这仍是后门（服务端读集合不带 _openid 过滤，插进去的内容对全站可见；admins 更是能直接给自己发管理员）。${FIX}${dirty}`;
    case 'writeOnly':
      return `⚠ ${collName} 客户端能写（读被拒）—— 异常组合，但能写就是后门。${FIX}${dirty}`;
    case 'readable':
      return `⚠ ${collName} 当前是「${mode}」：客户端能读到全站共享数据（泄漏），虽插不进文档但内容全被看见。${FIX}${dirty}`;
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
    summary = `${criticalBad.length} 个共享集合存在后门：${criticalBad.map((r) => `${r.name}（${r.mode}）`).join('、')}`;
  } else if (bad.length) {
    summary = `${bad.length} 个集合需注意：${bad.map((r) => r.name).join('、')}`;
  } else {
    summary = `全部 ${results.length} 个集合权限符合预期`;
  }
  const recheck = results.filter((r) => r.needRecheck).map((r) => r.name);
  if (recheck.length) {
    summary += `（${recheck.join('、')} 当前为空，权限模式待补数据后复检）`;
  }
  return { ok: !bad.length, results, bad, criticalBad, recheck, summary };
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
 *   ⚠ 更隐蔽的一种污染：别人插的文档**不带** __mg_perm_probe 标记，
 *     所以按标记查不出来。判据是「文档带 _openid」—— 服务端/控制台写入的记录
 *     **不会**自动带 _openid，只有客户端写入的才带 → 共享集合里出现带 _openid
 *     的文档 = 有客户端往里插过东西。
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
 * 清理共享集合里的污染文档（服务端执行）。
 *   删两类：① 带 __mg_perm_probe 标记的（自检插的）
 *          ② 带 _openid 的（客户端插的 —— 共享集合里这类文档本就不该存在）
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
