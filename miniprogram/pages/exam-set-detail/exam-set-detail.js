/**
 * 套题详情（只读）—— 对齐 memo-grad ExamSetDetailScreen。
 * 按 rootId 现场重算分组，浏览该套题全部题目与正确答案，并提供「重做这套题」入口。
 * 组不存在（已删）→ 空态回退题库。
 *
 * 重做走 exam-answer 的 setId 模式：从记录取题、origin_id 指回本套题，
 * 这样新记录仍归入同一套题，题库按组显示最新成绩。
 */
import StorageService from '../../services/storage';
import { parseWordHighlight, splitBlank, accuracyLevel } from '../../services/exam';
import { QUESTION_TYPE_LABEL } from '../../constants/index';
import { openWordDetail } from '../../utils/wordNav';
import { applyTheme } from '../../utils/theme';

const LETTERS = 'ABCDEFGH';

Page({
  data: {
    missing: false,
    ready: false,
    typeLabel: '',
    type: 'definition',
    total: 0,
    count: 0,
    createdText: '',
    lastText: '',
    accuracyText: '',
    accuracyCls: 'success',
    questions: [],
  },

  onLoad(options) {
    this.rootId = (options && options.rootId) || '';
    this.load();
  },

  onShow() {

    applyTheme(this);
    // 重做返回后刷新「已练次数 / 最新正确率」
    if (this.rootId) this.load();
  },

  load() {
    const all = StorageService.getExamSessions();
    const members = all
      .filter((s) => (s.origin_id || s.id) === this.rootId && s.source !== 'wrong_review')
      .sort((a, b) => this.timeOf(b.created_at) - this.timeOf(a.created_at));

    if (!members.length) {
      this.setData({ missing: true, ready: true });
      return;
    }

    const latest = members[0];
    const root = members[members.length - 1];
    const accuracy = latest.accuracy || 0;

    this.setData({
      missing: false,
      ready: true,
      typeLabel: QUESTION_TYPE_LABEL[latest.question_type] || '练习',
      type: latest.question_type || 'definition',
      total: (latest.questions || []).length,
      count: members.length,
      createdText: this.formatDate(root.created_at),
      lastText: this.formatDate(latest.created_at),
      accuracyText: `最新 ${Math.round(accuracy * 100)}%`,
      accuracyCls: accuracyLevel(accuracy),
      questions: this.buildQuestions(latest.questions || []),
    });
  },

  timeOf(v) { return new Date(String(v || '').replace(/-/g, '/')).getTime() || 0; },

  formatDate(v) {
    const d = new Date(String(v || '').replace(/-/g, '/'));
    if (Number.isNaN(d.getTime())) return '未知';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  /** 题目 → 只读回顾视图（选项标出正确答案）。 */
  buildQuestions(questions) {
    return questions.map((q, idx) => {
      const isDefinition = q.type === 'definition';
      const correct = isDefinition ? q.correct_definition : q.correct_answer;
      const item = {
        idx: idx + 1,
        type: q.type,
        isDefinition,
        label: isDefinition ? `Q${idx + 1}` : `[${idx + 1}]`,
        wordId: q.word_id || '',
        word: q.word || q.target_word || '',
        translation: isDefinition ? (q.chinese_translation || '') : (q.chinese_hint || ''),
        prompt: isDefinition ? '划线单词的正确英文释义：' : '正确答案：',
        options: (q.options || []).map((text, i) => ({
          letter: LETTERS[i] || String(i + 1),
          text,
          isCorrect: text === correct,
        })),
      };
      if (isDefinition) {
        item.sentenceParts = parseWordHighlight(q.sentence, q.word);
      } else {
        const blank = splitBlank(q.sentence);
        item.blankBefore = blank.before;
        item.blankAfter = blank.after;
      }
      return item;
    });
  },

  /** 点目标词 → 生词详情。非目标词片段（无 id 无词）静默忽略。 */
  openWord(e) {
    const ds = e.currentTarget.dataset || {};
    if (!ds.id && !ds.word) return;
    if (!ds.id || !StorageService.getWordById(ds.id)) {
      wx.showToast({ title: `「${ds.word || ''}」不在生词本`, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${ds.id}` });
  },

  /** 重做：进答题页的 setId 模式（从记录取题，新记录归入同一套题）。 */
  redo() {
    if (!this.rootId) return;
    wx.navigateTo({ url: `/pages/exam-answer/exam-answer?setId=${this.rootId}` });
  },

  goBank() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/exam-set-bank/exam-set-bank' }) });
  },
});
