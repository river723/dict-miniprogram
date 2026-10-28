/**
 * setup 云函数 —— 环境初始化 / 体检用，不参与日常业务。
 *
 * 存在的理由：新建集合官方只支持「云函数端 SDK」和「控制台」两种途径，
 * 所以把它做成一个可以一键跑的函数，避免每次换环境都要在控制台点七遍。
 *
 * action:
 *   ensureCollections  创建缺失的集合（已存在则跳过），返回逐集合结果
 *   stats              统计各集合文档数，用来判断数据到底有没有导进去
 *
 * 用法：开发者工具里 setup 右键 →「云端测试」，请求参数填 {"action":"ensureCollections"}
 *
 * ⚠ 闸门说明：本函数只建空集合 + 读计数，本身不破坏数据，但集合可以被任意用户
 *   无限创建（垃圾集合 / 配额消耗），所以同样限管理员。
 *   「先有鸡还是先有蛋」的问题由 admin-guard 的内置指纹解开：
 *   开发者本人的 openid 指纹写在代码里，不依赖 admins 集合是否已建好，
 *   所以首次部署后仍能正常建集合（admins 集合也在下面的列表里）。
 *
 * ⚠⚠ 建集合 ≠ 权限正确！本函数只能建空集合，**权限仍需在控制台手动设置**：
 *   云开发控制台 → 数据库 → 点集合 → 权限设置 → 选「仅管理端可读写」
 *   （= 小程序端读不了也写不了，只有云函数/控制台能访问）。
 *   ⚠ 控制台里**没有**「所有用户不可读写」这个选项名，别找错。
 *   漏设的后果：admins 集合若客户端可写 → 普通用户能给自己写一条白名单，
 *   直接绕过全部鉴权。用小程序「设置 → 安全自检 → 检测集合权限」可验证。
 *
 * 📌 本项目前端 0 处直连数据库（全部走云函数），所以**所有**集合都应该是
 *   「仅管理端可读写」。若将来前端要直连读某集合，才把那一个改成
 *   「所有用户可读，仅管理端可写」。
 */
const cloud = require('wx-server-sdk');
const { isAdmin, forbidden } = require('./admin-guard');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = [
  { name: 'words', desc: '生词本' },
  { name: 'study_records', desc: '学习记录' },
  { name: 'study_plans', desc: '复习计划' },
  { name: 'wrong_questions', desc: '错题本' },
  { name: 'user_settings', desc: '用户设置' },
  { name: 'worddict', desc: '词库（前端 0 直连，服务端读；如将来前端要直连需改为「所有用户可读」）' },
  { name: 'content_files', desc: '云存储路径→fileID 映射' },
  { name: 'admins', desc: '管理员白名单（须「仅管理端可读写」= 客户端不可读写）' },
];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!(await isAdmin(OPENID, db))) {
      return forbidden('FORBIDDEN: 仅管理员可执行环境初始化操作');
    }
    switch (event.action) {
      case 'ensureCollections':
        return await ensureCollections();
      case 'stats':
        return await stats();
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
};

/** 幂等建集合：wx-server-sdk 里集合已存在会报错，忽略即可。 */
async function ensureCollections() {
  const report = [];
  for (const { name, desc } of COLLECTIONS) {
    try {
      await db.createCollection(name);
      report.push({ name, desc, status: 'created' });
    } catch (e) {
      const msg = e.message || '';
      const already = /exist|已存在|duplicate/i.test(msg) || e.errCode === -501001;
      report.push({ name, desc, status: already ? 'exists' : 'failed', msg });
    }
  }
  return { ok: true, report };
}

/** 各集合文档数；集合不存在会抛错，单列 ticks 出来而不中断整体。 */
async function stats() {
  const counts = {};
  for (const { name, desc } of COLLECTIONS) {
    try {
      const res = await db.collection(name).count();
      counts[name] = { count: res.total, desc };
    } catch (e) {
      counts[name] = { count: null, desc, error: e.message };
    }
  }
  return { ok: true, env: process.env.TCB_ENV || '', counts };
}
