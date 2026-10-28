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

  console.log(`\n────────────────────────────`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) process.exit(1);
})();
