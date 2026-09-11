import StorageService from '../../services/storage';
import { callCloud } from '../../services/cloud';

Page({
  data: { word: null, analysis: null, analyzing: false },

  onLoad(options) {
    const word = StorageService.getWords().find((w) => w.id === options.id);
    this.setData({ word });
  },

  async analyze() {
    if (this.data.analyzing) return;
    this.setData({ analyzing: true });
    try {
      const res = await callCloud('ai', { action: 'analyze', word: this.data.word.word });
      let parsed;
      try { parsed = JSON.parse(res.content.replace(/```json|```/g, '').trim()); }
      catch { parsed = { raw: res.content }; }
      this.setData({ analysis: parsed });
    } catch {
      wx.showToast({ title: 'AI 解析失败', icon: 'none' });
    } finally {
      this.setData({ analyzing: false });
    }
  },

  async remove() {
    const confirm = await new Promise((r) =>
      wx.showModal({ title: '删除单词', content: `确定从生词本删除「${this.data.word.word}」吗？`, success: (res) => r(res.confirm) })
    );
    if (!confirm) return;
    await StorageService.deleteWord(this.data.word.id);
    wx.showToast({ title: '已删除', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },
});
