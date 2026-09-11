import { callCloud } from '../../services/cloud';

const SECTION_LABELS = [
  ['reading', '阅读理解'],
  ['cloze', '完形填空'],
  ['newType', '新题型'],
  ['translation', '翻译'],
  ['writing', '写作'],
];

Page({
  data: { loading: true, exam: null, sections: [], openSection: 'reading' },

  onLoad(options) {
    this.load(options.id);
  },

  async load(id) {
    try {
      const res = await callCloud('content', { action: 'examDetail', id });
      const exam = res.exam || {};
      const sections = SECTION_LABELS
        .filter(([k]) => Array.isArray(exam[k]) && exam[k].length > 0)
        .map(([key, label]) => ({ key, label, items: exam[key] }));
      this.setData({ exam, sections, openSection: sections[0]?.key || '' });
    } catch {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggle(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ openSection: this.data.openSection === key ? '' : key });
  },
});
