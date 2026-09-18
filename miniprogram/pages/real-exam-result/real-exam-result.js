/**
 * 真题结果页 —— 对齐 memo-grad RealExamResultScreen。
 *
 * 进入方式：
 *   答题页提交后  ?sessionId=xxx
 *   练习历史回顾  ?sessionId=xxx&archived=1（只读，不重复写错题本）
 *
 * 会话已在提交时落盘（RealExamSession）并同步过真题错题本，这里只负责：
 * 得分卡 → 原文 & 译文对照 → 逐题回顾 → 返回列表 / 再练一次。
 *
 * 支持 reading / cloze；newtype 在 App 里是原地揭晓，没有独立结果页，
 * 这里给一个提示并引导回真题列表。
 */
import StorageService from '../../services/storage';
import { getExamSet, findPaper, stripLetterPrefix } from '../../services/realExam';
import { applyTheme } from '../../utils/theme';

const SET_CODE = { english1: 'e1', english2: 'e2' };
const LETTERS = ['A', 'B', 'C', 'D'];

const MODE_LABEL = {
  reading: '阅读理解',
  cloze: '完形填空',
  newtype: '新题型',
};

const BILINGUAL_TITLE = {
  reading: '文章原文 & 中文译文',
  cloze: '完形原文 & 中文译文',
};

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    loading: true,
    missing: false,
    archived: false,
    unsupported: false,

    title: '',
    score: 0,
    total: 0,
    percent: 0,
    scoreCls: 'ok',

    hasBilingual: false,
    bilingualTitle: '',
    bilingualOpen: true,
    paragraphs: [],

    items: [],
  },

  onLoad(options) {
    this.sessionId = options.sessionId || '';
    this.archived = options.archived === '1';
    this.setData({ archived: this.archived });
    this.load();
  },

  async load() {
    const session = StorageService.getRealExamSessions().find((s) => s.id === this.sessionId);
    if (!session) {
      this.setData({ loading: false, missing: true });
      return;
    }
    this.session = session;

    if (session.mode === 'newtype') {
      this.setData({
        loading: false,
        unsupported: true,
        title: `${session.year} · 新题型`,
        score: session.score || 0,
        total: session.total || 0,
        percent: Math.round(((session.score || 0) / (session.total || 1)) * 100),
      });
      return;
    }

    let paper = null;
    try {
      const set = await getExamSet(session.year, session.setId || 'english1');
      paper = findPaper(set, session.mode, session.paperId);
    } catch (err) {
      console.warn('[real-exam-result] 拉取原文失败：', err);
    }

    const percent = session.total > 0 ? Math.round((session.score / session.total) * 100) : 0;
    this.setData({
      loading: false,
      missing: false,
      title: `${session.year} · ${MODE_LABEL[session.mode] || '真题'}`,
      score: session.score || 0,
      total: session.total || 0,
      percent,
      scoreCls: percent >= 60 ? 'ok' : 'no',
      ...this.buildReview(paper, session),
      ...this.buildBilingual(paper, session),
    });
  },

  /** 原文 + 译文对照卡。 */
  buildBilingual(paper, session) {
    const list = (paper && paper.paragraphs) || [];
    if (list.length === 0) return { hasBilingual: false, paragraphs: [] };
    return {
      hasBilingual: true,
      bilingualTitle: `${BILINGUAL_TITLE[session.mode] || '原文 & 译文'}（${list.length} 段）`,
      bilingualOpen: true,
      paragraphs: list.map((p, i) => ({ no: `§${i + 1}`, en: p.en || '', zh: p.zh || '' })),
    };
  },

  /** 逐题回顾。 */
  buildReview(paper, session) {
    if (!paper) return { items: [] };
    const ansOf = (qid) => (session.answers || []).find((a) => a.questionId === qid) || null;

    if (session.mode === 'reading') {
      const items = (paper.questions || []).map((q, i) => {
        const a = ansOf(q.id) || {};
        return {
          label: `Q${i + 1}`,
          stem: q.stem || '',
          state: !a.selected ? 'skip' : a.correct ? 'ok' : 'no',
          explanation: q.explanation || '',
          opts: (q.options || []).map((o, oi) => ({
            letter: LETTERS[oi],
            text: stripLetterPrefix(o, LETTERS[oi]),
            isCorrect: LETTERS[oi] === q.answer,
            isSelected: LETTERS[oi] === a.selected,
          })),
        };
      });
      return { items };
    }

    const items = (paper.blanks || []).map((b) => {
      const a = ansOf(`${paper.id}-b${b.index}`) || {};
      return {
        label: `[${b.index}]`,
        stem: '',
        state: !a.selected ? 'skip' : a.correct ? 'ok' : 'no',
        explanation: b.explanation || '',
        opts: (b.options || []).map((o, oi) => ({
          letter: LETTERS[oi],
          text: stripLetterPrefix(o, LETTERS[oi]),
          isCorrect: LETTERS[oi] === b.answer,
          isSelected: LETTERS[oi] === a.selected,
        })),
      };
    });
    return { items };
  },

  // ---------- 交互 ----------
  toggleBilingual() {
    this.setData({ bilingualOpen: !this.data.bilingualOpen });
  },

  again() {
    const s = this.session;
    if (!s) return;
    wx.redirectTo({
      url: `/pages/exam-practice/exam-practice?year=${s.year}&set=${SET_CODE[s.setId] || 'e1'}&mode=${s.mode}&pid=${s.paperId}`,
    });
  },

  backToList() {
    if (this.archived) {
      wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/exam-history/exam-history' }) });
      return;
    }
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/exam-list/exam-list' }) });
  },
});
