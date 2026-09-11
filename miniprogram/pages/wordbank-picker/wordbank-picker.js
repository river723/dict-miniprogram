/**
 * 从词库选词 —— 对齐 memo-grad WordbankPickerScreen。
 *
 * 平台适配：App 一次载入全部 4801 词再内存分页；小程序链路单次响应上限 1MB，
 * 因此改为「由云函数 pick 按组下发」——每组 10 词，上一组/下一组切换 seed，
 * 语义与 App 的「第 X/Y 组」一致；搜索走服务端正则查询。
 */
import StorageService from '../../services/storage';
import { pickWorddict, searchWorddict } from '../../services/worddict';

const PAGE_SIZE = 10;
const DIFF_COLORS = { 1: '#3F7A5C', 2: '#C2603A', 3: '#C2603A', 4: '#B5462E', 5: '#B5462E' };

const SORT_OPTIONS = [
  { value: 'shuffle', label: '乱序' },
  { value: 'alpha', label: '字母' },
  { value: 'diffAsc', label: '难度↑' },
  { value: 'diffDesc', label: '难度↓' },
  { value: 'freqAsc', label: '考频↑' },
  { value: 'freqDesc', label: '考频↓' },
];

const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));
const squares = (n) => '■'.repeat(Math.max(0, Math.min(5, n))) + '□'.repeat(5 - Math.max(0, Math.min(5, n)));

function toRow(entry, selectedKeys) {
  const def = (entry.definitions || [])[0] || {};
  const key = String(entry.word).toLowerCase();
  const diff = Math.max(1, Math.min(5, entry.difficulty || 3));
  const freq = Math.max(0, Math.min(5, entry.frequency || 0));
  return {
    key,
    word: entry.word,
    phonetic: entry.pronunciation_uk || entry.pronunciation_us || '',
    meaning: def.meaning || '暂无释义',
    stars: stars(entry.difficulty),
    squares: squares(entry.frequency),
    diffColor: DIFF_COLORS[diff],
    selected: selectedKeys.indexOf(key) >= 0,
  };
}

