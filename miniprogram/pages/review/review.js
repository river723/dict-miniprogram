import { getDueReviewWords, getTodayNewWords, recordStudyResult } from '../../services/studyPlan';
import { callCloud } from '../../services/cloud';
import { applyTheme } from '../../utils/theme';

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    mode: 'review', // review | new
    queue: [],
    index: 0,
    current: null,
    revealed: false,
    finished: false,
    knownCount: 0,
    unknownCount: 0,
    analysis: null,
    analyzing: false,
  },

  onLoad(options) {
    const queue = options.mode === 'new' ? getTodayNewWords() : getDueReviewWords();
    this.setData({
      mode: options.mode || 'review',
      queue,
      index: 0,
      current: queue[0] || null,
      finished: queue.length === 0,
    });
  },

  onToggleReveal() {
    this.setData({ revealed: !this.data.revealed });
  },

  async answer(e) {
    const known = e.currentTarget.dataset.known === '1';
    const { current, queue, index } = this.data;
    if (!current) return;
    await recordStudyResult(current, known ? 1 : 0, 'flashcard');
    this.setData({
      knownCount: this.data.knownCount + (known ? 1 : 0),
      unknownCount: this.data.unknownCount + (known ? 0 : 1),
    });
    this.next();
  },

  next() {
    const { queue, index } = this.data;
    const nextIdx = index + 1;
    if (nextIdx >= queue.length) {
      this.setData({ finished: true, current: null });
    } else {
      this.setData({ index: nextIdx, current: queue[nextIdx], revealed: false, analysis: null });
    }
  },

  /** AI 解析（DeepSeek 云函数代理）：翻译、熟词僻义、记忆技巧。 */
  async analyze() {
    const { current, analysis } = this.data;
    if (!current || analysis || this.data.analyzing) return;
    this.setData({ analyzing: true });
    try {
      const res = await callCloud('ai', { action: 'analyze', word: current.word });
      let parsed = null;
      try {
        parsed = JSON.parse(res.content.replace(/```json|```/g, '').trim());
      } catch { parsed = { raw: res.content }; }
      this.setData({ analysis: parsed });
    } catch (e) {
      wx.showToast({ title: 'AI 解析失败', icon: 'none' });
    } finally {
      this.setData({ analyzing: false });
    }
  },

  goBackHome() { wx.navigateBack(); },
});
