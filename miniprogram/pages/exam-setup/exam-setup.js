/**
 * AI 出题配置页 —— 对齐 memo-grad ExamSetupScreen。
 * Hero（题型·题数 + 题数步进器）→ 选择题型（释义单选/完形选词）
 * → 选择生词（智能推荐 / 手动选择，词云带覆盖次数徽标）→ AI 出题按钮 + 生成中提示。
 *
 * 平台说明：
 * - App 用 navigation 传 questions 参数；小程序改为「写入练习草稿 → exam-answer 读草稿」，
 *   这样进入配置页时还能用同一份草稿做「继续未完成的练习」恢复。
 * - 订阅校验在 App 里做（isPro）；小程序跳过订阅，AI 直接走 ai 云函数。
 * - App 实际只有 4 项配置（题数/题型/选词模式/选词），无难度、无时长、无范围。
 */
import StorageService from '../../services/storage';
import {
  generateQuestions,
  getRecommendedWords,
  getWordArticleCoverage,
  getCoverageLabel,
  getCoverageLevel,
  buildWordStats,
} from '../../services/exam';
import { EXAM_CONFIG, QUESTION_TYPE_LABEL } from '../../constants/index';
import { applyTheme } from '../../utils/theme';

const TYPE_HINT = {
  definition: '给定含有生词的英文句子，选择正确的英文释义（AI 出题）',
  cloze: '给定含空白的句子，选择正确的单词填入（AI 出题）',
};

const TYPE_OPTIONS = [
  { value: 'definition', label: '释义单选' },
  { value: 'cloze', label: '完形选词' },
];

const MODE_OPTIONS = [
  { value: 'smart', label: '智能推荐' },
  { value: 'manual', label: '手动选择' },
];

/** 取核心释义（is_core 优先，否则第一条）。 */
const meaningOf = (w) => {
  const defs = (w && w.definitions) || [];
  const core = defs.find((d) => d.is_core);
  return (core && core.meaning) || (defs[0] && defs[0].meaning) || '';
};

