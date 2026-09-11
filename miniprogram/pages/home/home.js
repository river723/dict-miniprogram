/**
 * 首页仪表盘 —— 对齐 memo-grad HomeScreen。
 * 结构：Hero 卡（今日待学 + 环形进度）→ 主 CTA → StatStrip 三指标 → 细进度线
 *      → 待办行（错题本 / 困难词）→ 词库入口 → 最近添加 → 本周趋势。
 */
import StorageService from '../../services/storage';
import { getWeeklyTrend } from '../../services/studyPlan';
import { fillTodayIfNeeded } from '../../services/autoWord';
import { formatDate } from '../../utils/util';

const DEFAULT_SUGGESTION = {
  title: '保持学习节奏',
  description: '今天暂无固定计划，也可以先背几个单词保持状态。',
  actionLabel: '开始背诵',
  icon: 'book-open-page-variant',
  target: 'study',
};

/** 历史正确率偏低（<50%）的词，取前 5 个。 */
function getDifficultWordIds(words, records) {
  const byWord = {};
  records.forEach((r) => {
    if (!byWord[r.word_id]) byWord[r.word_id] = { total: 0, correct: 0 };
    byWord[r.word_id].total += 1;
    byWord[r.word_id].correct += r.result === 1 ? 1 : 0;
  });
  return words
    .map((w) => {
      const s = byWord[w.id];
      if (!s || s.total === 0) return null;
      return { id: w.id, total: s.total, rate: s.correct / s.total };
    })
    .filter((x) => x && x.rate < 0.5)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5)
    .map((x) => x.id);
}

function needsDifficultWords(stats) {
  if (stats.totalWords === 0) return false;
  if (stats.todayPending > 0) return false;
  return (stats.todayStudyCount >= 3 && stats.accuracy < 0.6) || stats.wrongQuestionCount === 0;
}

/** 今日建议（与 App buildTodaySuggestion 同构，路由改为小程序页面）。 */
function buildSuggestion(s) {
  if (s.totalWords === 0) {
    return {
      title: '先添加生词',
      description: '生词本还是空的，先添加几个考研词开始吧。',
      actionLabel: '添加生词',
      icon: 'plus-box',
      target: 'add-word',
    };
  }
  if (s.todayPending > 0) {
    return {
      title: `今日还有 ${s.todayPending} 个生词`,
      description: `${s.newPending} 个新词 · ${s.reviewPending} 个复习词`,
      actionLabel: '开始学习',
      icon: 'book-open-page-variant',
      target: 'study',
    };
  }
  if (s.todayPending === 0 && s.unstudiedNewWordCount > 0) {
    const done = s.todayTotal > 0;
    return {
      title: done ? '今日任务已完成' : '词库还有新词',
      description: done ? '状态不错，再背一批新词继续推进。' : '还有未学过的新词，开始背吧。',
      actionLabel: '继续学习',
      icon: 'book-open-page-variant',
      target: 'study',
    };
  }
  if (s.todayStudyCount >= 3 && s.accuracy < 0.6) {
    const has = s.difficultWordIds.length > 0;
    return {
      title: '今天正确率偏低',
      description: `当前约 ${Math.round(s.accuracy * 100)}%，建议先复习困难词。`,
      actionLabel: has ? '强化复习' : '继续学习',
      icon: has ? 'refresh' : 'book-open-page-variant',
      target: 'study',
    };
  }
  if (s.wrongQuestionCount > 0) {
    return {
      title: `${s.wrongQuestionCount} 道错题待复盘`,
      description: '趁热复盘，减少重复犯错。',
      actionLabel: '复习错题',
      icon: 'alert-circle-outline',
      target: 'wrong-questions',
    };
  }
  if (s.difficultWordCount > 0) {
    return {
      title: `${s.difficultWordCount} 个困难词待强化`,
      description: '这些词历史正确率偏低。',
      actionLabel: '强化复习',
      icon: 'refresh',
      target: 'study',
    };
  }
  if (s.todayTotal > 0 && s.todayPending === 0) {
    return {
      title: '今日任务已完成',
      description: '学习节奏不错，可以做一组考题巩固。',
      actionLabel: 'AI出题练习',
      icon: 'puzzle',
      target: 'quiz',
    };
  }
  return DEFAULT_SUGGESTION;
}

