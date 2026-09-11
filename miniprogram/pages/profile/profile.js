/**
 * 我的（Tab）—— 对齐 memo-grad StatsScreen（App 的「我的」Tab）。
 *
 * 结构：掌握度 Hero（墨绿卡 + 进度环）→ 查看完整统计 CTA → 三指标 →
 *      本地账号卡 → 应用设置预览（主题 / 每日新词 / 考题题数）→ 版本信息。
 *
 * 已剔除 App 的订阅与账号/后台相关内容：小程序版单机运行，
 * AI 能力统一由云端云函数提供，无需本地密钥或登录。
 */
import StorageService from '../../services/storage';
import { getMasteryStats, getWeeklyTrend } from '../../services/studyPlan';
import { THEME_LABELS } from '../../constants/index';
import { formatDate } from '../../utils/util';

const RING_ON = '#FFFFFF';
const RING_OFF = 'rgba(255,255,255,0.22)';

Page({
  data: {
    ready: false,
    masteryPercent: 0,
    ringTop: RING_OFF,
    ringRight: RING_OFF,
    ringBottom: RING_OFF,
    ringLeft: RING_OFF,
    metrics: [],
    previewRows: [],
    summaryText: '',
  },

  async onShow() {
    this.load();
  },

  load() {
    const mastery = getMasteryStats();
    const trend = getWeeklyTrend();
    const weeklyStudyCount = trend.reduce((s, d) => s + d.studyCount, 0);

    const todayStr = formatDate();
    const todayRecords = StorageService.getStudyRecordsByDate(todayStr) || [];
    const todayStudyCount = todayRecords.length;
    const todayCorrect = todayRecords.filter((r) => r.result === 1).length;
    const todayAccuracy = todayStudyCount > 0 ? Math.round((todayCorrect / todayStudyCount) * 100) : 0;

    const percent = mastery.totalWords > 0
      ? Math.round((mastery.masteredWords / mastery.totalWords) * 100)
      : 0;
    const p = percent / 100;

    const settings = StorageService.getSettings();

    this.setData({
      ready: true,
      masteryPercent: percent,
      ringTop: '#FFFFFF',
      ringRight: p > 0.25 ? RING_ON : RING_OFF,
      ringBottom: p > 0.5 ? RING_ON : RING_OFF,
      ringLeft: p > 0.75 ? RING_ON : RING_OFF,
      summaryText: `总词 ${mastery.totalWords} · 今日正确率 ${todayAccuracy}%`,
      metrics: [
        { value: mastery.totalWords, label: '总词数' },
        { value: mastery.masteredWords, label: '已掌握', tint: '#3F7A5C' },
        { value: weeklyStudyCount, label: '本周学习' },
      ],
      previewRows: [
        { icon: 'brightness-6', label: '主题', value: THEME_LABELS[settings.theme] || '浅色' },
        { icon: 'school', label: '每日新词', value: `${settings.dailyNewWords} 个` },
        { icon: 'format-list-numbered', label: '考题题数', value: `${settings.examQuestionCount} 题` },
      ],
    });
  },

  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
  goWrong() { wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' }); },
  goHistory() { wx.navigateTo({ url: '/pages/exam-history/exam-history' }); },

  async syncNow() {
    wx.showLoading({ title: '同步中' });
    try {
      await StorageService.flushDirty();
      await StorageService.pullAll();
      wx.hideLoading();
      wx.showToast({ title: '已同步', icon: 'success' });
      this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },
});
