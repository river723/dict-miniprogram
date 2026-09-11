/**
 * 练习中心（PracticeHub）—— 对齐 App PracticeHubScreen。
 * Hero 统计 + 双 CTA（AI 出题 / 真题）+ 题库·错题本入口 + 最近练习 5 条。
 */
import StorageService from '../../services/storage';
import { buildExamSets, formatMonthDay, accuracyLevel } from '../../services/exam';

const TYPE_LABEL = { definition: '释义单选', cloze: '完形选词' };
const MODE_LABEL = { reading: '阅读', cloze: '完形', newtype: '新题型' };

const parseTime = (v) => new Date(String(v || '').replace(/-/g, '/')).getTime() || 0;

Page({
  data: {
    loaded: false,
    totalExams: 0,
    avgText: '0%',
    totalWrong: 0,
    recent: [],
    heroSub: 'AI 出题与真题，任选其一开始',
    bankSub: '暂无套题',
    wrongSub: '暂无错题',
  },

  onShow() {
    this.load();
  },

  load() {
    try {
      const sessions = StorageService.getExamSessions();
      const realSessions = StorageService.getRealExamSessions();
      const wrong = StorageService.getWrongQuestions();
      const realWrong = StorageService.getRealExamWrongQuestions();

      const totalExams = sessions.length + realSessions.length;
      const totalWrong = wrong.length + realWrong.length;

      // 平均正确率：AI 记录直接用 accuracy，真题用 score/total
      const accs = [];
      for (const s of sessions) accs.push(s.accuracy || 0);
      for (const s of realSessions) accs.push(s.total > 0 ? s.score / s.total : 0);
      const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
      const avgPct = Math.round(avg * 100);

      const setCount = buildExamSets(sessions).length;

      this.setData({
        loaded: true,
        totalExams,
        avgText: `${avgPct}%`,
        totalWrong,
        recent: this.buildRecent(sessions, realSessions),
        heroSub: totalExams > 0
          ? `平均正确率 ${avgPct}% · ${totalWrong} 题待复习`
          : 'AI 出题与真题，任选其一开始',
        bankSub: setCount > 0 ? `${setCount} 套题 · ${sessions.length} 次练习` : '暂无套题',
        wrongSub: totalWrong > 0 ? `${totalWrong} 道错题待复盘` : '暂无错题',
      });
    } catch (e) {
      console.error('[practice] 加载失败', e);
      this.setData({ loaded: true });
    }
  },

  /** 两套会话归一成同一种「最近练习」条目，取最新 5 条。 */
  buildRecent(sessions, realSessions) {
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
    for (const s of realSessions) {
      items.push({
        key: s.id,
        createdAt: s.createdAt,
        label: `真题·${MODE_LABEL[s.mode] || ''} ${s.year || ''}`.replace(/\s+$/, ''),
        count: s.total || 0,
        accuracy: s.total > 0 ? s.score / s.total : 0,
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
  goRealExam() { wx.navigateTo({ url: '/pages/exam-list/exam-list' }); },
  goExamSetBank() { wx.navigateTo({ url: '/pages/exam-set-bank/exam-set-bank' }); },
  goWrong() { wx.navigateTo({ url: '/pages/wrong-questions/wrong-questions' }); },
  goHistory() { wx.navigateTo({ url: '/pages/exam-history/exam-history' }); },
});
