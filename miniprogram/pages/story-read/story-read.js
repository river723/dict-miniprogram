import { callCloud } from '../../services/cloud';

Page({
  data: { loading: true, story: null, showTranslation: false },

  onLoad(options) { this.load(options.id); },

  async load(id) {
    try {
      const res = await callCloud('content', { action: 'storyDetail', id });
      this.setData({ story: res.story });
    } catch {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },
});
