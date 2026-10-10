/**
 * 练习中心（PracticeHub）—— 对齐 App PracticeHubScreen。
 * Hero 统计 + AI 出题 / 题库·错题本入口 + 最近练习 5 条（仅 AI 出题记录）。
 */
import StorageService from '../../services/storage';
import { buildExamSets, formatMonthDay, accuracyLevel } from '../../services/exam';
import { applyTheme } from '../../utils/theme';

const TYPE_LABEL = { definition: '释义单选', cloze: '完形选词' };

const parseTime = (v) => new Date(String(v || '').replace(/-/g, '/')).getTime() || 0;

Page({
  data: {
    loaded: false,
    totalExams: 0,
    avgText: '0%',
    totalWrong: 0,
    recent: [],
    heroSub: 'AI 出题练习，巩固生词',
    bankSub: '暂无套题',
    wrongSub: '暂无错题',
  },

  onShow() {
    applyTheme(this);
    this.load();
  },

  load() {
    try {
      const sessions = StorageService.getExamSessions();
      const wrong = StorageService.getWrongQuestions();

      const totalExams = sessions.length;
      const totalWrong = wrong.length;

      // 平均正确率：AI 记录直接用 accuracy
      const accs = [];
      for (const s of sessions) accs.push(s.accuracy || 0);
      const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
      const avgPct = Math.round(avg * 100);

      const setCount = buildExamSets(sessions).length;

      this.setData({
        loaded: true,
        totalExams,
        avgText: `${avgPct}%`,
        totalWrong,
        recent: this.buildRecent(sessions),
        heroSub: totalExams > 0
          ? `平均正确率 ${avgPct}% · ${totalWrong} 题待复习`
          : 'AI 出题练习，巩固生词',
        bankSub: setCount > 0 ? `${setCount} 套题 · ${sessions.length} 次练习` : '暂无套题',
        wrongSub: totalWrong > 0 ? `${totalWrong} 道错题待复盘` : '暂无错题',
      });
    } catch (e) {
      console.error('[practice] 加载失败', e);
      this.setData({ loaded: true });
    }
  },

  /** AI 会话归一成「最近练习」条目，取最新 5 条。 */
  buildRecent(sessions) {
    const items = [];
    for (const s of sessions) {
      items.push({
        key: s.id,
        createdAt: s.created_at,
        label: (s.source === 'wrong_review' ? '错题复习·' : '') + (TYPE_LABEL[s.question_type] || '练习'),
        count: (s.questions || []).length,
        accuracy: s.accuracy || 0,
      });
    }
    items.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
    return items.slice(0, 5).map((it) => ({
      key: it.key,
      label: it.label,
      timeText: formatMonthDay(it.createdAt),
      count: it.count,
      accuracyText: `${Math.round(it.accuracy * 100)}%`,
      level: accuracyLevel(it.accuracy),
    }));
  },

  goExamSetup() { wx.navigateTo({ url: '/pages/exam-setup/exam-setup' }); },
  goExamSetBank() { wx.navigateTo({ url: '/pages/exam-set-bank/exam-set-bank' }); },
  goWrong() { wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' }); },
  goHistory() { wx.navigateTo({ url: '/pages/exam-history/exam-history' }); },
});
