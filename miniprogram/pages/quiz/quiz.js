import StorageService from '../../services/storage';
import { callCloud } from '../../services/cloud';
import { EXAM_CONFIG } from '../../theme/tokens';

Page({
  data: {
    generating: false,
    questions: [],
    index: 0,
    selected: null,
    correctCount: 0,
    wrongWords: [],
    finished: false,
  },

  onLoad() {
    const words = StorageService.getWords().slice(0, 20).map((w) => w.word);
    if (words.length < 4) {
      wx.showToast({ title: '生词本至少需要 4 个词', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.generate(words);
  },

  async generate(words) {
    this.setData({ generating: true });
    try {
      const res = await callCloud('ai', {
        action: 'quiz',
        words,
        count: EXAM_CONFIG.DEFAULT_QUESTION_COUNT,
      });
      let qs;
      try {
        qs = JSON.parse(res.content.replace(/```json|```/g, '').trim());
      } catch { throw new Error('题目解析失败'); }
      this.setData({ questions: qs, index: 0, selected: null, correctCount: 0, wrongWords: [], finished: false });
    } catch (e) {
      wx.showToast({ title: e.message || '出题失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    } finally {
      this.setData({ generating: false });
    }
  },

  select(e) {
    if (this.data.selected !== null) return;
    const idx = e.currentTarget.dataset.idx;
    const q = this.data.questions[this.data.index];
    const correct = idx === q.answer;
    const patch = { selected: idx };
    if (correct) {
      patch.correctCount = this.data.correctCount + 1;
    } else {
      patch.wrongWords = [...this.data.wrongWords, q.word];
      StorageService.recordWrongAnswer(q.word, q.question);
    }
    this.setData(patch);
    setTimeout(() => this.next(), EXAM_CONFIG.AUTO_ADVANCE_DELAY);
  },

  next() {
    const nextIdx = this.data.index + 1;
    if (nextIdx >= this.data.questions.length) {
      this.setData({ finished: true });
    } else {
      this.setData({ index: nextIdx, selected: null });
    }
  },
});
