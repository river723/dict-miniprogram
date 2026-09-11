/**
 * 练习历史 —— 对齐 memo-grad ExamHistoryScreen。
 * 把 AI 出题与真题两类作答记录按时间倒序平铺（重做/复习各占一行），
 * 支持按来源筛选、删除单条、重做（AI）或查看回顾（真题）。
 *
 * 平台说明：重做不复用 navigation 参数，而是把该行题目写成练习草稿再进答题页；
 * 真题回顾跳到 real-exam-result 的归档模式（按 sessionId 复原）。
 */
import StorageService from '../../services/storage';
import { accuracyLevel } from '../../services/exam';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'ai', label: 'AI 出题' },
  { key: 'real', label: '真题' },
];

const REAL_MODE_LABEL = { reading: '阅读理解', cloze: '完形填空', newtype: '新题型' };
const AI_TYPE_LABEL = { definition: '释义单选', cloze: '完形选词' };

const parseTime = (v) => new Date(String(v || '').replace(/-/g, '/')).getTime() || 0;

Page({
  data: {
    filters: FILTERS,
    filter: 'all',
    items: [],
  },

  onShow() {
    this.load();
  },

  load() {
    this.ai = StorageService.getExamSessions().slice();
    this.real = StorageService.getRealExamSessions().slice();
    this.applyFilter();
  },

  buildItem({ kind, id }) {
    const isAi = kind === 'ai';
    let createdAt;
    let total;
    let correct;
    let label;

    if (isAi) {
      const s = (this.ai || []).find((x) => x.id === id);
      createdAt = s.created_at;
      total = (s.questions || []).length;
      correct = (s.answers || []).filter((a) => a.is_correct).length;
      label = (s.source === 'wrong_review' ? '错题复习·' : '') + (AI_TYPE_LABEL[s.question_type] || '练习');
    } else {
      const s = (this.real || []).find((x) => x.id === id);
      createdAt = s.createdAt;
      total = s.total || 0;
      correct = s.score || 0;
      label = `真题·${REAL_MODE_LABEL[s.mode] || ''} ${s.year || ''}`.replace(/\s+$/, '');
    }

    const accuracy = total > 0 ? correct / total : 0;
    return {
      key: `${kind}-${id}`,
      kind,
      id,
      label,
      dateText: this.formatDate(createdAt),
      detailText: `${label} · ${total} 题 · 上次答对 ${correct} 题`,
      accuracyText: `${Math.round(accuracy * 100)}%`,
      accuracyCls: accuracyLevel(accuracy),
      scoreText: `${correct}/${total}`,
      isAi,
    };
  },

  formatDate(v) {
    const d = new Date(String(v || '').replace(/-/g, '/'));
    if (Number.isNaN(d.getTime())) return '未知时间';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  },

  setFilter(e) {
    const filter = e.currentTarget.dataset.key;
    if (filter === this.data.filter) return;
    this.setData({ filter });
    this.applyFilter();
  },

  applyFilter() {
    const { filter } = this.data;
    const all = this.buildAll();
    this.setData({
      items: filter === 'all' ? all : all.filter((it) => it.kind === filter),
    });
  },

  /** 每次筛选都基于最新存储重建，避免筛选后丢失行。 */
  buildAll() {
    const merged = [
      ...(this.ai || []).map((s) => ({ kind: 'ai', id: s.id, createdAt: s.created_at })),
      ...(this.real || []).map((s) => ({ kind: 'real', id: s.id, createdAt: s.createdAt })),
    ];
    merged.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
    return merged.map((it) => this.buildItem(it));
  },

  // ---------- 行操作 ----------
  onRowTap(e) {
    const kind = e.currentTarget.dataset.kind;
    const id = e.currentTarget.dataset.id;
    if (kind === 'ai') this.redoAi(id);
    else this.viewReal(id);
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

  /** 查看真题归档回顾：新题型不支持逐题回顾，退回真题列表。 */
  viewReal(id) {
    const s = (this.real || []).find((x) => x.id === id);
    if (!s) return;
    if (s.mode === 'newtype') {
      wx.navigateTo({ url: '/pages/exam-list/exam-list' });
      return;
    }
    wx.navigateTo({ url: `/pages/real-exam-result/real-exam-result?sessionId=${id}&archived=1` });
  },

  onDelete(e) {
    const kind = e.currentTarget.dataset.kind;
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '确定要删除这条练习记录吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const done = () => { this.load(); wx.showToast({ title: '已删除', icon: 'none' }); };
        if (kind === 'ai') StorageService.deleteExamSession(id).then(done);
        else StorageService.deleteRealExamSession(id).then(done);
      },
    });
  },

  // ---------- 空态 / 底部跳转 ----------
  goSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
  goRealList() { wx.navigateTo({ url: '/pages/exam-list/exam-list' }); },
});
