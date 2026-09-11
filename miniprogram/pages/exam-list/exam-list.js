import { callCloud } from '../../services/cloud';

Page({
  data: { loading: true, list: [] },

  onLoad() { this.load(); },

  async load() {
    try {
      const res = await callCloud('content', { action: 'examList' });
      this.setData({ list: (res.list || []).sort((a, b) => b.year - a.year) });
    } catch {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  go(e) {
    wx.navigateTo({ url: `/pages/exam-practice/exam-practice?id=${e.currentTarget.dataset.id}` });
  },
});
