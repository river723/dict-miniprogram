/**
 * 生成文章 —— 对齐 memo-grad ArticleGenerateScreen。
 * 结构：Hero → 文章参数（每篇生词 / 目标词数）→ 选择生词（智能推荐 / 手动选择）
 *      → 文章主题 → 生成状态 → 预览（高亮目标词 + 中文翻译）→ 重新生成 / 保存。
 *
 * 平台说明：AI 走 ai 云函数的 story action（DeepSeek 代理），参数 theme/length/withTitle 已扩展；
 * 若云函数尚未重新部署，仍可生成（旧提示词忽略参数，返回约 150 词无标题短文）。
 */
import StorageService from '../../services/storage';
import { callCloud } from '../../services/cloud';
import { parseArticle, markWords, recommendWords } from '../../utils/article';
import { applyTheme } from '../../utils/theme';

const THEMES = [
  { key: 'random', label: '随机', icon: 'shuffle' },
  { key: 'technology', label: '科技', icon: 'devices' },
  { key: 'life', label: '生活', icon: 'home' },
  { key: 'history', label: '历史', icon: 'history' },
  { key: 'nature', label: '自然', icon: 'nature' },
  { key: 'science', label: '科学', icon: 'flask' },
];

Page({
  data: {
    empty: false,

    allWords: [],
    selected: [],
    searchQuery: '',
    manualList: [],

    selectMode: 'smart',
    themes: THEMES,
    theme: 'random',

    articleWordCount: 10,
    articleLength: 200,

    generating: false,
    saving: false,
    error: '',

    preview: null, // { title, segments, translation }
  },

  onShow() {

    applyTheme(this);
    // 只在首次进入时按设置/生词本初始化；返回本页时不覆盖用户已调整的选词
    this.load(!this.inited);
    this.inited = true;
  },

  load(initSelection = true) {
    const settings = StorageService.getSettings();
    const words = StorageService.getWords();
    if (words.length === 0) {
      this.setData({ empty: true, allWords: [], selected: [] });
      return;
    }

    // 覆盖次数：统计已保存文章里每个词出现过几次
    const coverage = {};
    StorageService.getArticles().forEach((a) => {
      (a.words || []).forEach((w) => {
        const k = String(w).toLowerCase();
        coverage[k] = (coverage[k] || 0) + 1;
      });
    });

    // 历史正确率
    const records = StorageService.getStudyRecords();
    const accuracy = {};
    words.forEach((w) => {
      const rs = records.filter((r) => r.word_id === w.id);
      accuracy[w.id] = rs.length === 0 ? 1 : rs.filter((r) => r.result === 1).length / rs.length;
    });
    this.coverage = coverage;
    this.accuracy = accuracy;

    const count = Math.max(5, Math.min(30, settings.articleWordCount || 10));
    const length = Math.max(100, Math.min(1000, settings.articleLength || 200));
    const selected = (initSelection && this.data.selectMode === 'smart')
      ? recommendWords(words, coverage, accuracy, count)
      : this.data.selected;

    this.setData({
      empty: false,
      allWords: words,
      articleWordCount: count,
      articleLength: length,
      selected,
    });
    if (this.data.selectMode === 'manual') this.refreshManualList();
  },

  /** 手动模式下的候选词（带覆盖次数标签）。 */
  refreshManualList() {
    const q = String(this.data.searchQuery || '').trim().toLowerCase();
    const selectedKeys = new Set(this.data.selected.map((w) => w.id));
    const list = this.data.allWords
      .filter((w) => !q || String(w.word).toLowerCase().indexOf(q) >= 0)
      .map((w) => {
        const cov = (this.coverage && this.coverage[String(w.word).toLowerCase()]) || 0;
        return {
          id: w.id,
          word: w.word,
          selected: selectedKeys.has(w.id),
          covLabel: cov === 0 ? '首次' : cov === 1 ? '第2次' : `第${cov + 1}次`,
          covColor: cov === 0 ? 'var(--mg-success)' : cov === 1 ? 'var(--mg-warning)' : 'var(--mg-text-3)',
        };
      });
    this.setData({ manualList: list });
  },

  // ---------- 参数 ----------
  decWords() {
    const n = Math.max(5, this.data.articleWordCount - 1);
    if (n === this.data.articleWordCount) return;
    this.setData({ articleWordCount: n });
    StorageService.saveSettings({ articleWordCount: n });
    if (this.data.selectMode === 'smart') this.recommend();
  },

  incWords() {
    const n = Math.min(30, this.data.articleWordCount + 1);
    if (n === this.data.articleWordCount) return;
    this.setData({ articleWordCount: n });
    StorageService.saveSettings({ articleWordCount: n });
    if (this.data.selectMode === 'smart') this.recommend();
  },

  decLength() {
    const n = Math.max(100, this.data.articleLength - 50);
    this.setData({ articleLength: n });
    StorageService.saveSettings({ articleLength: n });
  },

  incLength() {
    const n = Math.min(1000, this.data.articleLength + 50);
    this.setData({ articleLength: n });
    StorageService.saveSettings({ articleLength: n });
  },

  // ---------- 选词 ----------
  switchSelectMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.selectMode) return;
    this.setData({ selectMode: mode, preview: null, error: '' });
    if (mode === 'smart') this.recommend();
    else this.refreshManualList();
  },

  recommend() {
    const selected = recommendWords(
      this.data.allWords,
      this.coverage || {},
      this.accuracy || {},
      this.data.articleWordCount
    );
    this.setData({ selected });
    if (this.data.selectMode === 'manual') this.refreshManualList();
  },

  onSearch(e) {
    this.setData({ searchQuery: e.detail.value });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.refreshManualList(), 200);
  },

  toggleWord(e) {
    const id = e.currentTarget.dataset.id;
    const selected = this.data.selected.slice();
    const idx = selected.findIndex((w) => w.id === id);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      if (selected.length >= this.data.articleWordCount) {
        wx.showToast({ title: `最多选 ${this.data.articleWordCount} 个`, icon: 'none' });
        return;
      }
      const w = this.data.allWords.find((x) => x.id === id);
      if (w) selected.push(w);
    }
    this.setData({ selected });
    this.refreshManualList();
  },

  replaceWord(e) {
    const id = e.currentTarget.dataset.id;
    const selectedIds = new Set(this.data.selected.map((w) => w.id));
    const candidate = this.data.allWords.find((w) => w.id !== id && !selectedIds.has(w.id));
    const selected = this.data.selected.slice();
    const idx = selected.findIndex((w) => w.id === id);
    if (candidate && idx >= 0) selected[idx] = candidate;
    else if (idx >= 0) selected.splice(idx, 1);
    this.setData({ selected });
  },

  pickTheme(e) {
    this.setData({ theme: e.currentTarget.dataset.key });
  },

  // ---------- 生成 ----------
  async generate() {
    const { selected, articleWordCount } = this.data;
    if (this.data.generating) return;
    if (selected.length < articleWordCount) {
      this.setData({ error: `需要选够 ${articleWordCount} 个生词才能生成文章，当前仅 ${selected.length} 个` });
      return;
    }
    this.setData({ generating: true, error: '', preview: null });
    try {
      const res = await callCloud('ai', {
        action: 'story',
        words: selected.map((w) => w.word),
        theme: this.data.theme,
        length: this.data.articleLength,
        withTitle: true,
      });
      const parsed = parseArticle(res.content || '', selected.map((w) => w.word));
      // 没有 ** 标记时按目标词兜底高亮
      const segments = parsed.segments.length > 0
        ? parsed.segments
        : markWords(parsed.body, selected.map((w) => w.word));
      this.setData({
        generating: false,
        preview: {
          title: parsed.title || '阅读短文',
          segments,
          translation: parsed.translation,
        },
      });
    } catch (e) {
      console.error('[article-generate] 生成失败', e);
      this.setData({ generating: false, error: e.message || '文章生成失败，请重试' });
    }
  },

  async save() {
    const p = this.data.preview;
    if (!p || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await StorageService.addArticle({
        title: p.title,
        content: p.segments.map((s) => s.text).join(''),
        translation: p.translation,
        words: this.data.selected.map((w) => w.word),
        word_ids: this.data.selected.map((w) => w.id),
        theme: this.data.theme,
      });
      this.setData({ saving: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/read/read' }) }), 500);
    } catch (e) {
      console.error('[article-generate] 保存失败', e);
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  goStudy() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
