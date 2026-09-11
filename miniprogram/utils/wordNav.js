/**
 * 目标词跳转 —— 复习类页面（错题本 / 套题详情 / 练习结果）点词时的统一入口。
 * 对齐 App 的 WordDictModal 语义：优先生词详情；词不在生词本（或已软删）
 * 则回落到全局词库条目；两者都拿不到才提示。
 */
import StorageService from '../services/storage';

export function openWordDetail(wordId, wordText) {
  const id = wordId ? String(wordId) : '';
  if (id && StorageService.getWordById(id)) {
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${id}` });
    return true;
  }
  if (wordText) {
    wx.navigateTo({
      url: `/pages/dictionary-word-detail/dictionary-word-detail?word=${encodeURIComponent(wordText)}`,
    });
    return true;
  }
  wx.showToast({ title: '该词已不在生词本', icon: 'none' });
  return false;
}
