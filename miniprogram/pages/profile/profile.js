import StorageService from '../../services/storage';
import { getMasteryStats } from '../../services/studyPlan';

Page({
  data: { stats: null },

  onShow() {
    this.setData({ stats: getMasteryStats() });
  },

  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },

  async syncNow() {
    wx.showLoading({ title: '同步中' });
    try {
      await StorageService.flushDirty();
      await StorageService.pullAll();
      wx.showToast({ title: '已同步', icon: 'success' });
      this.onShow();
    } catch {
      wx.showToast({ title: '同步失败', icon: 'none' });
    }
  },
});
