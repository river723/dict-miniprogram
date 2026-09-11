import StorageService from '../../services/storage';

Page({
  data: { list: [], wordsById: {} },

  onShow() { this.refresh(); },

  refresh() {
    const list = StorageService.getWrongQuestions().filter((w) => !w.mastered);
    const words = StorageService.getWords();
    const map = {};
    for (const w of words) map[w.id] = w;
    // 错题按 word（quiz 记的是词文本）或 word_id 匹配
    const byText = {};
    for (const w of words) byText[w.word] = w;
    const enriched = list.map((wq) => ({
      ...wq,
      wordText: (byText[wq.word_id] || {}).word || wq.word_id,
      definition: ((byText[wq.word_id] || {}).definitions || [])[0]?.meaning || '',
    }));
    this.setData({ list: enriched });
  },

  /** 重做：做对 3 次自动移出。 */
  async markCorrect(e) {
    const wq = this.data.list[e.currentTarget.dataset.idx];
    await StorageService.addStudyRecord({ word_id: wq.word_id, result: 1, study_mode: 'quiz' });
    const mastered = await StorageService.recordWrongCorrect(wq.word_id);
    wx.showToast({ title: mastered ? '已掌握，移出错题本' : `做对 ${wq.mastery_count + 1}/3`, icon: 'none' });
    this.refresh();
  },
});
