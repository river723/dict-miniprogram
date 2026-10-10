/**
 * 错题本 —— 对齐 memo-grad WrongQuestionReviewScreen。
 * 单词错题（AI 出题做错的题，可按题型/错误次数筛选后重做）。
 *
 * 掌握规则：同一题答对 WRONG_QUESTION_MASTERY_THRESHOLD(3) 次自动移出。
 * 平台说明：App 用 navigation 传 questions；小程序把选中的错题写成练习草稿
 * （source='wrong_review'）再进答题页，避免 URL 传对象。
 */
import StorageService from '../../services/storage';
import { wrongToQuestion } from '../../services/exam';
import { WRONG_QUESTION_MASTERY_THRESHOLD } from '../../constants/index';
import { applyTheme } from '../../utils/theme';

const parseTime = (v) => new Date(String(v || '').replace(/-/g, '/')).getTime() || 0;

const TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'definition', label: '释义' },
  { key: 'cloze', label: '完形' },
];

const COUNT_FILTERS = [
  { key: 'all', label: '不限' },
  { key: 'ge2', label: '错≥2' },
  { key: 'ge3', label: '错≥3' },
];

Page({
  data: {
    threshold: WRONG_QUESTION_MASTERY_THRESHOLD,
    typeFilters: TYPE_FILTERS,
    countFilters: COUNT_FILTERS,
    typeFilter: 'all',
    wrongCountFilter: 'all',

    wordTotal: 0,
    wordDef: 0,
    wordCloze: 0,

    filtered: [],
  },

  onShow() {
    applyTheme(this);
    this.loadAll();
  },

  loadAll() {
    const raw = StorageService.getWrongQuestions().slice();
    raw.sort((a, b) => parseTime(b.last_attempt_at) - parseTime(a.last_attempt_at));
    this.raw = raw;

    this.setData({
      wordTotal: raw.length,
      wordDef: raw.filter((w) => (w.type || 'definition') === 'definition').length,
      wordCloze: raw.filter((w) => w.type === 'cloze').length,
    });
    this.applyFilters();
  },

  applyFilters() {
    const { typeFilter, wrongCountFilter } = this.data;
    const list = (this.raw || []).filter((wq) => {
      const type = wq.type || 'definition';
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      if (wrongCountFilter === 'ge2' && (wq.wrong_count || 0) < 2) return false;
      if (wrongCountFilter === 'ge3' && (wq.wrong_count || 0) < 3) return false;
      return true;
    });
    this.setData({ filtered: list.map((wq) => this.buildWordItem(wq)) });
  },

  /** 单词错题卡片渲染数据。 */
  buildWordItem(wq) {
    const isDefinition = (wq.type || 'definition') === 'definition';
    return {
      id: wq.id,
      type: wq.type || 'definition',
      isDefinition,
      typeLabel: isDefinition ? '释义单选' : '完形选词',
      wrongCount: wq.wrong_count || 0,
      correctCount: wq.correct_count || 0,
      hasCorrect: (wq.correct_count || 0) > 0,
      wordId: wq.word_id || '',
      word: wq.word || wq.target_word || '',
      sentence: isDefinition
        ? String(wq.sentence || '').replace(/\*/g, '')
        : String(wq.sentence || '').replace(/\[BLANK\]/g, '______'),
      translation: wq.chinese_translation || '',
      hint: wq.chinese_hint || '',
      correct: wq.correct_answer || '',
      wrongAnswer: wq.wrong_answer || '（未作答）',
    };
  },

  // ---------- 筛选 ----------
  setTypeFilter(e) {
    const typeFilter = e.currentTarget.dataset.key;
    if (typeFilter === this.data.typeFilter) return;
    this.setData({ typeFilter });
    this.applyFilters();
  },

  setCountFilter(e) {
    const wrongCountFilter = e.currentTarget.dataset.key;
    if (wrongCountFilter === this.data.wrongCountFilter) return;
    this.setData({ wrongCountFilter });
    this.applyFilters();
  },

  // ---------- 单词错题 ----------
  /** 把筛选后的错题写成练习草稿，进答题页重做（来源标记为错题复习）。 */
  startReview() {
    const questions = (this.data.filtered || []).map((item) => {
      const raw = (this.raw || []).find((w) => w.id === item.id);
      return raw ? wrongToQuestion(raw) : null;
    }).filter(Boolean);
    if (!questions.length) return;

    StorageService.saveExamDraft({
      questions,
      answers: [],
      questionType: questions[0].type || 'definition',
      currentIndex: 0,
      createdAt: new Date().toISOString(),
      source: 'wrong_review',
      origin_id: null,
      version: 1,
    });
    wx.navigateTo({ url: '/pages/exam-answer/exam-answer' });
  },

  /** 点击目标词 → 生词详情。 */
  openWord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '该词已不在生词本', icon: 'none' });
      return;
    }
    if (!StorageService.getWordById(id)) {
      wx.showToast({ title: '该词已不在生词本', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${id}` });
  },

  // ---------- 空态跳转 ----------
  goSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
});
