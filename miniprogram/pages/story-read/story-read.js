/**
 * 故事章节详情 —— 对齐 memo-grad StoryDetailScreen。
 *
 * Hero（第 N 章 / 标题 / 词数 + 目标词数 / 译文切换）→ 正文（中英对照，点击高亮生词弹释义）
 * → 底部 上一章 / 下一章。
 *
 * 高亮词释义优先取本机生词本，生词本里没有时回落到云端词库查询（App 是查打包的本地词典，
 * 小程序为避免主包超限把词典放云端，故用一次查询替代）。
 */
import { getStoryChapter, getAdjacentChapterIds, buildBilingualPairs, buildSegments } from '../../utils/story';
import StorageService from '../../services/storage';
import { searchWorddict } from '../../services/worddict';

const THEME_LABELS = {
  adventure: '冒险',
  mystery: '悬疑',
  fantasy: '奇幻',
  sciFi: '科幻',
  romance: '浪漫',
  history: '历史',
  nature: '自然',
  random: '随机',
};

Page({
  data: {
    loading: true,
    missing: false,
    chapter: null,
    paragraphs: [],
    showTranslation: false,
    hasPrev: false,
    hasNext: false,
    showWord: false,
    modalWord: null,
  },

  onLoad(options) {
    this.chapterId = options.id || options.chapterId || '';
    this.load();
  },

  async load() {
    this.setData({ loading: true, missing: false, showTranslation: false });
    try {
      const [chapter, adjacent] = await Promise.all([
        getStoryChapter(this.chapterId),
        getAdjacentChapterIds(this.chapterId).catch(() => ({})),
      ]);
      if (!chapter) {
        this.setData({ loading: false, missing: true });
        return;
      }

      const words = chapter.words || [];
      const paragraphs = buildSegments(buildBilingualPairs(chapter.content, chapter.translation), words)
        .filter((p) => p.en || p.zh);

      const map = {};
      StorageService.getWords().forEach((w) => {
        map[String(w.word).toLowerCase()] = w;
      });
      this.wordMap = map;

      this.setData({
        loading: false,
        chapter: {
          id: chapter.id,
          title: chapter.title || '',
          themeLabel: THEME_LABELS[chapter.theme] || '',
          summary: chapter.summary || '',
          wordCount: chapter.word_count || 0,
          targetCount: words.length,
          hasTranslation: !!chapter.translation,
        },
        paragraphs,
        hasPrev: adjacent.prev !== undefined,
        hasNext: adjacent.next !== undefined,
      });
      this.prevId = adjacent.prev;
      this.nextId = adjacent.next;

      if (chapter.title) wx.setNavigationBarTitle({ title: chapter.title });
    } catch (err) {
      console.warn('[story-read] 拉取章节失败：', err);
      this.setData({ loading: false, missing: true });
    }
  },

  toggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  // ---------- 生词释义 ----------
  async tapWord(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    const lower = String(word).toLowerCase();
    const local = this.wordMap[lower];

    const build = (src, fromCloud) => {
      const defs = src.definitions || [];
      return {
        word: src.word || word,
        phonetic: src.pronunciation_uk || src.pronunciation_us || src.phonetic || '',
        meaning: defs.length
          ? defs.map((d) => `${d.part_of_speech || ''} ${d.meaning || ''}`.trim()).join('\n')
          : '暂无释义',
        example: (defs[0] && defs[0].example) || '',
        etymology: src.etymology || '',
        memoryTip: src.memory_tip || src.memoryTip || '',
        fromCloud,
      };
    };

    if (local) {
      this.setData({ showWord: true, modalWord: build(local, false) });
      return;
    }

    wx.showLoading({ title: '查词中' });
    try {
      const res = await searchWorddict({ keyword: lower });
      const hit = (res.words || []).find((w) => String(w.word).toLowerCase() === lower);
      wx.hideLoading();
      if (!hit) {
        wx.showToast({ title: '词库中暂无该词', icon: 'none' });
        return;
      }
      this.setData({ showWord: true, modalWord: build(hit, true) });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '查询失败', icon: 'none' });
    }
  },

  closeWord() {
    this.setData({ showWord: false, modalWord: null });
  },

  // ---------- 章节切换 ----------
  goPrev() {
    if (this.prevId === undefined) return;
    wx.redirectTo({ url: `/pages/story-read/story-read?id=${this.prevId}` });
  },

  goNext() {
    if (this.nextId === undefined) return;
    wx.redirectTo({ url: `/pages/story-read/story-read?id=${this.nextId}` });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/read/read' }) });
  },
});
