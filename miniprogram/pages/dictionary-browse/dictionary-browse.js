/**
 * 词库浏览 / 查询 —— 对齐 memo-grad DictionaryBrowseScreen。
 *
 * 平台适配（重要）：
 * App 一次性把 4801 词读进内存，本地做搜索/筛选/排序/虚拟列表。
 * 小程序单次响应上限 1MB，无法整包拉取，因此：
 *   - 默认视图改为「按字母分页」：底部 A–Z 索引条切换首字母，每次只取该字母的词；
 *   - 搜索走服务端 keyword 查询（释义不参与检索，与云函数能力一致）；
 *   - 筛选（难度/考频）与排序在「当前已载入的这一批」上本地生效，语义与 App 一致。
 */
import { searchWorddict, pickWorddict } from '../../services/worddict';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const SORT_OPTIONS = [
  { value: 'alpha', label: '字母' },
  { value: 'diffAsc', label: '难度↑' },
  { value: 'diffDesc', label: '难度↓' },
  { value: 'freqAsc', label: '考频↑' },
  { value: 'freqDesc', label: '考频↓' },
  { value: 'shuffle', label: '乱序' },
];

const DIFF_OPTIONS = [
  { value: null, label: '全部' },
  { value: 1, label: '1★' },
  { value: 2, label: '2★' },
  { value: 3, label: '3★' },
  { value: 4, label: '4★' },
  { value: 5, label: '5★' },
];

const FREQ_OPTIONS = [
  { value: null, label: '全部' },
  { value: 1, label: '1■' },
  { value: 2, label: '2■' },
  { value: 3, label: '3■' },
  { value: 4, label: '4■' },
  { value: 5, label: '5■' },
];

const DIFF_COLORS = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];

const pad5 = (n, ch) => {
  const v = Math.max(0, Math.min(5, n || 0));
  return ch.repeat(v) + (ch === '★' ? '☆' : '□').repeat(5 - v);
};

/** 确定性洗牌（与 App seededShuffle 同思路，避免依赖 Math.random 结果不稳定）。 */
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function toRow(entry) {
  const level = Math.max(1, Math.min(5, entry.difficulty || 3));
  return {
    key: String(entry.word).toLowerCase(),
    word: entry.word,
    meaning: (entry.definitions || [])[0] && (entry.definitions || [])[0].meaning
      ? (entry.definitions || [])[0].meaning
      : '暂无释义',
    stars: pad5(entry.difficulty, '★'),
    squares: pad5(entry.frequency, '■'),
    diffColor: DIFF_COLORS[level - 1],
    difficulty: entry.difficulty || 3,
    frequency: entry.frequency || 0,
  };
}

