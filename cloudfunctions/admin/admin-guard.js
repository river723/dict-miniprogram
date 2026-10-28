/**
 * admin-guard.js —— 云函数侧的「管理操作」鉴权守卫。
 *
 * ## 为什么鉴权必须在云函数
 * 前端传什么都不可信：本地存储可改、抓包可伪造。所以「谁是管理员」只能在服务端判定，
 * 且依据必须是 **微信平台注入** 的 `cloud.getWXContext().OPENID` —— 它由微信云开发在
 * 调用链里自动填充，小程序端无法构造或覆盖。
 *
 * ## 白名单的两个来源（任一命中即为管理员）
 * 1) **内置指纹** `BUILTIN_ADMIN_FINGERPRINTS` —— sha256(openid)。
 *    存哈希而不是 openid 本身：仓库可能是公开的，而 openid 虽非密钥、却是个人标识，
 *    sha256 不可逆推（openid 熵 ~166bit，穷举不现实）。
 *    好处是**零配置**：开发者本人天生是管理员，不依赖任何集合/环境变量是否就绪。
 * 2) **云数据库 `admins` 集合** —— 文档形如 `{ openid, note, added_at }`。
 *    用于**不重部署**就增减管理员（白名单改代码必须重新部署云函数，这个不用）。
 *    ⚠ 该集合权限必须设为「**仅管理端可读写**」：只有云函数的服务端 SDK 与控制台能访问，
 *    这样普通用户无法用客户端 SDK 把自己加进白名单。
 *    📌 控制台里的选项名是「仅管理端可读写」，**没有**「所有用户不可读写」这种说法
 *    （那是自定义安全规则 { "read": false, "write": false } 的等价描述）。
 *
 * ## 空 OPENID 一律拒绝（fail-closed）
 * 控制台「云端测试」调用的云函数没有 OPENID。任何**空 OPENID 直接判非管理员**，
 * 这样即便日后给这些函数开了 HTTP 访问服务（同样没有用户上下文）也不会漏出缺口。
 * 代价：控制台里调试 seed/contentseed 会拿到 FORBIDDEN —— 属预期，请在真机/小程序内验证。
 *
 * ## 本文件是副本，不要手改
 * 云函数各自独立打包上传、无法跨目录 require，所以三处要共用同一份逻辑。
 * 权威源在 `scripts/lib/admin-guard.js`，改完执行：
 *     node .workbuddy/admin_wire.cjs --apply
 * 再用 `node .workbuddy/_smoke_admin.cjs` 校验三份副本一致。
 */

const crypto = require('crypto');

/** 管理员白名单集合名。 */
const ADMIN_COLLECTION = 'admins';

/**
 * 内置管理员指纹（sha256(openid)）。
 * 新增管理员：把 openid 的 sha256 填进来（见 docs/管理员与鉴权.md）。
 */
const BUILTIN_ADMIN_FINGERPRINTS = [
  // 开发者本人
  '39a680308f98e13c7a986a1cdc7f20ee0a7e47a53f7d523296f3cb84e56d8807',
];

/** openid → sha256 指纹（去首尾空白，忽略大小写差异以外的任何格式问题）。 */
function fingerprint(openid) {
  return crypto.createHash('sha256').update(String(openid || '').trim()).digest('hex');
}

/**
 * 判断某个 OPENID 是否管理员。
 * @param {string} openid 来自 getWXContext().OPENID
 * @param {object} db     已初始化的 cloud.database()
 */
async function isAdmin(openid, db) {
  const id = String(openid || '').trim();
  if (!id) return false;
  if (BUILTIN_ADMIN_FINGERPRINTS.includes(fingerprint(id))) return true;
  if (!db) return false;
  try {
    const res = await db.collection(ADMIN_COLLECTION).where({ openid: id }).limit(1).get();
    return !!(res.data && res.data.length);
  } catch (e) {
    // 集合不存在 / 无权限 / 查询异常 → 一律按非管理员处理。
    // 绝不能因为查不到就放行（fail-closed）；内置指纹已覆盖开发者本人，不影响可用性。
    return false;
  }
}

/** 统一的拒绝返回值。前端 callCloud 见到 ok:false 会抛错并带上 message。 */
function forbidden(message) {
  return { ok: false, error: message || 'FORBIDDEN: 仅管理员可执行此操作' };
}

/**
 * 确保 admins 集合存在（已存在则忽略）。
 * 云函数的服务端 SDK 可以创建集合，客户端不行 —— 所以这一步只能在云函数里做。
 */
async function ensureAdminsCollection(db) {
  if (!db) return;
  try {
    await db.createCollection(ADMIN_COLLECTION);
  } catch (e) {
    // -501001 / already exists → 已存在，正常
  }
}

module.exports = {
  ADMIN_COLLECTION,
  BUILTIN_ADMIN_FINGERPRINTS,
  fingerprint,
  isAdmin,
  forbidden,
  ensureAdminsCollection,
};
