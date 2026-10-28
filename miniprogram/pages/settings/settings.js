/**
 * 设置 —— 对齐 memo-grad SettingsScreen。
 *
 * 分组：外观（主题）→ 学习设置（每日新词 / AI 出题练习题数 / 4 个开关）→
 *      文章生成设置（生词数 / 目标词数）→ 数据管理（云同步 / 词库初始化）→
 *      高级选项（重置设置 / 清除数据）→ 版本信息。
 *
 * 已剔除 App 里的订阅、账号、API Key、文件导入导出：小程序版 AI 由云端云函数统一提供，
 * 备份由微信云托管，因此不做本地密钥与 .bk 文件。
 */
import StorageService from '../../services/storage';
import { DEFAULT_SETTINGS } from '../../services/storage';
import { DAILY_NEW_WORDS_LIMIT } from '../../theme/tokens';
import { THEME_OPTIONS } from '../../constants/index';
import { applyTheme, invalidateTheme } from '../../utils/theme';
import { fetchAdminState, peekAdminState } from '../../services/admin';
import { checkCollectionPermissions, auditCollections, cleanupProbes } from '../../services/permCheck';

const save = (patch) => StorageService.saveSettings(patch);

Page({
  data: {
    settings: null,
    themes: THEME_OPTIONS,
    dailyMax: DAILY_NEW_WORDS_LIMIT,
    // 管理员身份：控制「词库初始化」入口是否显示。
    // ⚠ 这只是体验层（少显示一个按钮），真正的闸门在云函数内部 ——
    //   即便有人手改前端直接调 seed 云函数，服务端也会按 OPENID 挡下来。
    isAdmin: false,
    // 集合权限自检结果（仅管理员可见）。
    permChecking: false,
    permResult: null,   // { ok, summary, results: [...] }
    // 共享集合数据完整性审计结果（仅管理员可见）。
    auditBusy: false,
    auditResult: null,  // { ok, summary, report: [...], probeTotal }
  },

  onShow() {

    applyTheme(this);
    this.refresh();
    this.loadAdminState();
  },

  refresh() {
    const settings = StorageService.getSettings();
    this.setData({ settings });
  },

  /**
   * 查管理员身份（异步）。
   * 先用缓存同步上屏（避免「按钮先出现再消失」的闪烁），再回源确认。
   */
  async loadAdminState() {
    const cached = peekAdminState();
    if (cached.isAdmin) this.setData({ isAdmin: true });
    const state = await fetchAdminState();
    this.setData({ isAdmin: state.isAdmin });
  },

  // ---------- 外观 ----------
  async onThemeChange(e) {
    await save({ theme: e.currentTarget.dataset.value });
    // 立刻生效：清掉窗口色缓存再应用到当前页，否则要等返回页面走 onShow 才变
    invalidateTheme();
    applyTheme(this);
    this.refresh();
    wx.showToast({ title: '已切换', icon: 'none' });
  },

  // ---------- 步进器 ----------
  step(key, delta, min, max) {
    const cur = Number(this.data.settings[key]) || 0;
    const next = Math.max(min, Math.min(max, cur + delta));
    if (next === cur) return Promise.resolve();
    return save({ [key]: next }).then(() => this.refresh());
  },

  dailyDec() { return this.step('dailyNewWords', -1, 1, DAILY_NEW_WORDS_LIMIT); },
  dailyInc() { return this.step('dailyNewWords', 1, 1, DAILY_NEW_WORDS_LIMIT); },
  examDec() { return this.step('examQuestionCount', -1, 5, 20); },
  examInc() { return this.step('examQuestionCount', 1, 5, 20); },
  wordCountDec() { return this.step('articleWordCount', -1, 5, 20); },
  wordCountInc() { return this.step('articleWordCount', 1, 5, 20); },
  lengthDec() { return this.step('articleLength', -50, 100, 500); },
  lengthInc() { return this.step('articleLength', 50, 100, 500); },

  // ---------- 开关 ----------
  async onSwitch(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'autoPlaySound' && !this.data.settings.soundEnabled) return;
    await save({ [key]: e.detail.value });
    this.refresh();
  },

  // ---------- 数据管理 ----------
  async syncNow() {
    wx.showLoading({ title: '同步中' });
    try {
      await StorageService.flushDirty();
      await StorageService.pullAll();
      wx.hideLoading();
      wx.showToast({ title: '已同步', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },

  goSeed() {
    // 双保险：按钮本来就只对管理员显示，这里再校验一次，
    // 防止「按钮还没隐藏完 / 缓存过期」时被点进来。
    if (!this.data.isAdmin) {
      wx.showToast({ title: '仅管理员可使用', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/seed/seed' });
  },

  /**
   * 集合权限自检 —— 用客户端 SDK 探测 admins 集合是否真的「仅管理端可读写」。
   *
   * 集合权限是在云开发控制台里点的，点错了**不会有任何报错**，
   * 只在真有人越权时才暴露。这里主动验一把，把「以为设好了」变成「确认设好了」。
   *
   * ⚠ 结果里带 `mode`（当前实际生效的是官方四种模式里的哪一种）——
   *   「仅创建者可读写」和「仅管理端可读写」只差几个字，含义完全不同，
   *   不直接报出来的话很容易反复配错同一个地方。
   */
  async checkPerms() {
    if (this.data.permChecking) return;
    this.setData({ permChecking: true, permResult: null });
    wx.showLoading({ title: '检测中' });
    try {
      const res = await checkCollectionPermissions();
      this.setData({ permResult: res });
      wx.hideLoading();
      wx.showToast({
        title: res.ok ? '权限正常' : '发现后门',
        icon: res.ok ? 'success' : 'none',
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '检测失败', icon: 'none' });
    } finally {
      this.setData({ permChecking: false });
    }
  },

  // ---------- 共享集合数据审计（服务端执行）----------
  // 权限自检只看「规则对不对」，看不出「数据有没有被污染」。
  // 两种污染要分开统计：
  //   ① probeCount   —— 自检插的测试文档（带 __mg_perm_probe 标记）
  //   ② injectedCount—— 客户端从外面插进来的文档（带 _openid）。
  //                      服务端/控制台写入的记录**不会**自动带 _openid，
  //                      所以共享集合里带 _openid 的就是外来物。
  //
  // ⚠ countText 在 JS 侧拼好再给 WXML —— WXML 里 `=== undefined` 不可靠
  //   （数据序列化后 undefined 会变 null，比较结果不符合预期）。
  formatAudit(res) {
    const report = (res && res.report ? res.report : []).map((r) => {
      let countText = '—';
      if (r.error) countText = '读取失败';
      else if (typeof r.count === 'number') {
        countText = r.expect ? `${r.count} / ${r.expect}` : String(r.count);
      }
      if (r.probeCount) countText += ` ⚠残留${r.probeCount}`;
      if (r.injectedCount) countText += ` ⚠注入${r.injectedCount}`;
      return { ...r, countText };
    });
    return { ...res, report };
  },

  async auditData() {
    if (this.data.auditBusy) return;
    this.setData({ auditBusy: true, auditResult: null });
    wx.showLoading({ title: '审计中' });
    try {
      const res = this.formatAudit(await auditCollections());
      this.setData({ auditResult: res });
      wx.hideLoading();
      const bad = (res.probeTotal || 0) + (res.injectedTotal || 0);
      wx.showToast({
        title: bad ? `发现 ${bad} 条污染` : '数据完整',
        icon: bad ? 'none' : 'success',
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '审计失败', icon: 'none' });
    } finally {
      this.setData({ auditBusy: false });
    }
  },

  async cleanProbes() {
    if (this.data.auditBusy) return;
    wx.showModal({
      title: '清理污染文档',
      content: '将删除共享集合里两类外来文档：带 __mg_perm_probe 标记的测试文档、以及带 _openid 的客户端插入文档（共享集合里这类文档本就不该存在）。不会动服务端写入的业务数据。确定？',
      confirmText: '清理',
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ auditBusy: true });
        wx.showLoading({ title: '清理中' });
        try {
          const res = await cleanupProbes();
          wx.hideLoading();
          wx.showToast({
            title: res.removed ? `已清理 ${res.removed} 条` : '无需清理',
            icon: res.removed ? 'success' : 'none',
          });
          // 清完立刻重跑审计，让用户看到最新状态
          const after = this.formatAudit(await auditCollections());
          this.setData({ auditResult: after });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '清理失败', icon: 'none' });
        } finally {
          this.setData({ auditBusy: false });
        }
      },
    });
  },

  // ---------- 高级选项 ----------
  resetDefaults() {
    wx.showModal({
      title: '恢复默认',
      content: '确定要恢复所有设置为默认值吗？',
      confirmText: '恢复',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        await StorageService.resetSettings();
        this.refresh();
        wx.showToast({ title: '已恢复', icon: 'none' });
      },
    });
  },

  clearAll() {
    wx.showModal({
      title: '确认清除',
      content: '确定要清除所有数据吗？此操作无法撤销。',
      confirmText: '清除',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        await StorageService.clearAllData();
        this.setData({ settings: { ...DEFAULT_SETTINGS } });
        wx.showToast({ title: '已清除', icon: 'none' });
      },
    });
  },
});