Page({
  data: {
    dictId: 'local',
    dictName: '考研核心词库',
    totalText: '?',
    loading: true,

    letters: LETTERS,
    letter: 'A',
    query: '',

    items: [],
    hitText: '',

    sortMode: 'alpha',
    sortLabel: '字母',
    diffFilter: null,
    diffLabel: '难度',
    freqFilter: null,
    freqLabel: '考频',
    shuffleSeed: 1,

    showPicker: false,
    pickerTitle: '',
    pickerType: '',
    pickerOptions: [],
    pickerValue: null,
  },

  onLoad(options) {
    if (options && options.dictId) this.setData({ dictId: options.dictId });
    this.raw = [];
    this.loadTotal();
    this.loadLetter('A');
  },

  /** 全库词条数（status bar 展示）。 */
  async loadTotal() {
    try {
      const res = await pickWorddict({ limit: 1, seed: 1 });
      this.setData({ totalText: String(res.candidates || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') });
    } catch (e) {
      this.setData({ totalText: '?' });
    }
  },

  async loadLetter(letter) {
    this.setData({ loading: true, letter, query: '', hitText: '' });
    try {
      const res = await searchWorddict({ prefix: String(letter).toLowerCase() });
      this.raw = res.words || [];
      this.setData({ loading: false });
      this.apply();
    } catch (e) {
      console.error('[dictionary-browse] 按字母加载失败', e);
      this.raw = [];
      this.setData({ loading: false, items: [], hitText: '' });
      wx.showToast({ title: '词库加载失败，请稍后重试', icon: 'none' });
    }
  },

  async runSearch(q) {
    if (!q) {
      this.loadLetter(this.data.letter);
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await searchWorddict({ keyword: q });
      this.raw = res.words || [];
      this.setData({ loading: false });
      this.apply();
    } catch (e) {
      console.error('[dictionary-browse] 搜索失败', e);
      this.raw = [];
      this.setData({ loading: false, items: [], hitText: '0' });
    }
  },

  /** 本地筛选 + 排序（作用于当前已载入的一批）。 */
  apply() {
    const { sortMode, diffFilter, freqFilter, shuffleSeed } = this.data;
    let list = (this.raw || []).slice();

    if (diffFilter !== null) list = list.filter((e) => (e.difficulty || 0) === diffFilter);
    if (freqFilter !== null) list = list.filter((e) => (e.frequency || 0) === freqFilter);

    if (sortMode === 'diffAsc') list.sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0));
    else if (sortMode === 'diffDesc') list.sort((a, b) => (b.difficulty || 0) - (a.difficulty || 0));
    else if (sortMode === 'freqAsc') list.sort((a, b) => (a.frequency || 0) - (b.frequency || 0));
    else if (sortMode === 'freqDesc') list.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    else if (sortMode === 'shuffle') list = seededShuffle(list, shuffleSeed);
    else list.sort((a, b) => String(a.word).toLowerCase().localeCompare(String(b.word).toLowerCase()));

    this.setData({
      items: list.map(toRow),
      hitText: this.data.query.trim() ? String(list.length) : '',
    });
  },

  // ---------- 搜索 ----------
  onSearch(e) {
    const query = e.detail.value;
    this.setData({ query });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.runSearch(String(query).trim().toLowerCase()), 250);
  },

  clearSearch() {
    this.setData({ query: '' });
    this.loadLetter(this.data.letter);
  },

  // ---------- 字母索引 ----------
  pickLetter(e) {
    const letter = e.currentTarget.dataset.letter;
    if (letter === this.data.letter && !this.data.query) return;
    this.loadLetter(letter);
  },

  // ---------- 排序 / 筛选 ----------
  openSort() {
    this.setData({
      showPicker: true,
      pickerTitle: '排序方式',
      pickerType: 'sort',
      pickerOptions: SORT_OPTIONS,
      pickerValue: this.data.sortMode,
    });
  },

  openDiff() {
    this.setData({
      showPicker: true,
      pickerTitle: '难度筛选',
      pickerType: 'diff',
      pickerOptions: DIFF_OPTIONS,
      pickerValue: this.data.diffFilter,
    });
  },

  openFreq() {
    this.setData({
      showPicker: true,
      pickerTitle: '考频筛选',
      pickerType: 'freq',
      pickerOptions: FREQ_OPTIONS,
      pickerValue: this.data.freqFilter,
    });
  },

  closePicker() {
    this.setData({ showPicker: false });
  },

  onPick(e) {
    const value = e.currentTarget.dataset.value;
    const type = this.data.pickerType;
    if (type === 'sort') {
      const opt = SORT_OPTIONS.find((o) => o.value === value);
      const patch = { sortMode: value, sortLabel: opt ? opt.label : '字母', showPicker: false };
      // 再点一次「乱序」也重新洗牌
      if (value === 'shuffle') patch.shuffleSeed = this.data.shuffleSeed + 1;
      this.setData(patch);
    } else if (type === 'diff') {
      const v = value === '' || value === undefined ? null : Number(value);
      const opt = DIFF_OPTIONS.find((o) => o.value === v);
      this.setData({ diffFilter: v, diffLabel: v === null ? '难度' : `难度:${opt.label}`, showPicker: false });
    } else {
      const v = value === '' || value === undefined ? null : Number(value);
      const opt = FREQ_OPTIONS.find((o) => o.value === v);
      this.setData({ freqFilter: v, freqLabel: v === null ? '考频' : `考频:${opt.label}`, showPicker: false });
    }
    this.apply();
  },

  openWord(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;
    wx.navigateTo({ url: `/pages/dictionary-word-detail/dictionary-word-detail?word=${encodeURIComponent(word)}` });
  },
});
