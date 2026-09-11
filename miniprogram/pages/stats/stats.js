import { getWeeklyTrend, getMasteryStats } from '../../services/studyPlan';
import { difficultyColor } from '../../theme/tokens';

Page({
  data: { trend: [], stats: null, maxCount: 1 },

  onShow() {
    const trend = getWeeklyTrend();
    const stats = getMasteryStats();
    const maxCount = Math.max(1, ...trend.map((d) => d.studyCount));
    this.setData({
      trend: trend.map((d) => ({
        ...d,
        height: Math.round((d.studyCount / maxCount) * 100),
        rateLabel: d.accuracy === null ? '—' : `${Math.round(d.accuracy * 100)}%`,
      })),
      stats,
      maxCount,
    });
  },
});
