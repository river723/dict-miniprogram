/**
 * AI 答题页 —— 对齐 memo-grad ExamAnswerScreen。
 * 顶部进度（题号 + 正确率 + 进度条）→ 题目卡（释义单选 / 完形选词）→ 底部操作条。
 *
 * 平台说明：App 通过 navigation 参数传 questions；小程序改为从练习草稿读题
 * （exam-setup / 错题本重做都会先写草稿），历史套题重做走 ?setId=xxx 从记录里取题。
 * 答完把「题目 + 作答 + 归属」写入结果交接载荷（K.examResult），跳结果页落库。
 */
import StorageService from '../../services/storage';
import { correctAnswerOf, parseWordHighlight, splitBlank } from '../../services/exam';
import { EXAM_CONFIG, QUESTION_TYPE_LABEL } from '../../constants/index';

const LETTERS = 'ABCDEFGH';

Page({
  data: {
    ready: false,
    empty: false,

    index: 0,
    total: 0,
    indexText: '1 / 1',
    progressPercent: '0%',
    accuracyText: '正确率: 0%',

    current: null,
    selected: '',
    revealed: false,
    isLast: false,
    autoAdvance: true,
    verdict: '',
    verdictCls: '',
  },

  onLoad(options) {
    // 整页内容都挂在 wx:elif="{{ready}}" 上，这里一旦抛异常就会白屏 —— 必须兜住。
    try {
      // run: { questions, questionType, answers, currentIndex, source, originId, createdAt }
      const run = this.resolveRun(options || {});
      if (!run || !run.questions.length) {
        this.setData({ ready: true, empty: true });
        return;
      }
      this.run = run;
      // getSettings 是**同步**的（storage.js 里读本地缓存），不能当 Promise 用
      this.setData({
        ready: true,
        autoAdvance: StorageService.getSettings().examAutoAdvance !== false,
      });
      this.render(run.currentIndex, run.answers, run.answers);
    } catch (e) {
      console.error('[exam-answer] 初始化失败', e);
      this.setData({ ready: true, empty: true });
      wx.showToast({ title: '题目加载失败', icon: 'none' });
    }
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer);
  },

  /**
   * 组装本次练习：优先用「与本屏题目同源」的草稿恢复答题进度，
   * 否则按 setId 从历史记录取题（重做）或直接采用草稿里的新题。
   */
  resolveRun(options) {
    const draft = StorageService.getExamDraft();
    let questions = [];
    let questionType = 'definition';
    let source = 'generation';
    let originId = null;
    let createdAt = new Date().toISOString();

    if (options.setId) {
      const session = StorageService.getExamSessionById(options.setId);
      if (!session) return null;
      questions = session.questions || [];
      questionType = session.question_type || 'definition';
      originId = options.setId; // 重做归到同一套题（题库按 origin_id 聚合）
    } else {
      if (!draft || !(draft.questions || []).length) return null;
      questions = draft.questions;
      questionType = draft.questionType || 'definition';
      source = draft.source || 'generation';
      originId = draft.origin_id || null;
      createdAt = draft.createdAt || createdAt;
    }

    if (!questions.length) return null;

    let answers = [];
    let currentIndex = 0;

    // 同源判定：题面与题型都一致才恢复进度（重做路径下草稿可能是别的题，靠比对排除）
    const sameSource = draft
      && draft.questionType === questionType
      && (draft.questions || []).length === questions.length
      && JSON.stringify(draft.questions) === JSON.stringify(questions);
    if (sameSource) {
      answers = draft.answers || [];
      currentIndex = Math.min(Math.max(draft.currentIndex || 0, 0), questions.length - 1);
      createdAt = draft.createdAt || createdAt;
      source = draft.source || source;
      originId = draft.origin_id || originId;
    }

    return { questions, questionType, answers, currentIndex, source, originId, createdAt };
  },

  /** 渲染第 index 题（含选项态与句子高亮）。 */
  render(index, answers, allAnswers) {
    const { questions } = this.run;
    const q = questions[index];
    if (!q) {
      // 草稿被污染 / 下标越界时不要崩在半路
      this.setData({ ready: true, empty: true });
      return;
    }
    const answeredCount = allAnswers.length;
    const correctCount = allAnswers.filter((a) => a.is_correct).length;
    const total = questions.length;

    this.setData({
      index,
      total,
      indexText: `${index + 1} / ${total}`,
      progressPercent: `${Math.round(((index + 1) / total) * 100)}%`,
      accuracyText: `正确率: ${answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0}%`,
      current: this.buildView(q, '', false),
      selected: '',
      revealed: false,
      isLast: index === total - 1,
      verdict: '',
      verdictCls: '',
    });
  },

  /** 题目 → 渲染视图（WXML 里不能调用函数，选项态在这里算好）。 */
  buildView(q, selected, revealed) {
    const correct = correctAnswerOf(q);
    const isDefinition = q.type === 'definition';
    const options = (q.options || []).map((opt, i) => {
      let cls = '';
      let mark = '';
      if (revealed) {
        if (opt === correct) { cls = 'opt--correct'; mark = 'check'; }
        else if (opt === selected) { cls = 'opt--wrong'; mark = 'close'; }
      } else if (opt === selected) {
        cls = 'opt--selected';
      }
      return { letter: LETTERS[i] || String(i + 1), text: opt, cls, mark };
    });

    const view = {
      type: q.type,
      typeLabel: QUESTION_TYPE_LABEL[q.type] || '练习',
      isDefinition,
      options,
      prompt: isDefinition ? '以下哪个是划线单词的正确英文释义？' : '选择正确的单词填入空白处：',
    };

    if (isDefinition) {
      view.sentenceParts = parseWordHighlight(q.sentence, q.word);
    } else {
      const blank = splitBlank(q.sentence);
      view.blankBefore = blank.before;
      view.blankAfter = blank.after;
    }
    return view;
  },

  /** 选中一个选项：立即判定 + 显示答案，按设置决定是否自动跳下一题。 */
  select(e) {
    if (this.data.revealed) return;
    const option = e.currentTarget.dataset.option;
    const q = this.run.questions[this.data.index];
    const isCorrect = option === correctAnswerOf(q);

    const finalAnswers = this.run.answers.concat([{
      question_index: this.data.index,
      question: q,
      selected_answer: option,
      is_correct: isCorrect,
    }]);
    this.run.answers = finalAnswers;

    this.setData({
      current: this.buildView(q, option, true),
      selected: option,
      revealed: true,
      verdict: isCorrect ? '正确' : '错误',
      verdictCls: isCorrect ? 'ok' : 'bad',
    });
    this.refreshAccuracy(finalAnswers);

    if (this.data.autoAdvance === false) {
      // 关闭自动跳转：留在本屏给用户看答案解析，答案已落草稿
      this.persistDraft(finalAnswers, this.data.index);
      return;
    }

    this._timer = setTimeout(() => this.advance(finalAnswers), EXAM_CONFIG.AUTO_ADVANCE_DELAY);
  },

  /** 跳过：以「未作答·错误」记入，确保能进错题本与学习记录。 */
  skip() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const idx = this.data.index;
    const already = this.run.answers.some((a) => a.question_index === idx);
    const answers = already
      ? this.run.answers
      : this.run.answers.concat([{
          question_index: idx,
          question: this.run.questions[idx],
          selected_answer: '',
          is_correct: false,
        }]);
    if (!already) this.run.answers = answers;
    this.advance(answers);
  },

  /** 下一题 / 查看结果。 */
  next() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.advance(this.run.answers);
  },

  advance(answers) {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this.data.isLast) {
      this.finish(answers);
      return;
    }
    const nextIndex = this.data.index + 1;
    this.render(nextIndex, answers, answers);
    this.persistDraft(answers, nextIndex);
  },

  refreshAccuracy(answers) {
    const answered = answers.length;
    const correct = answers.filter((a) => a.is_correct).length;
    this.setData({
      accuracyText: `正确率: ${answered > 0 ? Math.round((correct / answered) * 100) : 0}%`,
    });
  },

  /** 同步草稿：整套题 + 已答答案 + 当前题号 + 归属，供「继续未完成的练习」恢复。 */
  persistDraft(answers, currentIndex) {
    const run = this.run;
    StorageService.saveExamDraft({
      questions: run.questions,
      answers,
      questionType: run.questionType,
      currentIndex,
      createdAt: run.createdAt,
      source: run.source,
      origin_id: run.originId,
      version: 1,
    });
  },

  finish(answers) {
    const run = this.run;
    StorageService.saveExamResult({
      questions: run.questions,
      answers,
      questionType: run.questionType,
      source: run.source,
      originId: run.originId,
      createdAt: run.createdAt,
    });
    wx.redirectTo({ url: '/pages/exam-result/exam-result' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/practice/practice' }) });
  },
});
