/**
 * 学习统计详情 —— 对齐 memo-grad StatsDetailScreen（固定展示过去 7 天）。
 *
 * 三段：
 *   1. 过去 7 天折线图（每日学习次数主线 + 7 日均值虚线）+ 当日三指标
 *   2. 困难词 Top 5（历史正确率 < 50%，带最近 7 次作答 sparkline）
 *   3. 里程碑
 *
 * 图表纯用 view 拼（线段用 rotate 旋转实现），尺寸统一以 rpx 计算，
 * 与 App 的 TrendLineChart / Sparkline 视觉一致。
 */
import StorageService from '../../services/storage';
import { getWeeklyTrend } from '../../services/studyPlan';
import { formatDate } from '../../utils/util';
import { applyTheme } from '../../utils/theme';

/** 折线图几何（单位 rpx）。 */
const CH = { w: 640, h: 240, top: 24, right: 16, bottom: 48, left: 56 };
const CHART_W = CH.w;
const CHART_H = CH.h;

/** Sparkline 几何（单位 rpx）。 */
const SP = { w: 112, h: 40 };

const MASTER_RATE = 0.8;
const DIFFICULT_RATE = 0.5;

function buildChart(trend, average) {
  const max = Math.max(...trend.map((d) => d.studyCount), average, 1);
  const innerW = CH.w - CH.left - CH.right;
  const innerH = CH.h - CH.top - CH.bottom;
  const stepX = trend.length > 1 ? innerW / (trend.length - 1) : 0;
  const toPoint = (i, v) => ({
    x: CH.left + i * stepX,
    y: CH.top + innerH - (v / max) * innerH,
  });

  const segs = [];
  for (let i = 0; i < trend.length - 1; i += 1) {
    const p1 = toPoint(i, trend[i].studyCount);
    const p2 = toPoint(i + 1, trend[i + 1].studyCount);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    segs.push({
      left: Math.round(p1.x),
      top: Math.round(p1.y - 2),
      width: Math.round(Math.sqrt(dx * dx + dy * dy)),
      angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
    });
  }

  const dots = trend.map((d, i) => {
    const p = toPoint(i, d.studyCount);
    return { left: Math.round(p.x - 8), top: Math.round(p.y - 8), active: d.studyCount > 0 };
  });

  const xLabels = trend.map((d, i) => {
    const p = toPoint(i, 0);
    return { left: Math.round(p.x - 24), top: Math.round(CH.top + innerH + 8), text: d.dayLabel };
  });

  const yTicks = [0, Math.ceil(max / 2), Math.ceil(max)].map((t) => ({
    top: Math.round(CH.top + innerH - (t / max) * innerH),
    label: String(t),
  }));

  return {
    segs,
    dots,
    xLabels,
    yTicks,
    avgTop: average > 0 ? Math.round(CH.top + innerH - (average / max) * innerH) : -1,
    avgLeft: CH.left,
    avgRight: CH.right,
    maxLabel: String(Math.ceil(max)),
  };
}

function buildSparkline(data) {
  if (!data || data.length === 0) return { segs: [], dots: [] };
  const stepX = data.length > 1 ? SP.w / (data.length - 1) : 0;
  const toPoint = (i, v) => ({ x: i * stepX, y: SP.h - v * (SP.h - 8) - 4 });
  const segs = [];
  for (let i = 0; i < data.length - 1; i += 1) {
    const p1 = toPoint(i, data[i]);
    const p2 = toPoint(i + 1, data[i + 1]);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    segs.push({
      left: Math.round(p1.x),
      top: Math.round(p1.y - 1),
      width: Math.round(Math.sqrt(dx * dx + dy * dy)),
      angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10,
    });
  }
  const dots = data.map((v, i) => {
    const p = toPoint(i, v);
    return { left: Math.round(p.x - 4), top: Math.round(p.y - 4), hit: v === 1 };
  });
  return { segs, dots };
}

Page({
  data: {
    loaded: false,
    totalWords: 0,
    chartW: `${CHART_W}rpx`,
    chartH: `${CHART_H}rpx`,
    avgText: '0.0',
    chart: null,
    metrics: [],
    difficultWords: [],
    milestones: [],
  },

  onShow() {

    applyTheme(this);
    this.load();
  },

  load() {
    const words = StorageService.getWords();
    const records = StorageService.getStudyRecords();
    const trend = getWeeklyTrend();
    const todayStr = formatDate();
    const todayRecords = StorageService.getStudyRecordsByDate(todayStr) || [];

    const todayStudyCount = todayRecords.length;
    const todayCorrect = todayRecords.filter((r) => r.result === 1).length;
    const todayAccuracy = todayStudyCount > 0 ? (todayCorrect / todayStudyCount) * 100 : 0;

    const avgStudy = trend.length > 0
      ? trend.reduce((s, d) => s + d.studyCount, 0) / trend.length
      : 0;

    // 逐词统计 → 困难词 Top 5
    const byWord = new Map();
    for (const r of records) {
      if (!byWord.has(r.word_id)) byWord.set(r.word_id, []);
      byWord.get(r.word_id).push(r);
    }
    const difficultWords = [];
    let masteredWords = 0;
    words.forEach((w) => {
      const rs = byWord.get(w.id) || [];
      if (rs.length === 0) return;
      const correct = rs.filter((r) => r.result === 1).length;
      const rate = correct / rs.length;
      if (rate >= MASTER_RATE) masteredWords += 1;
      if (rate < DIFFICULT_RATE) {
        difficultWords.push({ id: w.id, text: w.word, rate, total: rs.length, rs });
      }
    });
    difficultWords.sort((a, b) => a.rate - b.rate);
    const top = difficultWords.slice(0, 5).map((d) => ({
      id: d.id,
      text: d.text,
      rateText: `${Math.round(d.rate * 100)}% · ${d.total} 次`,
      ...buildSparkline(
        d.rs
          .slice()
          .sort((x, y) => String(x.study_date).localeCompare(String(y.study_date)))
          .slice(-7)
          .map((r) => (r.result === 1 ? 1 : 0))
      ),
    }));

    this.setData({
      loaded: true,
      totalWords: words.length,
      chart: buildChart(trend, avgStudy),
      avgText: avgStudy.toFixed(1),
      metrics: [
        { value: todayStudyCount, label: '今日学习' },
        {
          value: `${Math.round(todayAccuracy)}%`,
          label: '今日正确率',
          trend: todayAccuracy >= 70 ? 'up' : todayAccuracy >= 50 ? 'flat' : 'down',
        },
        { value: words.length, label: '词库总量' },
      ],
      difficultWords: top,
      milestones: [
        {
          key: 'words',
          icon: 'book-check-outline',
          label: `已学习 ${words.length} 个单词`,
          hint: '累计收录的生词量',
          achieved: words.length >= 10,
        },
        {
          key: 'mastered',
          icon: 'check-decagram-outline',
          label: `已掌握 ${masteredWords} 个单词`,
          hint: '历史正确率 ≥ 80%',
          achieved: masteredWords >= 5,
        },
        {
          key: 'accuracy',
          icon: 'fire',
          label: `今日正确率 ${Math.round(todayAccuracy)}%`,
          hint: '目标 ≥ 90%',
          achieved: todayAccuracy >= 90,
        },
      ],
    });
  },

  openWord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${id}` });
  },

  reinforce() {
    const ids = this.data.difficultWords.map((d) => d.id).filter(Boolean);
    if (ids.length === 0) return;
    wx.navigateTo({ url: `/pages/study/study?wordIds=${ids.join(',')}` });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
