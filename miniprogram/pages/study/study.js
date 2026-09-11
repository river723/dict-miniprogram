import { getDueReviewWords, getTodayNewWords, getMasteryStats } from '../../services/studyPlan';
import StorageService from '../../services/storage';
import { fillTodayIfNeeded } from '../../services/autoWord';
import { formatDate } from '../../utils/util';

Page({
  data: {
    loading: true,
    dueCount: 0,
    newCount: 0,
    totalWords: 0,
    masteredWords: 0,
    todayStudied: 0,
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    await StorageService.pullAll();
    await fillTodayIfNeeded();
    const due = getDueReviewWords();
    const news = getTodayNewWords();
    const stats = getMasteryStats();
    const today = formatDate();
    const todayStudied = StorageService.getStudyRecords().filter((r) => r.study_date === today).length;
    this.setData({ loading: false, dueCount: due.length, newCount: news.length, ...stats, todayStudied });
  },

  goReview() { wx.navigateTo({ url: '/pages/review/review?mode=review' }); },
  goNew() { wx.navigateTo({ url: '/pages/review/review?mode=new' }); },
  goStats() { wx.navigateTo({ url: '/pages/stats/stats' }); },
});
