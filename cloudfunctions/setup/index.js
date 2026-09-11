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
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = [
  { name: 'words', desc: '生词本' },
  { name: 'study_records', desc: '学习记录' },
  { name: 'study_plans', desc: '复习计划' },
  { name: 'wrong_questions', desc: '错题本' },
  { name: 'user_settings', desc: '用户设置' },
  { name: 'worddict', desc: '词库（需所有用户可读 + prefix 索引）' },
  { name: 'content_files', desc: '云存储路径→fileID 映射' },
];

exports.main = async (event = {}) => {
  switch (event.action) {
    case 'ensureCollections':
      return await ensureCollections();
    case 'stats':
      return await stats();
    default:
      return { ok: false, error: `unknown action: ${event.action}` };
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
