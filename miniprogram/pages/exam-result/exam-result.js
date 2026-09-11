/**
 * AI 练习结果页 —— 对齐 memo-grad ExamResultScreen。
 * 总览卡（正确率 + 题数）→ 逐题回顾 → 操作按钮（再来一组 / 复习错题 / 返回）。
 *
 * 落库（只跑一次）：保存练习记录 → 清草稿 → 更新错题本（答对累计满阈值自动移出）
 * → 写学习记录（study_mode='exam_quiz'）。
 */
import StorageService from '../../services/storage';
import { accuracyLevel } from '../../services/exam';
import { QUESTION_TYPE_LABEL, WRONG_QUESTION_MASTERY_THRESHOLD } from '../../constants/index';
import { openWordDetail } from '../../utils/wordNav';

Page({
  data: {
    empty: false,
    typeLabel: '',
    accuracyPercent: 0,
    accuracyCls: 'success',
    summaryText: '',
    review: [],
    hasWrong: false,
    saved: false,
  },

  onLoad() {
    const payload = StorageService.getExamResult();
    if (!payload || !(payload.questions || []).length) {
      this.setData({ empty: true });
      return;
    }
    this.payload = payload;

    const { questions, answers, questionType } = payload;
    const total = questions.length;
    const answered = answers.length;
    const correctCount = answers.filter((a) => a.is_correct).length;
    const wrongCount = answers.filter((a) => !a.is_correct).length;
    const accuracy = total > 0 ? correctCount / total : 0;

    this.setData({
      typeLabel: QUESTION_TYPE_LABEL[questionType] || '练习',
      accuracyPercent: Math.round(accuracy * 100),
      accuracyCls: accuracyLevel(accuracy),
      summaryText: `共 ${total} 题，答对 ${correctCount} 题，答错 ${wrongCount} 题`
        + (answered < total ? `，未答 ${total - answered} 题` : ''),
      review: this.buildReview(questions, answers),
      hasWrong: wrongCount > 0,
    });

    this.persist(accuracy);
  },

  /** 逐题回顾的渲染数据。 */
  buildReview(questions, answers) {
    return questions.map((q, idx) => {
      const a = answers.find((x) => x.question_index === idx);
      const isAnswered = !!a;
      const isCorrect = isAnswered && a.is_correct;
      const isDefinition = q.type === 'definition';

      const item = {
        idx: idx + 1,
        type: q.type,
        typeLabel: QUESTION_TYPE_LABEL[q.type] || '',
        isDefinition,
        verdict: isAnswered ? (isCorrect ? '✓ 正确' : '✗ 错误') : '未作答',
        verdictCls: isAnswered ? (isCorrect ? 'ok' : 'bad') : 'none',
        wordId: q.word_id || '',
        word: q.word || q.target_word || '',
        correct: isDefinition ? q.correct_definition : q.correct_answer,
        userAnswer: a ? (a.selected_answer || '（未作答）') : '',
        showUser: isAnswered && !isCorrect,
      };

      if (isDefinition) {
        item.sentence = String(q.sentence || '').replace(/\*/g, '');
        item.translation = q.chinese_translation || '';
      } else {
        item.sentence = String(q.sentence || '').replace(/\[BLANK\]/g, '______');
        item.hint = q.chinese_hint || '';
      }
      return item;
    });
  },

  /** 结果落库：练习记录 + 清草稿 + 错题本 + 学习记录。防重入。 */
  async persist(accuracy) {
    if (this._persisted) return;
    this._persisted = true;

    const { questions, answers, questionType, source, originId, createdAt } = this.payload;

    try {
      await StorageService.saveExamSession({
        questions,
        answers,
        question_type: questionType,
        accuracy,
        created_at: createdAt || new Date().toISOString(),
        origin_id: originId || null,
        source: source || 'generation',
      });

      StorageService.clearExamDraft();

      for (const a of answers) {
        await StorageService.addOrUpdateWrongQuestion(a.question, a.selected_answer, a.is_correct);
      }

      // 答对累计到阈值后自动移出错题本
      for (const wq of StorageService.getWrongQuestions()) {
        if ((wq.correct_count || 0) >= WRONG_QUESTION_MASTERY_THRESHOLD) {
          await StorageService.removeWrongQuestion(wq.id);
        }
      }

      for (const a of answers) {
        if (!a.question || !a.question.word_id) continue;
        await StorageService.addStudyRecord({
          word_id: a.question.word_id,
          result: a.is_correct ? 1 : 0,
          study_mode: 'exam_quiz',
        });
      }

      StorageService.clearExamResult();
      this.setData({ saved: true });
    } catch (e) {
      console.error('[exam-result] 落库失败', e);
      wx.showToast({ title: '成绩保存失败', icon: 'none' });
    }
  },

  /** 点击目标词 → 生词详情（缺失回落词库）。 */
  openWord(e) {
    const ds = e.currentTarget.dataset || {};
    openWordDetail(ds.id, ds.word);
  },

  again() { wx.redirectTo({ url: '/pages/exam-setup/exam-setup' }); },
  goWrong() { wx.redirectTo({ url: '/pages/wrong-questions/wrong-questions' }); },
  goPractice() { wx.switchTab({ url: '/pages/practice/practice' }); },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
