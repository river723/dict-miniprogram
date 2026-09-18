/**
 * 生词本 —— 对齐 memo-grad WordListScreen。
 * 搜索 / 排序（最近·字母·难度·考频）/ 筛选（难度·考频）/ 列表项含星标、释义、核心与熟词僻义标签、
 * 词根预览、考频条、删除；底部悬浮「添加生词」。
 */
import StorageService from '../../services/storage';
import { applyTheme } from '../../utils/theme';

const SORT_OPTIONS = [
  { value: 'recent', label: '最近' },
  { value: 'alpha', label: '字母' },
  { value: 'diffAsc', label: '难度↑' },
  { value: 'diffDesc', label: '难度↓' },
  { value: 'freqAsc', label: '考频↑' },
  { value: 'freqDesc', label: '考频↓' },
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

const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, n || 0))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n || 0)));
const squares = (n) => '■'.repeat(Math.max(0, Math.min(5, n || 0))) + '□'.repeat(5 - Math.max(0, Math.min(5, n || 0)));

const DIFF_COLORS = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];

function decorate(w) {
  const def = (w.definitions || [])[0] || {};
  const freq = Math.max(0, Math.min(5, w.frequency || 0));
  const level = Math.max(1, Math.min(5, w.difficulty || 1));
  return {
    id: w.id,
    word: w.word,
    meaning: def.meaning || '暂无释义',
    isCore: !!def.is_core,
    isRare: !!def.is_rare_sense,
    etymology: w.etymology || '',
    stars: stars(w.difficulty),
    squares: squares(w.frequency),
    diffColor: DIFF_COLORS[level - 1],
    freqPercent: (freq / 5) * 100,
    freqColor: freq >= 4 ? '#3F7A5C' : freq >= 3 ? '#C2603A' : '#B5462E',
  };
}

Page({
  data: {
    loading: true,
    total: 0,
    query: '',
    list: [],

    sortMode: 'recent',
    sortLabel: '最近',
    diffFilter: null,
    diffLabel: '难度',
    freqFilter: null,
    freqLabel: '考频',

    showPicker: false,
    pickerTitle: '',
    pickerType: '',
    pickerOptions: [],
    pickerValue: null,

    showDelete: false,
    deleteWord: null,
  },

  onShow() {

    applyTheme(this);
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    return StorageService.pullAll().then(() => {
      this.allWords = StorageService.getWords();
      this.setData({ loading: false, total: this.allWords.length });
      this.apply();
    });
  },

  apply() {
    const { query, sortMode, diffFilter, freqFilter } = this.data;
    const q = query.trim().toLowerCase();
    let list = (this.allWords || []).slice();

    if (q) list = list.filter((w) => String(w.word).toLowerCase().indexOf(q) >= 0);
    if (diffFilter !== null) list = list.filter((w) => (w.difficulty || 0) === diffFilter);
    if (freqFilter !== null) list = list.filter((w) => (w.frequency || 0) === freqFilter);

    list.sort((a, b) => {
      if (sortMode === 'alpha') return String(a.word).localeCompare(String(b.word));
      if (sortMode === 'diffAsc') return (a.difficulty || 0) - (b.difficulty || 0);
      if (sortMode === 'diffDesc') return (b.difficulty || 0) - (a.difficulty || 0);
      if (sortMode === 'freqAsc') return (a.frequency || 0) - (b.frequency || 0);
      if (sortMode === 'freqDesc') return (b.frequency || 0) - (a.frequency || 0);
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    this.setData({ list: list.map(decorate) });
  },

  onSearch(e) {
    this.setData({ query: e.detail.value });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.apply(), 250);
  },

  clearSearch() {
    this.setData({ query: '' });
    this.apply();
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
      this.setData({ sortMode: value, sortLabel: opt ? opt.label : '最近', showPicker: false });
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

  // ---------- 行操作 ----------
  openWord(e) {
    wx.navigateTo({ url: `/pages/word-detail/word-detail?id=${e.currentTarget.dataset.id}` });
  },

  askDelete(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((w) => w.id === id);
    if (!item) return;
    this.setData({ showDelete: true, deleteWord: item });
  },

  cancelDelete() {
    this.setData({ showDelete: false, deleteWord: null });
  },

  async confirmDelete() {
    const w = this.data.deleteWord;
    if (!w) return;
    await StorageService.deleteWord(w.id);
    this.setData({ showDelete: false, deleteWord: null, total: Math.max(0, this.data.total - 1) });
    this.allWords = StorageService.getWords();
    this.apply();
    wx.showToast({ title: '已删除', icon: 'success' });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add-word/add-word' });
  },
});
