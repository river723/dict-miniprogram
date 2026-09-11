import StorageService from '../../services/storage';
import { searchWorddict } from '../../services/worddict';
import { WORDS_PER_PAGE } from '../../theme/tokens';

Page({
  data: {
    tab: 'mine', // mine | dict
    myWords: [],
    dictWords: [],
    keyword: '',
    page: 1,
    hasMore: false,
    searching: false,
  },

  onShow() {
    this.setData({ myWords: StorageService.getWords() });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); },

  async searchDict() {
    const kw = this.data.keyword.trim().toLowerCase();
    if (!kw) return;
    this.setData({ searching: true, dictWords: [], page: 1 });
    try {
      const res = await searchWorddict({ prefix: kw[0], keyword: kw });
      const kwRe = new RegExp(`^${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const words = (res.words || []).filter((w) => kwRe.test(w.word));
      this.setData({ dictWords: words });
      if (res.truncated) {
        wx.showToast({ title: '结果过多，已截断', icon: 'none' });
      } else if (words.length === 0) {
        wx.showToast({ title: '词库中未找到', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '查询失败', icon: 'none' });
    } finally {
      this.setData({ searching: false });
    }
  },

  /** 从词库添加到生词本（幂等：已存在则提示）。 */
  async addFromDict(e) {
    const entry = this.data.dictWords[e.currentTarget.dataset.idx];
    const exists = StorageService.getWordbookKeysIncludingDeleted().has(entry.word.toLowerCase());
    if (exists) {
      wx.showToast({ title: '已在生词本', icon: 'none' });
      return;
    }
    await StorageService.addWord(entry);
    this.setData({ myWords: StorageService.getWords() });
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  inWordbook(e) {
    const entry = this.data.dictWords[e.currentTarget.dataset.idx];
    return StorageService.getWordbookKeysIncludingDeleted().has(entry.word.toLowerCase());
  },

  goDetail(e) {
    const w = this.data.myWords[e.currentTarget.dataset.idx];
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${w.id}` });
  },
});
