/**
 * 错题本 —— 对齐 memo-grad WrongQuestionReviewScreen。
 * 两个 Tab：单词错题（AI 出题做错的题，可按题型/错误次数筛选后重做）
 *           真题错题（阅读/完形/新题型做错的题，可回原卷重做 + AI 解析）。
 *
 * 掌握规则：同一题答对 WRONG_QUESTION_MASTERY_THRESHOLD(3) 次自动移出。
 * 平台说明：App 用 navigation 传 questions；小程序把选中的错题写成练习草稿
 * （source='wrong_review'）再进答题页，避免 URL 传对象。
 */
import StorageService from '../../services/storage';
import { wrongToQuestion } from '../../services/exam';
import { generateRealExamExplanation, LETTERS, SUBTYPE_LABEL } from '../../services/realExam';
import { WRONG_QUESTION_MASTERY_THRESHOLD } from '../../constants/index';
import { openWordDetail } from '../../utils/wordNav';
import { applyTheme } from '../../utils/theme';

const MODE_LABEL = { reading: '阅读', cloze: '完形', newtype: '新题型' };

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
    tab: 'word',
    typeFilters: TYPE_FILTERS,
    countFilters: COUNT_FILTERS,
    typeFilter: 'all',
    wrongCountFilter: 'all',

    wordTotal: 0,
    wordDef: 0,
    wordCloze: 0,
    realTotal: 0,
    realReading: 0,
    realCloze: 0,

    filtered: [],
    realList: [],
  },

  onShow() {

    applyTheme(this);
    this.loadAll();
  },

  loadAll() {
    const raw = StorageService.getWrongQuestions().slice();
    raw.sort((a, b) => parseTime(b.last_attempt_at) - parseTime(a.last_attempt_at));
    this.raw = raw;

    const real = StorageService.getRealExamWrongQuestions().slice();
    real.sort((a, b) => parseTime(b.last_attempt_at) - parseTime(a.last_attempt_at));

    this.setData({
      wordTotal: raw.length,
      wordDef: raw.filter((w) => (w.type || 'definition') === 'definition').length,
      wordCloze: raw.filter((w) => w.type === 'cloze').length,
      realTotal: real.length,
      realReading: real.filter((w) => w.mode === 'reading').length,
      realCloze: real.filter((w) => w.mode === 'cloze').length,
      realList: real.map((w) => this.buildRealItem(w)),
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

  /** 真题错题卡片渲染数据（选项带正确/已选标记）。 */
  buildRealItem(wq) {
    const options = (wq.options || []).map((text, i) => {
      const letter = LETTERS[i] || String(i + 1);
      return {
        letter,
        text,
        isCorrect: letter === wq.correctAnswer,
        isSelected: letter === wq.userAnswer,
      };
    });
    const isReading = wq.mode === 'reading';
    const isNewType = wq.mode === 'newtype';
    return {
      id: wq.id,
      questionId: wq.questionId,
      mode: wq.mode,
      modeLabel: MODE_LABEL[wq.mode] || '真题',
      tagCls: isReading ? 'primary' : 'accent',
      metaText: `${wq.year} · ${wq.setId === 'english2' ? '英语二' : '英语一'}`
        + (isNewType && wq.subtype ? ` · ${SUBTYPE_LABEL[wq.subtype] || ''}` : '')
        + (wq.blankIndex != null ? ` · [${wq.blankIndex}]` : ''),
      stem: wq.stem || '',
      options,
      correctAnswer: wq.correctAnswer,
      userAnswer: wq.userAnswer,
      explanation: wq.explanation || '',
      wrongCount: wq.wrong_count || 0,
      correctCount: wq.correct_count || 0,
      hasCorrect: (wq.correct_count || 0) > 0,
      explaining: false,
    };
  },

  // ---------- 筛选 ----------
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
  },

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

  // ---------- 真题错题 ----------
  /** 回原卷重做：带着 year/setId/paperId 进真题答题壳（由 exam-practice 承接）。 */
  openPaper(e) {
    const id = e.currentTarget.dataset.id;
    const wq = StorageService.getRealExamWrongQuestions().find((x) => x.id === id);
    if (!wq) return;
    wx.navigateTo({
      url: `/pages/exam-practice/exam-practice?mode=${wq.mode}&year=${wq.year}`
        + `&setId=${wq.setId || 'english1'}&paperId=${wq.paperId}`,
    });
  },

  removeReal(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '移出错题本',
      content: '确定要把这道真题错题移出错题本吗？',
      confirmText: '移出',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        StorageService.removeRealExamWrongQuestion(id);
        this.loadAll();
        wx.showToast({ title: '已移出', icon: 'none' });
      },
    });
  },

  /** AI 解析：生成后回写快照并就地展示。 */
  async explainReal(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.realList.slice();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0 || list[idx].explaining) return;

    const raw = StorageService.getRealExamWrongQuestions().find((x) => x.id === id);
    if (!raw) return;

    list[idx] = { ...list[idx], explaining: true };
    this.setData({ realList: list });

    try {
      const explanation = await generateRealExamExplanation(raw);
      if (!explanation) throw new Error('解析为空');
      StorageService.updateRealExamWrongExplanation(raw.questionId, explanation);

      const next = this.data.realList.slice();
      const i = next.findIndex((x) => x.id === id);
      if (i >= 0) next[i] = { ...next[i], explanation, explaining: false };
      this.setData({ realList: next });
    } catch (err) {
      console.error('[wrong-questions] AI 解析失败', err);
      const next = this.data.realList.slice();
      const i = next.findIndex((x) => x.id === id);
      if (i >= 0) next[i] = { ...next[i], explaining: false };
      this.setData({ realList: next });
      wx.showToast({ title: '解析生成失败，请重试', icon: 'none' });
    }
  },

  // ---------- 空态跳转 ----------
  goSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
  goRealList() { wx.navigateTo({ url: '/pages/exam-list/exam-list' }); },
});
