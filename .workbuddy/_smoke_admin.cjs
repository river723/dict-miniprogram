/**
 * 管理员鉴权回归 —— 验证闸门真的挡得住，且不会误伤管理员自己。
 *
 * 覆盖：
 *  1. admin-guard 指纹算法与内置白名单
 *  2. isAdmin：内置指纹命中 / admins 集合命中 / 空 OPENID 拒绝 / 查询异常 fail-closed
 *  3. 三个危险云函数（seed / contentseed / setup）入口都调了闸门，且闸门在 action 分发之前
 *  4. 前端：设置页隐藏入口、seed 页兜底校验
 *  5. admin-guard 副本与权威源一致（防漂移）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

const ok = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
  }
};

console.log('=== 1. admin-guard 指纹与内置白名单 ===');

const guardPath = path.join(ROOT, 'scripts', 'lib', 'admin-guard.cjs');
const guard = require(guardPath);

ok('导出 fingerprint / isAdmin / forbidden', typeof guard.fingerprint === 'function'
  && typeof guard.isAdmin === 'function'
  && typeof guard.forbidden === 'function');

ok('导出 ADMIN_COLLECTION = admins', guard.ADMIN_COLLECTION === 'admins');

// ⚠ 仓库是公开的 → 这里**不存明文 openid**，只断言机制正确。
//   内置白名单里存的是 sha256 指纹；要验证「某个 openid 命中内置白名单」，
//   做法是往导出的数组里临时注入一个测试指纹，再用已知明文验证命中 ——
//   这样测的是真实机制（isAdmin 内部就是 includes(fingerprint(openid))），
//   又不需要把开发者的明文 openid 写进仓库。
const DEV_FP = '39a680308f98e13c7a986a1cdc7f20ee0a7e47a53f7d523296f3cb84e56d8807';
ok('内置白名单非空', Array.isArray(guard.BUILTIN_ADMIN_FINGERPRINTS)
  && guard.BUILTIN_ADMIN_FINGERPRINTS.length > 0);
ok('内置白名单里的指纹都是 64 位 sha256 十六进制',
  guard.BUILTIN_ADMIN_FINGERPRINTS.every((f) => /^[0-9a-f]{64}$/.test(f)));
ok('内置白名单无重复项',
  new Set(guard.BUILTIN_ADMIN_FINGERPRINTS).size === guard.BUILTIN_ADMIN_FINGERPRINTS.length);

ok('fingerprint(空串) 不等于内置指纹',
  guard.fingerprint('') !== DEV_FP);
ok('fingerprint 忽略首尾空白',
  guard.fingerprint('  abc  ') === guard.fingerprint('abc'));
ok('fingerprint 是 sha256',
  guard.fingerprint('abc')
  === crypto.createHash('sha256').update('abc').digest('hex'));

console.log('\n=== 2. isAdmin 判定 ===');

// 模拟 db.collection(...).where(...).limit(1).get()
const makeDb = (rows, opts = {}) => ({
  collection(name) {
    if (opts.throwOnGet) throw new Error('collection not exist');
    return {
      where(q) {
        return {
          limit() {
            return {
              async get() {
                if (opts.throwOnGet) throw new Error('permission denied');
                const hit = rows.filter((r) => r.openid === q.openid);
                return { data: hit };
              },
            };
          },
        };
      },
    };
  },
});

(async () => {
  // 往内置白名单注入一个「测试 openid」的指纹，验证内置路径真的能命中。
  // 这样测的是真实机制，又不需要把开发者的明文 openid 写进仓库。
  const TEST_OPENID = 'oTestOnlyForRegression';
  const TEST_FP = guard.fingerprint(TEST_OPENID);
  guard.BUILTIN_ADMIN_FINGERPRINTS.push(TEST_FP);

  ok('内置指纹命中 → 管理员（不查集合）',
    (await guard.isAdmin(TEST_OPENID, makeDb([]))) === true);

  ok('非内置 openid + 集合无记录 → 非管理员',
    (await guard.isAdmin('oSomeoneElse', makeDb([]))) === false);

  ok('非内置 openid + 集合有记录 → 管理员（动态白名单生效）',
    (await guard.isAdmin('oOther', makeDb([{ openid: 'oOther' }]))) === true);

  // ⚠⚠ 纵深防御：客户端插入的 admins 文档**一定**带 _openid（平台强制注入），
  //   而服务端写入的记录**不会**自动带 _openid。
  //   → 即使 admins 集合权限被误设成「仅创建者可读写」（客户端能插文档），
  //     对方插进来的 {openid:"自己"} 也不能让他变成管理员。
  ok('⚠ 客户端插入的条目（带 _openid）→ 不认（权限误配也无法提权）',
    (await guard.isAdmin('oOther', makeDb([{ openid: 'oOther', _openid: 'oAttacker' }]))) === false);

  ok('⚠ 只有服务端条目（无 _openid）才算管理员',
    (await guard.isAdmin('oOther', makeDb([
      { openid: 'oOther', _openid: 'oAttacker' },
      { openid: 'oOther', note: 'by admin cloud function' },
    ]))) === true);

  ok('空 OPENID → 拒绝（控制台/无上下文一律失败）',
    (await guard.isAdmin('', makeDb([{ openid: '' }]))) === false);

  ok('undefined OPENID → 拒绝',
    (await guard.isAdmin(undefined, makeDb([]))) === false);

  ok('集合查询抛错 → fail-closed 判非管理员（不得放行）',
    (await guard.isAdmin('oOther', makeDb([], { throwOnGet: true }))) === false);

  ok('集合查询抛错时，内置指纹管理员仍放行',
    (await guard.isAdmin(TEST_OPENID, makeDb([], { throwOnGet: true }))) === true);

  ok('无 db 参数 → 非管理员',
    (await guard.isAdmin('oOther', null)) === false);

  // 清掉注入的测试指纹，不影响后续断言
  guard.BUILTIN_ADMIN_FINGERPRINTS.splice(
    guard.BUILTIN_ADMIN_FINGERPRINTS.indexOf(TEST_FP), 1);

  const fb = guard.forbidden();
  ok('forbidden 返回 ok:false + error 文案',
    fb.ok === false && /FORBIDDEN/.test(fb.error));

  console.log('\n=== 3. 云函数闸门位置与顺序 ===');

  const GATED = [
    { fn: 'seed', danger: 'clearWorddict（删全站词库）' },
    { fn: 'contentseed', danger: 'clear（删全站内容）' },
    { fn: 'setup', danger: 'ensureCollections（建全局集合）' },
  ];

  for (const { fn, danger } of GATED) {
    const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions', fn, 'index.js'), 'utf8');
    const guardIdx = src.indexOf('isAdmin(OPENID, db)');
    const switchIdx = src.indexOf('switch (event.action)');
    const hasGetCtx = /getWXContext\(\)/.test(src);
    const hasRequire = /require\('\.\/admin-guard'\)/.test(src);

    ok(`${fn} 引入了 admin-guard`, hasRequire);
    ok(`${fn} 取了 getWXContext().OPENID`, hasGetCtx);
    ok(`${fn} 调用了 isAdmin 闸门`, guardIdx > -1);
    ok(`${fn} 闸门在 action 分发之前（${danger} 不可绕过）`,
      guardIdx > -1 && switchIdx > -1 && guardIdx < switchIdx,
      `guard@${guardIdx} switch@${switchIdx}`);
    ok(`${fn} 闸门失败即 return，不继续执行`, /isAdmin[\s\S]{0,200}?return forbidden/.test(src));
  }

  console.log('\n=== 4. 只读云函数未被误伤 ===');
  const READONLY = ['worddict', 'content', 'tts'];
  for (const fn of READONLY) {
    const p = path.join(ROOT, 'cloudfunctions', fn, 'index.js');
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    ok(`${fn} 未加管理员闸门（只读服务，公开读不影响安全）`,
      !/isAdmin\(OPENID/.test(src));
  }

  console.log('\n=== 5. 前端隐藏与兜底 ===');

  const settingsWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.wxml'), 'utf8');
  ok('设置页「词库初始化」被 wx:if="{{isAdmin}}" 包住',
    /wx:if="\{\{isAdmin\}\}"[\s\S]{0,220}?词库初始化/.test(settingsWxml));

  const settingsJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.js'), 'utf8');
  ok('设置页调用了 fetchAdminState', /fetchAdminState/.test(settingsJs));
  ok('设置页 goSeed 有二次校验', /goSeed[\s\S]{0,300}?isAdmin/.test(settingsJs));

  const seedWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/seed/seed.wxml'), 'utf8');
  ok('seed 页渲染区分 checking / denied / ok',
    /adminState === 'checking'/.test(seedWxml)
    && /adminState === 'denied'/.test(seedWxml)
    && /adminState === 'ok'/.test(seedWxml));
  ok('seed 页操作按钮被 adminState === ok 包住',
    /adminState === 'ok'/.test(seedWxml) && /onEnsureCollections/.test(seedWxml));

  const seedJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/seed/seed.js'), 'utf8');
  ok('seed 页 onShow 走 checkAdmin', /onShow[\s\S]{0,200}?checkAdmin/.test(seedJs));
  ok('seed 页 checkAdmin 失败时 denied + 不加载数据',
    /checkAdmin[\s\S]{0,600}?adminState: 'denied'/.test(seedJs));

  const adminSvc = fs.readFileSync(path.join(ROOT, 'miniprogram/services/admin.js'), 'utf8');
  ok('前端服务查 admin#whoami', /callCloud\('admin',\s*\{\s*action:\s*'whoami'/.test(adminSvc));
  ok('前端查询失败时 fail-closed（isAdmin:false）',
    /catch[\s\S]{0,300}?isAdmin:\s*false/.test(adminSvc));

  console.log('\n=== 6. 副本与权威源一致（防漂移） ===');
  const src = fs.readFileSync(guardPath, 'utf8');
  for (const fn of ['seed', 'contentseed', 'setup', 'admin']) {
    const p = path.join(ROOT, 'cloudfunctions', fn, 'admin-guard.js');
    if (!fs.existsSync(p)) {
      ok(`${fn} 副本存在`, false, '文件不存在');
      continue;
    }
    ok(`${fn} 副本与权威源字节一致`,
      fs.readFileSync(p, 'utf8') === src);
  }

  console.log('\n=== 7. admin 云函数自身 ===');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/admin/index.js'), 'utf8');
  ok('admin 暴露 whoami（任何人可查自己身份）', /case 'whoami'/.test(adminSrc));
  ok('admin 暴露 grantAdmin / revokeAdmin / listAdmins',
    /case 'grantAdmin'/.test(adminSrc)
    && /case 'revokeAdmin'/.test(adminSrc)
    && /case 'listAdmins'/.test(adminSrc));
  ok('admin 的写操作要求已是管理员',
    /case 'grantAdmin'[\s\S]{0,200}?isAdmin\(OPENID, db\)[\s\S]{0,120}?forbidden/.test(adminSrc));
  ok('admin 的 listAdmins 要求管理员',
    /case 'listAdmins'[\s\S]{0,200}?isAdmin\(OPENID, db\)[\s\S]{0,120}?forbidden/.test(adminSrc));
  ok('admin 已声明 package.json 与 config.json',
    fs.existsSync(path.join(ROOT, 'cloudfunctions/admin/package.json'))
    && fs.existsSync(path.join(ROOT, 'cloudfunctions/admin/config.json')));

  console.log('\n=== 8. setup 会建 admins 集合 ===');
  const setupSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/setup/index.js'), 'utf8');
  ok('setup 的集合列表包含 admins', /name:\s*'admins'/.test(setupSrc));

  console.log('\n=== 9. 部署脚本参数解析（防「斜杠被当函数名」）===');
  const deployPath = path.join(ROOT, 'scripts', 'deploy-cloudfunctions.mjs');
  const deploySrc = fs.existsSync(deployPath) ? fs.readFileSync(deployPath, 'utf8') : '';
  ok('部署脚本存在', !!deploySrc);
  ok('部署脚本对未知函数名显式报错而非静默跳过',
    /unknown\.length[\s\S]{0,400}?process\.exit\(1\)/.test(deploySrc));
  ok('部署脚本按白名单校验函数名（cloudfunctions 下真实存在）',
    /all\.includes\(/.test(deploySrc));
  ok('部署脚本不把含斜杠的参数当函数名（Windows 路径 / Git Bash MSYS 转换坑）',
    deploySrc.includes('pathLike') && deploySrc.includes('splitTokens'));
  ok('部署脚本提供 --dry 干跑（验证命令写法不触发真实部署）',
    /--dry/.test(deploySrc));

  console.log('\n=== 10. 集合权限自检模块（permCheck）===');
  const permPath = path.join(ROOT, 'miniprogram', 'services', 'permCheck.js');
  const permSrc = fs.existsSync(permPath) ? fs.readFileSync(permPath, 'utf8') : '';
  ok('permCheck 模块存在', !!permSrc);
  ok('自检跑在客户端 SDK 上（wx.cloud.database），不是服务端',
    permSrc.includes('wx.cloud.database()'));
  ok('自检做了读 + 写两次探测', /probeRead/.test(permSrc) && /probeWrite/.test(permSrc));
  ok('写探测带标记，便于事后识别与清理',
    permSrc.includes('__mg_perm_probe'));
  ok('写成功后立刻删除探测文档（不留垃圾）',
    /remove\(\{/.test(permSrc) && /cleaned/.test(permSrc));
  ok('判定分多档：locked / ownWrite / publicWrite / readable',
    /locked/.test(permSrc)
    && /ownWrite/.test(permSrc)
    && /publicWrite/.test(permSrc)
    && /readable/.test(permSrc));

  // ⚠ 自检必须覆盖**全部**集合，不能只验 admins —— 其余 8 个同样是攻击面
  //   （worddict 客户端可写 = 任何人能污染全站词库）。
  const EXPECTED_COLLECTIONS = [
    'admins', 'worddict', 'worddict_ielts', 'content_files',
    'words', 'study_records', 'study_plans', 'wrong_questions', 'user_settings',
  ];
  const missingCols = EXPECTED_COLLECTIONS.filter((c) => !permSrc.includes(`'${c}'`));
  ok('自检覆盖全部 9 个集合（含 4 个共享集合）',
    missingCols.length === 0,
    missingCols.length ? `漏了：${missingCols.join('、')}` : '');
  ok('共享集合标为 critical（客户端可写 = 真后门）',
    /risk:\s*'critical'/.test(permSrc));
  ok('用户私有集合标为 low，不做写探测（避免污染用户数据）',
    /risk:\s*'low'/.test(permSrc) && /needWrite/.test(permSrc));
  ok('写探测只对共享集合执行',
    /needWrite\s*=\s*risk\s*===\s*'critical'/.test(permSrc));
  ok('设置页已接上自检入口',
    /checkPerms/.test(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.js'), 'utf8'))
    && /checkPerms/.test(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.wxml'), 'utf8')));
  // ⚠ 小程序里 wx:if 优先级高于 wx:for —— 同元素上两者并用，条件里的 item 尚未定义，
  //   永远不成立 → 提示永远不显示。必须先在 JS 里过滤（permResult.bad）。
  const permSettingsWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/settings/settings.wxml'), 'utf8');
  const forIfOnSameEl = /<[a-z-]+[^>]*wx:for[^>]*wx:if[^>]*>/.test(permSettingsWxml)
    || /<[a-z-]+[^>]*wx:if[^>]*wx:for[^>]*>/.test(permSettingsWxml);
  ok('WXML 没有把 wx:for 与 wx:if 放同一元素（小程序里 wx:if 优先级更高，会失效）',
    !forIfOnSameEl);
  ok('有问题的集合在 JS 里预过滤成 permResult.bad',
    /bad:\s*bad/.test(permSrc) || /bad,/.test(permSrc));

  console.log('\n=== 10·补、权限模式识别（四种，名字相近含义不同）===');
  // ⚠ 背景：用户曾把三个共享集合设成「仅创建者可读写」，两者只差几个字，
  //   但后者客户端照样能往共享集合插文档 → 仍是真后门。
  //   所以自检必须能**报出当前实际生效的是哪一种**，否则用户会反复配错同一个地方。
  // ⚠⚠ 更狠的一次踩坑：官方文档术语叫「仅管理端可读写」，但**控制台根本不显示这几个字**，
  //   控制台显示的是「所有用户不可读写」→ 用户按术语去找，找不到选项。
  //   所以下面同时断言「控制台显示名」和「官方术语名」都在，且提示用显示名。
  ok('permCheck 列出了控制台里的四个显示名',
    /所有用户不可读写/.test(permSrc)
    && /仅创建者可读写/.test(permSrc)
    && /所有用户可读，仅创建者可读写/.test(permSrc)
    && /所有用户可读'/.test(permSrc));
  ok('permCheck 保留了官方术语名做对照（仅管理端可读写）',
    /仅管理端可读写/.test(permSrc));
  ok('PERM_MODE.ADMIN_ONLY 用的是控制台显示名「所有用户不可读写」',
    /ADMIN_ONLY:\s*'所有用户不可读写'/.test(permSrc));
  ok('permCheck 有 inferMode（推断当前是哪种模式）',
    /inferMode/.test(permSrc) && /PERM_MODE/.test(permSrc));
  ok('permCheck 结果里带 mode 字段',
    /\bmode\b/.test(permSrc) && /mode:/.test(permSrc));
  ok('判定用 globalReadable（读到的文档有没有 _openid）而非单纯条数',
    /globalReadable/.test(permSrc));
  ok('能区分 ownWrite（仅创建者可读写，能插 = 后门）',
    /ownWrite/.test(permSrc));
  ok('提示里点名当前模式，并给出唯一正确选项「所有用户不可读写」+「数据权限」页签',
    /buildHint/.test(permSrc)
    && /所有用户不可读写/.test(permSrc)
    && /数据权限/.test(permSrc));
  ok('前端设置页展示了 mode',
    /item\.mode/.test(permSettingsWxml) && /se-perm__mode/.test(permSettingsWxml));
  // ⚠ 核心安全断言：「仅创建者可读写」绝不能被判为安全
  ok('「仅创建者可读写」被显式标注为后门（ownWrite → ok=false）',
    /status = 'ownWrite';[\s\S]{0,40}ok = false/.test(permSrc));


  console.log('\n=== 11. 权限选项名用控制台显示名（别再让用户找不存在的名字）===');
  // ⚠ 历史教训：曾经反过来断言「控制台没有『所有用户不可读写』」——**完全错了**。
  //   2026 版控制台「数据权限」页显示的就是「所有用户不可读写」，
  //   「仅管理端可读写」只是官方文档术语。写反会让用户反复找不到选项。
  const setupSrc2 = fs.readFileSync(path.join(ROOT, 'cloudfunctions/setup/index.js'), 'utf8');
  const guardSrc2 = fs.readFileSync(guardPath, 'utf8');
  ok('setup 用了控制台显示名「所有用户不可读写」',
    setupSrc2.includes('所有用户不可读写'));
  ok('setup 明确提示「建集合 ≠ 权限正确」',
    /建集合 ≠ 权限正确/.test(setupSrc2));
  ok('admin-guard 权威源用了控制台显示名「所有用户不可读写」',
    guardSrc2.includes('所有用户不可读写'));
  // 反向断言：禁止「控制台没有『所有用户不可读写』」这类错误说法回流
  const FE_SRCS = [
    ['permCheck.js', permSrc],
    ['setup/index.js', setupSrc2],
    ['admin-guard.cjs', guardSrc2],
  ];
  const badClaim = FE_SRCS.filter(([, s]) =>
    /没有[「']?\s*「所有用户不可读写」/.test(s)
    || /控制台[^。\n]{0,12}没有[^。\n]{0,12}所有用户不可读写/.test(s));
  ok('没有任何文件再声称「控制台没有『所有用户不可读写』」',
    badClaim.length === 0, badClaim.map(([n]) => n).join(', '));

  console.log('\n=== 12. 共享集合数据完整性审计（audit / cleanup）===');
  // 📌 背景：写探测会往共享集合真插测试文档。权限开放时插得进去，
  //   若删除失败 → 生产集合留垃圾（词库总数被污染 → 浏览页数字不准）。
  //   服务端 SDK 不受集合权限限制，所以必须能在服务端审计+清理。
  const adminFnSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/admin/index.js'), 'utf8');
  ok('admin 云函数提供 auditCollections（审计共享集合完整性）',
    /case 'auditCollections'/.test(adminFnSrc) && /auditCollections/.test(adminFnSrc));
  ok('admin 云函数提供 cleanupProbes（清理探测残留）',
    /case 'cleanupProbes'/.test(adminFnSrc) && /cleanupProbes/.test(adminFnSrc));
  ok('审计/清理都要求管理员身份',
    /case 'auditCollections'[\s\S]{0,200}isAdmin/.test(adminFnSrc)
    && /case 'cleanupProbes'[\s\S]{0,200}isAdmin/.test(adminFnSrc));
  ok('探测残留按标记字段查（不扫全表）',
    /PROBE_MARK/.test(adminFnSrc) && /exists\(true\)/.test(adminFnSrc));
  ok('探测标记与前端 permCheck 一致',
    adminFnSrc.includes('__mg_perm_probe') && permSrc.includes('__mg_perm_probe'));
  ok('清理只删带标记的文档，不碰业务数据',
    /PROBE_MARK/.test(adminFnSrc) && !/clearWorddict/.test(adminFnSrc));
  ok('前端把「探测文档没删掉」如实提示给用户',
    /cleaned === false/.test(permSrc) && /cleanupProbes/.test(permSrc));
  // ⚠ 两类污染：① 带标记的（自检插的）② 带 _openid 的（客户端插的）。
  //   第二类标记查不出来，只能靠 _openid 揪 —— 服务端写入的记录不会自动带它。
  ok('admin 审计能查出「客户端插入的文档」（按 _openid 判）',
    /injectedCount/.test(adminFnSrc)
    && /_openid: db\.command\.exists\(true\)/.test(adminFnSrc));
  ok('admin 清理也覆盖客户端插入的文档（无标记但带 _openid）',
    /_openid: db\.command\.exists\(true\)/.test(adminFnSrc)
    && /PROBE_MARK\]: db\.command\.exists\(false\)/.test(adminFnSrc));
  ok('admin-guard 只认无 _openid 的 admins 条目（纵深防御）',
    /!d\._openid/.test(
      fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'admin-guard.cjs'), 'utf8')));

  console.log('\n=== 13. 禁止「所有用户可读」这条错误指引回流 ===');
  // ⚠ 这条错误指引的实际后果：用户照着把词库设成客户端可写 = 全站词库谁都能改。
  //   前端 0 处直连数据库 → 没有任何集合需要「所有人可读」。
  const worddictSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/worddict/index.js'), 'utf8');
  const opManual = fs.readFileSync(path.join(ROOT, 'docs/运维手册.md'), 'utf8');
  const badGuide = (s) => {
    // 只抓「建议设成可读」的表述；「⚠ 不要设成…」这类纠正性说明不算。
    return /重设集合权限为「所有用户可读」/.test(s)
      || /将读权限设为「所有用户可读」/.test(s)
      || /权限设为「所有用户可读」/.test(s);
  };
  ok('运维手册没有「重设权限为所有用户可读」的错误指引',
    !badGuide(opManual),
    badGuide(opManual) ? '运维手册仍在建议设成所有人可读' : '');
  ok('worddict 云函数没有「将读权限设为所有用户可读」的错误指引',
    !badGuide(worddictSrc),
    badGuide(worddictSrc) ? 'worddict 注释仍在建议设成所有人可读' : '');
  ok('运维手册明确写了「前端 0 直连，不需开放读权限」的理由',
    opManual.includes('0 处直连') || opManual.includes('0处直连'));

  console.log(`\n────────────────────────────`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) process.exit(1);
})();