Page({
  data: {
    loading: true,
    error: false,
    isEmpty: false,

    autoAddEnabled: true,
    refilling: false,

    heroLabel: '今日',
    heroValue: 0,
    heroDesc: '',
    progress: 0,
    ringStyle: '',

    metrics: [],
    suggestion: DEFAULT_SUGGESTION,
    canStartAnotherGroup: false,

    wrongCount: 0,
    difficultCount: 0,
    difficultWordIds: [],
    recentWords: [],
    weeklyStudied: 0,
    avgDaily: 0,
    hasWeekly: false,
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    try {
      const settings = StorageService.getSettings();
      this.setData({ autoAddEnabled: settings.autoAddNewWords !== false });

      const added = await fillTodayIfNeeded();
      if (added > 0) {
        wx.showToast({ title: `已按考频自动加入 ${added} 个新词`, icon: 'none' });
      }

      const today = formatDate();
      const allWords = StorageService.getWords();
      const allPlans = StorageService.getStudyPlans();
      const allRecords = StorageService.getStudyRecords();
      const wrongQuestions = StorageService.getWrongQuestions();

      const todayPlans = allPlans.filter((p) => p.plan_date === today);
      const todayRecords = allRecords.filter((r) => r.study_date === today);
      const todayPendingPlans = todayPlans.filter((p) => !p.completed);
      const correctCount = todayRecords.filter((r) => r.result === 1).length;
      const accuracy = todayRecords.length > 0 ? correctCount / todayRecords.length : 0;
      const studiedIds = {};
      allRecords.forEach((r) => { studiedIds[r.word_id] = true; });
      const unstudiedNewWordCount = allWords.filter((w) => !studiedIds[w.id]).length;

      const stats = {
        totalWords: allWords.length,
        todayTotal: todayPlans.length,
        todayPending: todayPendingPlans.length,
        todayCompleted: todayPlans.filter((p) => p.completed).length,
        newPending: todayPendingPlans.filter((p) => p.plan_type === 'new').length,
        reviewPending: todayPendingPlans.filter((p) => p.plan_type === 'review').length,
        todayStudyCount: todayRecords.length,
        accuracy,
        wrongQuestionCount: wrongQuestions.length,
        difficultWordIds: [],
        difficultWordCount: 0,
        unstudiedNewWordCount,
      };
      if (needsDifficultWords(stats)) {
        const ids = getDifficultWordIds(allWords, allRecords);
        stats.difficultWordIds = ids;
        stats.difficultWordCount = ids.length;
      }

      const totalPlanned = stats.todayTotal;
      const progress = totalPlanned > 0 ? stats.todayCompleted / totalPlanned : 0;
      const availableCount = Math.max(stats.todayPending, stats.unstudiedNewWordCount);
      const accuracyPercent = Math.round(stats.accuracy * 100);
      const deg = Math.round(Math.min(1, Math.max(0, progress)) * 360);

      const recentWords = allWords
        .slice()
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 5);

      const weekly = getWeeklyTrend();
      const weeklyStudied = weekly.reduce((s, d) => s + d.studyCount, 0);
      const avgDaily = weekly.length > 0 ? Math.round(weeklyStudied / weekly.length) : 0;

      const suggestion = buildSuggestion(stats);
      const canStartAnotherGroup =
        settings.autoAddNewWords !== false &&
        stats.todayPending === 0 &&
        stats.unstudiedNewWordCount === 0;

      this.setData({
        loading: false,
        error: false,
        isEmpty: stats.totalWords === 0,
        heroLabel: availableCount > 0 ? '今日待学' : stats.todayTotal > 0 ? '今日任务' : '今日',
        heroValue: availableCount > 0 ? availableCount : stats.todayCompleted,
        heroDesc: suggestion.description,
        progress,
        progressPercentText: `${Math.round(progress * 100)}%`,
        ringStyle: `background: conic-gradient(var(--mg-on-primary) 0deg ${deg}deg, rgba(255,255,255,0.18) ${deg}deg 360deg);`,
        metrics: [
          { value: stats.todayCompleted, label: '今日已完成' },
          { value: `${accuracyPercent}%`, label: '今日正确率', trend: accuracyPercent >= 70 ? 'up' : accuracyPercent >= 50 ? 'flat' : 'down' },
          { value: avgDaily, label: '日均次数' },
        ],
        suggestion,
        canStartAnotherGroup,
        wrongCount: stats.wrongQuestionCount,
        difficultCount: stats.difficultWordCount,
        difficultWordIds: stats.difficultWordIds,
        recentWords,
        weeklyStudied,
        avgDaily,
        hasWeekly: weekly.length > 0,
      });
    } catch (e) {
      console.error('[home] 加载失败', e);
      this.setData({ loading: false, error: true });
    }
  },

  // ---------- 跳转 ----------
  onSuggestionTap() {
    const t = this.data.suggestion.target;
    if (t === 'study') {
      const ids = this.data.difficultWordIds;
      const useIds = this.data.suggestion.icon === 'refresh' && ids.length > 0;
      wx.navigateTo({
        url: useIds ? `/pages/study/study?wordIds=${ids.join(',')}` : '/pages/study/study',
      });
      return;
    }
    if (t === 'add-word') {
      wx.navigateTo({ url: '/pages/add-word/add-word' });
      return;
    }
    if (t === 'wrong-questions') {
      wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' });
      return;
    }
    if (t === 'quiz') {
      wx.navigateTo({ url: '/pages/exam-setup/exam-setup' });
    }
  },

  goWrong() {
    wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' });
  },

  goDifficult() {
    const ids = this.data.difficultWordIds;
    wx.navigateTo({ url: `/pages/study/study?wordIds=${ids.join(',')}` });
  },

  goDictionary() {
    wx.navigateTo({ url: '/pages/dictionary/dictionary' });
  },

  goWordList() {
    wx.navigateTo({ url: '/pages/word-list/word-list' });
  },

  goWordDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${id}` });
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' });
  },

  async onAnotherGroup() {
    if (this.data.refilling) return;
    this.setData({ refilling: true });
    try {
      const added = await fillTodayIfNeeded({ force: true, forceRefill: true });
      if (added > 0) {
        wx.showToast({ title: `已自动补充 ${added} 个新词`, icon: 'none' });
        wx.navigateTo({ url: '/pages/study/study' });
      } else if (StorageService.getSettings().autoAddNewWords !== true) {
        wx.showToast({ title: '自动配词已关闭，可在设置中开启', icon: 'none' });
      } else {
        wx.showToast({ title: '词库已用尽，可去词库手动挑选', icon: 'none' });
      }
    } finally {
      this.setData({ refilling: false });
    }
  },
});