Page({
  data: {
    empty: false,

    typeOptions: TYPE_OPTIONS,
    modeOptions: MODE_OPTIONS,

    questionType: 'definition',
    typeLabel: QUESTION_TYPE_LABEL.definition,
    typeHint: TYPE_HINT.definition,
    questionCount: EXAM_CONFIG.DEFAULT_QUESTION_COUNT,
    minCount: EXAM_CONFIG.MIN_QUESTION_COUNT,
    maxCount: EXAM_CONFIG.MAX_QUESTION_COUNT,

    selectMode: 'smart',
    selected: [],   // 智能推荐：已选词（含 covLabel / covLevel）
    manualList: [], // 手动：候选词（含 selected / covLabel / covLevel）
    searchQuery: '',

    canStart: false,
    generating: false,
    generatingHint: '',

    // 弹窗
    resumeVisible: false,
    resumeContent: '',
  },

  onShow() {

    applyTheme(this);
    // 首次进入才初始化（返回本页时保留用户已调整的选词）
    if (this.inited) return;
    this.inited = true;
    this.load(true);
    this.checkResumeDraft();
  },

  load(initSelection) {
    const settings = StorageService.getSettings();
    const words = StorageService.getWords();
    if (!words.length) {
      this.setData({ empty: true, selected: [], manualList: [], canStart: false });
      return;
    }

    this.words = words;
    this.coverage = getWordArticleCoverage();
    const stats = buildWordStats();
    this.acc = stats.acc;
    this.last = stats.last;

    const cfg = EXAM_CONFIG;
    const count = Math.max(cfg.MIN_QUESTION_COUNT, Math.min(cfg.MAX_QUESTION_COUNT,
      settings.examQuestionCount || cfg.DEFAULT_QUESTION_COUNT));

    const selected = (initSelection && this.data.selectMode === 'smart')
      ? this.decorate(getRecommendedWords(words, this.coverage, this.acc, count, this.last))
      : this.data.selected;

    this.setData({
      empty: false,
      questionCount: count,
      selected,
      canStart: selected.length >= count,
    });
    if (this.data.selectMode === 'manual') this.refreshManualList();
  },

  /** 给词对象挂上覆盖次数徽标（文案 + 语义色）。 */
  decorate(list) {
    const cov = this.coverage || {};
    return (list || []).map((w) => {
      const c = cov[w.id] || 0;
      return {
        id: w.id,
        word: w.word,
        meaning: meaningOf(w),
        covLabel: getCoverageLabel(c),
        covLevel: getCoverageLevel(c),
      };
    });
  },

  /** 手动模式的候选词列表（按搜索词过滤）。 */
  refreshManualList() {
    const q = String(this.data.searchQuery || '').trim().toLowerCase();
    const selectedIds = new Set((this.data.selected || []).map((w) => w.id));
    const cov = this.coverage || {};
    const list = (this.words || [])
      .filter((w) => !q || String(w.word).toLowerCase().indexOf(q) >= 0)
      .map((w) => {
        const c = cov[w.id] || 0;
        return {
          id: w.id,
          word: w.word,
          meaning: meaningOf(w),
          selected: selectedIds.has(w.id),
          covLabel: getCoverageLabel(c),
          covLevel: getCoverageLevel(c),
        };
      });
    this.setData({ manualList: list });
  },

  // ---------- 题数步进器 ----------
  decCount() { this.setCount(this.data.questionCount - 1); },
  incCount() { this.setCount(this.data.questionCount + 1); },

  setCount(n) {
    const cfg = EXAM_CONFIG;
    const next = Math.max(cfg.MIN_QUESTION_COUNT, Math.min(cfg.MAX_QUESTION_COUNT, n));
    if (next === this.data.questionCount) return;
    StorageService.saveSettings({ examQuestionCount: next });

    const patch = { questionCount: next };
    let selected = this.data.selected;
    if (this.data.selectMode === 'smart') {
      selected = this.decorate(
        getRecommendedWords(this.words, this.coverage, this.acc, next, this.last)
      );
      patch.selected = selected;
    }
    patch.canStart = selected.length >= next;
    this.setData(patch);
    if (this.data.selectMode === 'manual') this.refreshManualList();
  },

  // ---------- 题型 / 选词模式 ----------
  switchType(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.questionType) return;
    this.setData({
      questionType: type,
      typeLabel: QUESTION_TYPE_LABEL[type] || '',
      typeHint: TYPE_HINT[type] || '',
    });
  },

  switchSelectMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.selectMode) return;
    this.setData({ selectMode: mode });
    if (mode === 'smart') this.recommend();
    else this.refreshManualList();
  },

  recommend() {
    const selected = this.decorate(
      getRecommendedWords(this.words, this.coverage, this.acc, this.data.questionCount, this.last)
    );
    this.setData({ selected, canStart: selected.length >= this.data.questionCount });
    if (this.data.selectMode === 'manual') this.refreshManualList();
  },

  onSearch(e) {
    this.setData({ searchQuery: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.refreshManualList(), 200);
  },

  toggleWord(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.selected.slice();
    const idx = selected.findIndex((w) => w.id === id);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      if (selected.length >= this.data.questionCount) {
        wx.showToast({ title: `最多选 ${this.data.questionCount} 个`, icon: 'none' });
        return;
      }
      const w = (this.words || []).find((x) => x.id === id);
      if (!w) return;
      selected.push(this.decorate([w])[0]);
    }
    this.setData({ selected, canStart: selected.length >= this.data.questionCount });
    this.refreshManualList();
  },

  /** 智能推荐里换掉某个词：优先从未选中的词里补一个。 */
  replaceWord(e) {
    const id = e.currentTarget.dataset.id;
    const selectedIds = new Set((this.data.selected || []).map((w) => w.id));
    const candidate = (this.words || []).find((w) => w.id !== id && !selectedIds.has(w.id));
    const selected = this.data.selected.slice();
    const idx = selected.findIndex((w) => w.id === id);
    if (idx < 0) return;
    if (candidate) {
      selected[idx] = this.decorate([candidate])[0];
    } else {
      selected.splice(idx, 1);
      wx.showToast({ title: '没有可替换的生词', icon: 'none' });
    }
    this.setData({ selected, canStart: selected.length >= this.data.questionCount });
  },

  // ---------- 出题 ----------
  async generate() {
    if (this.data.generating) return;

    const { selected, questionCount, questionType } = this.data;
    if (selected.length < questionCount) {
      wx.showModal({
        title: '生词不足',
        content: `需要选够 ${questionCount} 个生词才能出题（当前已选 ${selected.length} 个）`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    this.setData({
      generating: true,
      generatingHint: questionType === 'cloze'
        ? 'AI 正在为你生成题目…'
        : 'AI 正在为你生成题目…释义单选生成较慢，可能需要 30-90 秒',
    });

    try {
      const wordData = selected.map((w) => ({
        word: w.word,
        meaning: w.meaning || '',
        word_id: w.id,
      }));

      const questions = await generateQuestions(questionType, wordData, (done, total) => {
        this.setData({ generatingHint: `已生成 ${done}/${total} 题…` });
      });

      if (!questions.length) {
        this.setData({ generating: false });
        wx.showModal({
          title: '出题失败',
          content: '未能生成任何题目，请重试',
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }

      StorageService.saveExamDraft({
        questions,
        answers: [],
        questionType,
        currentIndex: 0,
        createdAt: new Date().toISOString(),
        version: 1,
      });

      this.setData({ generating: false });
      wx.navigateTo({ url: '/pages/exam-answer/exam-answer' });
    } catch (err) {
      console.error('[exam-setup] 出题失败', err);
      this.setData({ generating: false });
      wx.showModal({
        title: '出题失败',
        content: (err && err.message) || '题目生成失败，请重试',
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },

  // ---------- 草稿恢复 ----------
  /** 检测残留的 AI 出题草稿：有则弹「继续答题 / 放弃」。 */
  checkResumeDraft() {
    const draft = StorageService.getExamDraft();
    if (!draft || !draft.questions || !draft.questions.length) return;
    const answered = (draft.answers || []).length;
    const total = draft.questions.length;
    const label = QUESTION_TYPE_LABEL[draft.questionType] || '练习';
    this.setData({
      resumeVisible: true,
      resumeContent: `检测到上次有未完成的${label}练习（${answered}/${total} 题），是否继续答题？`,
    });
  },

  onResumeConfirm() {
    this.setData({ resumeVisible: false });
    wx.navigateTo({ url: '/pages/exam-answer/exam-answer' });
  },

  onResumeCancel() {
    this.setData({ resumeVisible: false });
    StorageService.clearExamDraft();
  },

  goStudy() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
