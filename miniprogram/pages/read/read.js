/**
 * 阅读首页 —— 对齐 memo-grad ReadHomeScreen。
 * 结构：Hero（阅读中心 · 系列故事 / 趣味文章 两段统计）+ 段切换 + 对应列表。
 * 系列故事来自 content 云函数（索引 + 章节）；趣味文章来自本地 StorageService。
 */
import { callCloud } from '../../services/cloud';
import StorageService from '../../services/storage';

const THEME_LABELS = {
  adventure: '冒险',
  mystery: '悬疑',
  fantasy: '奇幻',
  sciFi: '科幻',
  romance: '浪漫',
  history: '历史',
  nature: '自然',
  random: '随机',
  technology: '科技',
  life: '生活',
  science: '科学',
};

/** 「今天 / 昨天 / N 天前 / M月D日」。 */
function relDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

Page({
  data: {
    active: 'story',

    heroChapters: 0,
    heroWords: 0,
    articleCount: 0,
    readArticles: 0,
    progressPct: 0,

    storyLoading: true,
    chapters: [],

    articles: [],
  },

  onLoad() {
    this.loadStories();
  },

  onShow() {
    this.loadArticles();
  },

  onPullDownRefresh() {
    Promise.all([this.loadStories(), this.loadArticles()]).finally(() => wx.stopPullDownRefresh());
  },

  async loadStories() {
    this.setData({ storyLoading: true });
    try {
      const res = await callCloud('content', { action: 'storyList' });
      const raw = res.list || [];
      const chapters = raw.map((c, i) => ({
        chapterId: c.chapterId != null ? c.chapterId : c.id != null ? c.id : i + 1,
        title: c.title || `第 ${i + 1} 章`,
        wordCount: c.wordCount || c.word_count || 0,
        themeLabel: c.theme ? (THEME_LABELS[c.theme] || c.theme) : '',
      }));
      const totalWords = chapters.reduce((s, c) => s + (c.wordCount || 0), 0);
      this.setData({
        storyLoading: false,
        chapters,
        heroChapters: (res.series && (res.series.total_chapters || res.series.totalChapters)) || chapters.length,
        heroWords: totalWords,
      });
    } catch (e) {
      console.warn('[read] 故事索引加载失败', e);
      this.setData({ storyLoading: false, chapters: [], heroChapters: 0, heroWords: 0 });
    }
  },

  loadArticles() {
    const list = StorageService.getArticles()
      .slice()
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .map((a) => ({
        id: a.id,
        title: a.title,
        preview: String(a.content || '').replace(/\*\*/g, '').slice(0, 120),
        dateText: relDate(a.created_at),
        readCount: a.read_count || 0,
        themeLabel: a.theme ? (THEME_LABELS[a.theme] || a.theme) : '',
        words: (a.words || []).slice(0, 4),
        moreWords: Math.max(0, (a.words || []).length - 4),
      }));
    const readArticles = list.filter((a) => a.readCount > 0).length;
    this.setData({
      articles: list,
      articleCount: list.length,
      readArticles,
      progressPct: list.length > 0 ? Math.round((readArticles / list.length) * 100) : 0,
    });
  },

  switchSeg(e) {
    const key = e.currentTarget.dataset.key;
    if (key !== this.data.active) this.setData({ active: key });
  },

  openChapter(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/story-read/story-read?id=${id}` });
  },

  openArticle(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/article-read/article-read?id=${id}` });
  },

  async askDeleteArticle(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.articles.find((a) => a.id === id);
    if (!item) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '确认删除',
        content: `确定要删除文章「${item.title}」吗？删除后无法恢复。`,
        confirmText: '删除',
        cancelText: '取消',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    await StorageService.deleteArticle(id);
    this.loadArticles();
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  goGenerate() {
    wx.navigateTo({ url: '/pages/article-generate/article-generate' });
  },
});
