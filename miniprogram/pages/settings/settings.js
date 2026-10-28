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
