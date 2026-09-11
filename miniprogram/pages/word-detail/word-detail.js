/**
 * 生词详情 —— 对齐 memo-grad WordDetailScreen。
 * 区块：单词头（音标 + 发音）→ 释义 → 词根词缀 → 记忆口诀 → 易混词 → 补全/删除 → 返回。
 * 「补全」优先本地词库命中，未命中再走 ai 云函数 analyze。
 */
import StorageService from '../../services/storage';
import { callCloud } from '../../services/cloud';

function level(d) {
  return Math.max(1, Math.min(5, d || 1));
}

Page({
  data: {
    word: null,
    stars: '',
    squares: '',
    diffColor: '#3F7A5C',
    soundEnabled: true,
    enhancing: false,
    canEnhance: false,
    analyzing: false,
    showDelete: false,
    analysis: null,
    showAnalysis: false,
  },

  onLoad(options) {
    this.id = options && options.id;
    this.load();
  },

  onShow() {
    this.load();
  },

  load() {
    const word = StorageService.getWords().find((w) => String(w.id) === String(this.id));
    const settings = StorageService.getSettings();
    if (!word) {
      this.setData({ word: null });
      return;
    }
    const lv = level(word.difficulty);
    const colors = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];
    const defs = word.definitions || [];
    const freq = Math.max(0, Math.min(5, word.frequency || 0));
    this.setData({
      word,
      stars: '★'.repeat(lv) + '☆'.repeat(5 - lv),
      squares: '■'.repeat(freq) + '□'.repeat(5 - freq),
      diffColor: colors[lv - 1],
      soundEnabled: settings.soundEnabled !== false,
      canEnhance: !word.etymology || defs.length === 0 || !(word.definitions || []).some((d) => d.example),
    });
  },

  playAudio() {
    const w = this.data.word;
    if (!w || !this.data.soundEnabled) return;
    try {
      const ctx = wx.createInnerAudioContext();
      ctx.src = `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(w.word)}`;
      ctx.onError(() => wx.showToast({ title: '发音播放失败', icon: 'none' }));
      ctx.play();
    } catch (e) {
      wx.showToast({ title: '当前环境不支持发音', icon: 'none' });
    }
  },

  /** 补全词根 / 例句：ai 云函数 analyze。 */
  async enhance() {
    const w = this.data.word;
    if (!w || this.data.enhancing) return;
    this.setData({ enhancing: true });
    try {
      const res = await callCloud('ai', { action: 'analyze', word: w.word });
      let parsed = null;
      try {
        parsed = JSON.parse(String(res.content).replace(/```json|```/g, '').trim());
      } catch (e) {
        parsed = null;
      }
      if (!parsed) {
        wx.showToast({ title: 'AI 返回格式无法解析', icon: 'none' });
        return;
      }
      const patch = {};
      if (parsed.root_analysis) patch.etymology = parsed.root_analysis;
      if (parsed.memory_tip) patch.memory_tip = parsed.memory_tip;
      if (Array.isArray(parsed.definitions) && parsed.definitions.length > 0) {
        patch.definitions = parsed.definitions.map((d) => ({
          part_of_speech: d.pos || 'n.',
          meaning: d.meaning || '',
          example: d.example || '',
          is_core: !!d.is_core,
          is_rare_sense: !!d.is_rare_sense,
        }));
      }
      if (parsed.obscure_meanings && parsed.obscure_meanings.length > 0) {
        const extra = parsed.obscure_meanings.map((o) => ({
          part_of_speech: '僻义',
          meaning: o.obscure || '',
          example: o.example || '',
          is_rare_sense: true,
        }));
        patch.definitions = (patch.definitions || this.data.word.definitions || []).concat(extra);
      }
      await StorageService.updateWord(w.id, patch);
      this.setData({ enhancing: false });
      this.load();
      wx.showToast({ title: '已补全', icon: 'success' });
    } catch (e) {
      console.error('[word-detail] 补全失败', e);
      this.setData({ enhancing: false });
      wx.showToast({ title: 'AI 补全失败，请检查网络', icon: 'none' });
    }
  },

  askDelete() {
    this.setData({ showDelete: true });
  },

  cancelDelete() {
    this.setData({ showDelete: false });
  },

  async confirmDelete() {
    const w = this.data.word;
    if (!w) return;
    await StorageService.deleteWord(w.id);
    this.setData({ showDelete: false });
    wx.showToast({ title: '已删除', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  /** AI 解析（老页面的能力保留）：展示熟词僻义/记忆技巧。 */
  async analyze() {
    const w = this.data.word;
    if (!w || this.data.analyzing) return;
    this.setData({ analyzing: true });
    try {
      const res = await callCloud('ai', { action: 'analyze', word: w.word });
      let parsed;
      try {
        parsed = JSON.parse(String(res.content).replace(/```json|```/g, '').trim());
      } catch (e) {
        parsed = null;
      }
      this.setData({ analyzing: false, analysis: parsed || { definitions: [] }, showAnalysis: true });
    } catch (e) {
      this.setData({ analyzing: false });
      wx.showToast({ title: 'AI 解析失败', icon: 'none' });
    }
  },

  closeAnalysis() {
    this.setData({ showAnalysis: false });
  },
});
