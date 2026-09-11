/**
 * AI 题库 —— 对齐 memo-grad ExamSetBankScreen。
 * 把练习记录按「套题」聚合（同一套题由 origin_id 关联，重做各占一行但同属一套），
 * 每套显示题型 / 题数 / 出题日期 / 最近一次正确率，可进套题详情或整组删除。
 */
import StorageService from '../../services/storage';
import { buildExamSets, accuracyLevel } from '../../services/exam';
import { QUESTION_TYPE_LABEL } from '../../constants/index';

Page({
  data: {
    sets: [],
  },

  onShow() {
    this.load();
  },

  load() {
    const sessions = StorageService.getExamSessions();
    const sets = buildExamSets(sessions).map((s) => ({
      rootId: s.rootId,
      typeLabel: QUESTION_TYPE_LABEL[s.questionType] || '练习',
      type: s.questionType || 'definition',
      total: s.total,
      memberCount: s.members.length,
      createdText: this.formatDate(s.createdAt),
      lastText: this.formatDate(s.lastAt),
      accuracyText: `${Math.round((s.accuracy || 0) * 100)}%`,
      accuracyCls: accuracyLevel(s.accuracy || 0),
    }));
    this.setData({ sets });
  },

  formatDate(v) {
    const d = new Date(String(v || '').replace(/-/g, '/'));
    if (Number.isNaN(d.getTime())) return '未知';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  openSet(e) {
    const rootId = e.currentTarget.dataset.id;
    if (!rootId) return;
    wx.navigateTo({ url: `/pages/exam-set-detail/exam-set-detail?rootId=${rootId}` });
  },

  removeSet(e) {
    const rootId = e.currentTarget.dataset.id;
    const set = this.data.sets.find((s) => s.rootId === rootId);
    if (!set) return;
    wx.showModal({
      title: '删除套题',
      content: `确定要删除这套${set.typeLabel}吗？该套题的 ${set.memberCount} 次练习记录将一并移除。`,
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        StorageService.deleteExamSet(rootId).then(() => {
          this.load();
          wx.showToast({ title: '已删除', icon: 'none' });
        });
      },
    });
  },

  goSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
});