Page({
  data: {
    loading: true,
    saving: false,
    query: '',

    items: [],
    poolCount: 0,
    group: 0,
    isLast: false,

    selectedCount: 0,
    existingCount: 0,
    ignoredCount: 0,
    allInGroupSelected: false,

    sortMode: 'shuffle',
    sortLabel: '乱序',
    showSort: false,
    sortOptions: SORT_OPTIONS,

    emptyIcon: 'book-multiple',
    emptyText: '本组没有候选词',
    emptyHint: '试试调整筛选条件',
  },

  onLoad() {
    this.selected = {};
    this.seedBase = Number(String(Date.now()).slice(-6));
    this.group = 0;
    this.groupWords = [];
    this.loadGroup(0);
  },

  onShow() {
    this.refreshCounts();
  },

  /** 词本已有 / 已忽略 数量。 */
  refreshCounts() {
    const existing = StorageService.getWordbookKeysIncludingDeleted();
    const ignored = StorageService.getIgnoredWordbankWords();
    this.setData({ existingCount: existing.size, ignoredCount: ignored.length });
  },

  async loadGroup(group) {
    this.setData({ loading: true });
    this.group = group;
    try {
      const existing = Array.from(StorageService.getWordbookKeysIncludingDeleted());
      const ignored = StorageService.getIgnoredWordbankWords();
      const res = await pickWorddict({
        exclude: existing,
        ignored,
        limit: PAGE_SIZE,
        seed: this.seedBase + group,
      });
      const words = res.words || [];
      this.groupWords = words;
      const selectedKeys = Object.keys(this.selected);
      this.setData({
        loading: false,
        group,
        poolCount: Number(res.candidates) || words.length,
        isLast: words.length < PAGE_SIZE,
        items: this.sortRows(words.map((w) => toRow(w, selectedKeys))),
        allInGroupSelected: words.length > 0 && words.every((w) => this.selected[String(w.word).toLowerCase()]),
        emptyIcon: 'book-multiple',
        emptyText: words.length === 0 ? '已浏览完所有候选词' : '本组没有候选词',
        emptyHint: words.length === 0 ? '可调整每日词量或去生词本查看' : '试试调整筛选条件',
      });
      this.refreshCounts();
    } catch (e) {
      console.error('[wordbank-picker] 加载失败', e);
      this.setData({ loading: false, items: [], emptyText: '加载失败，请稍后重试', emptyHint: '' });
    }
  },

  sortRows(rows) {
    const mode = this.data.sortMode;
    const list = rows.slice();
    if (mode === 'alpha') list.sort((a, b) => a.word.localeCompare(b.word));
    else if (mode === 'diffAsc') list.sort((a, b) => a.stars.length - b.stars.length);
    else if (mode === 'diffDesc') list.sort((a, b) => b.stars.length - a.stars.length);
    else if (mode === 'freqAsc') list.sort((a, b) => a.squares.length - b.squares.length);
    else if (mode === 'freqDesc') list.sort((a, b) => b.squares.length - a.squares.length);
    return list;
  },

  // ---------- 搜索 ----------
  onSearch(e) {
    const query = e.detail.value;
    this.setData({ query });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.runSearch(query), 250);
  },

  clearSearch() {
    this.setData({ query: '' });
    this.loadGroup(0);
  },

  async runSearch(query) {
    const q = String(query || '').trim();
    if (!q) {
      this.loadGroup(0);
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await searchWorddict({ keyword: q });
      const existing = StorageService.getWordbookKeysIncludingDeleted();
      const ignored = StorageService.getIgnoredWordbankWords();
      const words = (res.words || []).filter((w) => {
        const k = String(w.word).toLowerCase();
        return !existing.has(k) && ignored.indexOf(k) < 0;
      });
      this.groupWords = words.slice(0, 40);
      const selectedKeys = Object.keys(this.selected);
      const rows = this.groupWords.map((w) => toRow(w, selectedKeys));
      this.setData({
        loading: false,
        items: this.sortRows(rows),
        isLast: true,
        poolCount: rows.length,
        emptyIcon: 'magnify-close',
        emptyText: '没有找到匹配的单词',
        emptyHint: '试试其他搜索词',
        allInGroupSelected: rows.length > 0 && rows.every((r) => r.selected),
      });
    } catch (e) {
      this.setData({ loading: false, items: [], emptyIcon: 'magnify-close', emptyText: '搜索失败', emptyHint: '请稍后重试' });
    }
  },

  // ---------- 选择 ----------
  toggle(e) {
    const key = e.currentTarget.dataset.key;
    if (this.selected[key]) delete this.selected[key];
    else this.selected[key] = true;
    this.syncSelection();
  },

  toggleAll() {
    const all = this.data.allInGroupSelected;
    this.data.items.forEach((it) => {
      if (all) delete this.selected[it.key];
      else this.selected[it.key] = true;
    });
    this.syncSelection();
  },

  syncSelection() {
    const selectedKeys = Object.keys(this.selected);
    const items = this.data.items.map((it) => ({ ...it, selected: selectedKeys.indexOf(it.key) >= 0 }));
    this.setData({
      items,
      selectedCount: selectedKeys.length,
      allInGroupSelected: items.length > 0 && items.every((it) => it.selected),
    });
  },

  // ---------- 忽略 ----------
  ignoreOne(e) {
    const key = e.currentTarget.dataset.key;
    this.applyIgnore([key], '已忽略该单词');
  },

  async askIgnoreGroup() {
    const unselected = this.data.items.filter((it) => !it.selected).map((it) => it.key);
    if (unselected.length === 0) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '忽略本组未选词？',
        content: `将不再推荐本组未勾选的 ${unselected.length} 个单词`,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (confirm) this.applyIgnore(unselected, '已忽略本组未选词');
  },

  async applyIgnore(keys, tip) {
    const ignored = StorageService.getIgnoredWordbankWords().slice();
    keys.forEach((k) => { if (ignored.indexOf(k) < 0) ignored.push(k); });
    StorageService.saveIgnoredWordbankWords(ignored);
    keys.forEach((k) => { delete this.selected[k]; });
    wx.showToast({ title: tip, icon: 'none' });
    this.setData({ items: this.data.items.filter((it) => keys.indexOf(it.key) < 0) });
    this.syncSelection();
    this.refreshCounts();
  },

  async restoreIgnored() {
    if (this.data.ignoredCount === 0) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '恢复已忽略单词？',
        content: `将恢复 ${this.data.ignoredCount} 个已忽略单词的推荐`,
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    StorageService.saveIgnoredWordbankWords([]);
    wx.showToast({ title: '已恢复', icon: 'success' });
    this.refreshCounts();
  },

  // ---------- 分组 ----------
  prevGroup() {
    if (this.data.group <= 0) return;
    this.loadGroup(this.data.group - 1);
  },

  nextGroup() {
    if (this.data.isLast) return;
    this.loadGroup(this.data.group + 1);
  },

  // ---------- 排序 ----------
  openSort() {
    this.setData({ showSort: true });
  },

  closeSort() {
    this.setData({ showSort: false });
  },

  pickSort(e) {
    const value = e.currentTarget.dataset.value;
    const opt = SORT_OPTIONS.find((o) => o.value === value);
    this.setData({ sortMode: value, sortLabel: opt ? opt.label : '乱序', showSort: false });
    if (value === 'shuffle') {
      this.seedBase += 1;
      this.loadGroup(this.data.group);
    } else {
      this.setData({ items: this.sortRows(this.data.items) });
    }
  },

  // ---------- 加入生词本 ----------
  async addSelected() {
    const keys = Object.keys(this.selected);
    if (keys.length === 0 || this.data.saving) return;
    this.setData({ saving: true });

    const lookup = {};
    this.groupWords.forEach((w) => { lookup[String(w.word).toLowerCase()] = w; });

    let added = 0;
    let failed = 0;
    for (const k of keys) {
      const entry = lookup[k];
      if (!entry) continue;
      try {
        await StorageService.addWord({
          word: entry.word,
          definitions: entry.definitions || [],
          pronunciation_uk: entry.pronunciation_uk || '',
          pronunciation_us: entry.pronunciation_us || '',
          etymology: entry.etymology || '',
          memory_tip: entry.memory_tip || '',
          similar_words: entry.similar_words || [],
          difficulty: entry.difficulty || 3,
          frequency: entry.frequency || 1,
        });
        added += 1;
      } catch (e) {
        failed += 1;
      }
    }

    this.selected = {};
    this.setData({ saving: false, selectedCount: 0 });
    this.refreshCounts();

    wx.showModal({
      title: '完成',
      content: `成功加入 ${added} 个单词到生词本${failed ? `，${failed} 个失败` : ''}`,
      confirmText: '继续选词',
      cancelText: '返回',
      success: (res) => {
        if (res.confirm) this.loadGroup(this.data.group);
        else wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
      },
    });
  },
});
