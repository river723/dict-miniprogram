/**
 * 练习历史 —— 对齐 memo-grad ExamHistoryScreen。
 * 平铺 AI 出题作答记录（重做/复习各占一行），支持删除单条、重做。
 *
 * 平台说明：重做不复用 navigation 参数，而是把该行题目写成练习草稿再进答题页。
 */
import StorageService from '../../services/storage';
import { accuracyLevel } from '../../services/exam';
import { applyTheme } from '../../utils/theme';

const AI_TYPE_LABEL = { definition: '释义单选', cloze: '完形选词' };

const parseTime = (v) => new Date(String(v || '').replace(/-/g, '/')).getTime() || 0;

Page({
  data: {
    items: [],
  },

  onShow() {
    applyTheme(this);
    this.load();
  },

  load() {
    this.ai = StorageService.getExamSessions().slice();
    this.applyFilter();
  },

  buildItem({ id }) {
    const s = (this.ai || []).find((x) => x.id === id);
    const createdAt = s.created_at;
    const total = (s.questions || []).length;
    const correct = (s.answers || []).filter((a) => a.is_correct).length;
    const label = (s.source === 'wrong_review' ? '错题复习·' : '') + (AI_TYPE_LABEL[s.question_type] || '练习');
    const accuracy = total > 0 ? correct / total : 0;
    return {
      key: `ai-${id}`,
      kind: 'ai',
      id,
      label,
      dateText: this.formatDate(createdAt),
      detailText: `${label} · ${total} 题 · 上次答对 ${correct} 题`,
      accuracyText: `${Math.round(accuracy * 100)}%`,
      accuracyCls: accuracyLevel(accuracy),
      scoreText: `${correct}/${total}`,
      isAi: true,
    };
  },

  formatDate(v) {
    const d = new Date(String(v || '').replace(/-/g, '/'));
    if (Number.isNaN(d.getTime())) return '未知时间';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  },

  applyFilter() {
    const all = (this.ai || []).map((s) => ({ id: s.id, createdAt: s.created_at }));
    all.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
    this.setData({ items: all.map((it) => this.buildItem(it)) });
  },

  // ---------- 行操作 ----------
  onRowTap(e) {
    this.redoAi(e.currentTarget.dataset.id);
  },

  /** 重做该行题目：写草稿后进答题页（origin_id 指回所属套题，新记录仍归同套）。 */
  redoAi(id) {
    const s = (this.ai || []).find((x) => x.id === id);
    if (!s || !(s.questions || []).length) return;
    StorageService.saveExamDraft({
      questions: s.questions,
      answers: [],
      questionType: s.question_type || 'definition',
      currentIndex: 0,
      createdAt: new Date().toISOString(),
      source: s.source || 'generation',
      origin_id: s.origin_id || null,
      version: 1,
    });
    wx.navigateTo({ url: '/pages/exam-answer/exam-answer' });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '确定要删除这条练习记录吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const done = () => { this.load(); wx.showToast({ title: '已删除', icon: 'none' }); };
        StorageService.deleteExamSession(id).then(done);
      },
    });
  },

  // ---------- 空态 / 底部跳转 ----------
  goSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
});
