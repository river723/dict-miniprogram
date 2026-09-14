/**
 * 文章阅读 —— 对齐 memo-grad ArticleDetailScreen。
 * Hero（主题 / 打开次数 / 标题）→ 生词标签 → 正文（中英对照，可切换译文）
 * → 点击高亮词弹释义 → 底部「重新生成 / 删除」。
 */
import StorageService from '../../services/storage';
import { callCloud } from '../../services/cloud';
import { parseArticle, markWords } from '../../utils/article';

const THEME_LABELS = {
  technology: '科技',
  life: '生活',
  history: '历史',
  nature: '自然',
  science: '科学',
  random: '随机',
};

/** 按换行切成段落，再按索引把中英配对（段数不等时以英文段号为准）。 */
function buildPairs(content, translation, words) {
  const en = String(content || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const zh = String(translation || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return en.map((line, i) => {
    const segs = markWords(line, words);
    return { en: line, segs, zh: zh[i] || (en.length === 1 ? zh.join(' ') : '') };
  });
}

Page({
  data: {
    loading: true,
    article: null,
    pairs: [],
    wordTags: [],
    showTranslation: false,
    regenerating: false,
    modalWord: null,
    showWord: false,
    showDelete: false,
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    this.load();
  },

  load() {
    const a = StorageService.getArticleById(this.id);
    if (!a) {
      this.setData({ loading: false, article: null });
      wx.showToast({ title: '文章不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }

    const words = a.words || [];
    const pairs = buildPairs(a.content, a.translation, words).map((p) => ({
      // en 必须带上：WXML 用 wx:if="{{para.en}}" 判断是否渲染英文段落
      en: p.en || '',
      segs: p.segs.map((s) => ({ text: s.text, hit: s.hit })),
      zh: p.zh,
    }));

    // 高亮词 -> 生词本里的词对象（点按弹释义）
    const map = {};
    StorageService.getWords().forEach((w) => { map[String(w.word).toLowerCase()] = w; });

    StorageService.markArticleRead(this.id);
    const readCount = (a.read_count || 0) + 1;

    this.setData({
      loading: false,
      article: {
        id: a.id,
        title: a.title,
        themeLabel: THEME_LABELS[a.theme] || a.theme || '随机',
        readCount,
        words,
        translation: a.translation || '',
      },
      pairs,
      wordTags: words,
    });
    this.wordMap = map;
  },

  toggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  tapWord(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    const w = this.wordMap[String(word).toLowerCase()];
    if (!w) {
      wx.showToast({ title: '该词不在生词本中', icon: 'none' });
      return;
    }
    const defs = w.definitions || [];
    this.setData({
      showWord: true,
      modalWord: {
        word: w.word,
        phonetic: w.pronunciation_uk || w.pronunciation_us || '',
        meaning: defs.length ? defs.map((d) => `${d.part_of_speech || ''} ${d.meaning}`).join('\n') : '暂无释义',
        example: (defs[0] && defs[0].example) || '',
        etymology: w.etymology || '',
        memoryTip: w.memory_tip || '',
      },
    });
  },

  closeWord() {
    this.setData({ showWord: false, modalWord: null });
  },

  async regenerate() {
    const a = this.data.article;
    if (!a || this.data.regenerating) return;
    this.setData({ regenerating: true });
    try {
      const res = await callCloud('ai', {
        action: 'story',
        words: a.words,
        theme: '',
        length: 200,
        withTitle: true,
      });
      const parsed = parseArticle(res.content || '', a.words);
      const content = parsed.body;
      await StorageService.updateArticle(a.id, {
        title: parsed.title || a.title,
        content,
        translation: parsed.translation,
      });
      this.setData({ regenerating: false });
      this.load();
      wx.showToast({ title: '已重新生成', icon: 'success' });
    } catch (e) {
      console.error('[article-read] 重新生成失败', e);
      this.setData({ regenerating: false });
      wx.showToast({ title: '重新生成失败，请重试', icon: 'none' });
    }
  },

  askDelete() {
    this.setData({ showDelete: true });
  },

  cancelDelete() {
    this.setData({ showDelete: false });
  },

  async confirmDelete() {
    await StorageService.deleteArticle(this.id);
    this.setData({ showDelete: false });
    wx.showToast({ title: '已删除', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  },
});
