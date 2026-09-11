import { callCloud } from '../../services/cloud';

Page({
  data: { loading: true, series: null, list: [] },

  onLoad() { this.load(); },

  async load() {
    try {
      const res = await callCloud('content', { action: 'storyList' });
      this.setData({ series: res.series, list: res.list || [] });
    } catch {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  go(e) {
    wx.navigateTo({ url: `/pages/story-read/story-read?id=${e.currentTarget.dataset.id}` });
  },
});
