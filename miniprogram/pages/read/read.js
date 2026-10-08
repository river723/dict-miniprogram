/**
 * 阅读首页 —— 对齐 memo-grad ReadHomeScreen。
 * 结构：Hero（阅读中心 · 系列故事 / 趣味文章 两段统计）+ 段切换 + 对应列表。
 * 系列故事来自 content 云函数（索引 + 章节）；趣味文章来自本地 StorageService。
 */
import { callCloud } from '../../services/cloud';
import StorageService from '../../services/storage';
import { applyTheme } from '../../utils/theme';
import { clearStoryCache } from '../../utils/story';

/**
 * 故事章节主题 → 中文标签。
 * ⚠️ 这里的 key 必须跟着「系列故事」数据源走：换故事（如从科幻换成市井题材）时，
 *    theme 取值会整体变化，不同步更新的话列表与详情页会直接显示英文 key。
 *
 * 三代故事集的 key 并存（按新增顺序写，旧的保留以便回滚）：
 *   1. 星际漫游者（英文 key）
 *   2. 南苑九十天（英文 key）
 *   3. 烟火故事集（**中文 key** —— 新版数据 genre 本身就是中文题材名，
 *      如「庭审悬疑」「医疗温情」。此时 THEME_LABELS 起「原样透传」作用：
 *      有映射就用映射值，没映射则 read.js 回落显示原值（c.theme），中文 key 天然可读，
 *      所以这里不再逐个列举中文 key，保持表精简。）
 */
const THEME_LABELS = {
  // —— 当前故事集（烟火故事集 / anthology）—— 中文 genre 直接透传，无需映射 ——

  // —— 上一版故事集（南苑九十天）——
  sliceOfLife: '日常',
  daily: '日常',
  governance: '治理',
  government: '治理',
  family: '家庭',
  education: '教育',
  food: '饮食',
  memory: '记忆',
  emotion: '情感',
  social: '社交',
  society: '社会',
  morality: '道德',
  nature: '自然',
  art: '艺术',
  action: '行动',
  commerce: '商业',
  law: '法律',
  // —— 旧故事集（星际漫游者）保留，防止回滚时丢标签 ——
  adventure: '冒险',
  mystery: '悬疑',
  fantasy: '奇幻',
  sciFi: '科幻',
  romance: '浪漫',
  history: '历史',
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
    applyTheme(this);
    this.loadArticles();
    // 数据初始化页导入 / 清空过故事内容时，页面 data 还是旧的
    // （onShow 本来不重新拉故事），这里看到标记就刷一次并清掉。
    try {
      if (wx.getStorageSync('mg_story_dirty')) {
        wx.removeStorageSync('mg_story_dirty');
        this.loadStories();
      }
    } catch (e) {
      /* 读不到标记就按没有处理 */
    }
  },

  onPullDownRefresh() {
    // 手动下拉 = 用户明确「我要最新」：连 utils/story.js 里那份模块级缓存也一起清掉，
    // 否则章节详情页（story-read）拿到的仍是本次会话早期缓存的旧正文。
    clearStoryCache();
    Promise.all([this.loadStories(), this.loadArticles()]).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
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
