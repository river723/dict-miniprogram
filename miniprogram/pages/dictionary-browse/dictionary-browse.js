/**
 * 词库浏览 / 查询 —— 对齐 memo-grad DictionaryBrowseScreen。
 *
 * 平台适配（重要）：
 *  App 一次性把 4801 词读进内存，本地做搜索/筛选/排序/虚拟列表。
 *  小程序单次响应上限 1MB，无法整包拉取，因此：
 *   - 默认视图改为「按字母分页」：底部 A–Z 索引条切换首字母，每次只取该字母的词；
 *   - 搜索走服务端 keyword 查询（释义不参与检索，与云函数能力一致）；
 *   - 筛选（难度/考频）与排序在「当前已载入的这一批」上本地生效，语义与 App 一致。
 *
 * 雅思词库（clientSide）双数据源：
 *   - 云端富词条集合（worddict_ielts）齐活时整体走云端：行内带释义/音标/难度/考频，
 *     筛选 chip 与考研库体验一致；
 *   - 云端没导入 / 不齐 / 单次请求失败时整体回落本地词条（{w,ph,d}，离线可用）。
 *   ⚠️ 不许半云端半本地混排：同一列表两种行样式、筛选时灵时不灵，用户会以为出 bug。
 *     是否切云端由「云端 count ≥ 本地词条数」一次性决定（ensureLocalCloudDecision）。
 */
import { searchWorddict, countWorddict } from '../../services/worddict';
import { getLibrary, getLibraryEntries } from '../../services/libraries';
import { applyTheme } from '../../utils/theme';

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

const fmtNum = (n) => String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 确定性洗牌（与 App seededShuffle 同思路，避免依赖 Math.random 结果不稳定）。 */
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function toRow(entry, cloud) {
  // 云端词条形如 {word, definitions[], phonetic_uk, difficulty, frequency}；
  // 本地词条形如 {w, ph, d, f, k}（f/k = 考频/难度，见 gen_ielts_js.cjs）
  const isLocalEntry = !cloud && entry && entry.w !== undefined;
  const word = isLocalEntry ? entry.w : entry.word;
  const cloudDef = !isLocalEntry && entry.definitions && entry.definitions[0] && entry.definitions[0].meaning;
  const meaning = isLocalEntry ? (entry.d || '') : (cloudDef || '');
  const ph = isLocalEntry ? (entry.ph || '') : (entry.phonetic_uk || entry.pronunciation_uk || '');
  // 归一到 difficulty/frequency：本地用短字段名 f/k，避免 toRow 里出现两套取值分支
  const rawDiff = isLocalEntry ? entry.k : entry.difficulty;
  const rawFreq = isLocalEntry ? entry.f : entry.frequency;
  const level = Math.max(1, Math.min(5, rawDiff || 3));
  return {
    key: String(word).toLowerCase(),
    word,
    meaning,
    ph,
    // 本地词条全部带释义；万一某条缺失也不刷「暂无释义」，降级为「本地词」标签
    isLocal: !!isLocalEntry,
    stars: pad5(level, '★'),
    squares: pad5(rawFreq, '■'),
    diffColor: DIFF_COLORS[level - 1],
    difficulty: level,
    frequency: rawFreq || 0,
  };
}

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    dictId: 'all',
    dictName: '考研核心词库',
    localMode: false,
    cloudBatch: false,
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
    const dictId = (options && options.dictId) || 'all';
    const lib = getLibrary(dictId);
    const localMode = !!lib.clientSide;
    this.localEntries = localMode ? (getLibraryEntries(dictId) || []) : null;
    this.setData({ dictId, dictName: lib.name, localMode, cloudBatch: !localMode });
    this.raw = [];
    this.loadLetter('A');
  },

  async loadLetter(letter) {
    this.setData({ loading: true, letter, query: '', hitText: '' });
    const L = String(letter).toLowerCase();

    if (this.data.localMode) {
      // 雅思：云端富词条齐活才整体切云端，否则整体用本地（见文件头说明）
      const useCloud = await this.ensureLocalCloudDecision();
      if (useCloud) {
        try {
          const res = await searchWorddict({ prefix: L, lib: this.data.dictId });
          this.raw = res.words || [];
          this.setData({ loading: false });
          this.apply();
          return;
        } catch (e) {
          console.error('[dictionary-browse] 云端按字母加载失败，本轮回落本地', e);
          // 回落本地必须把 cloudBatch 置回 false，否则本地词条会被当云端行渲染
          this.raw = (this.localEntries || []).filter((e) => String(e.w)[0].toLowerCase() === L);
          this.setData({ loading: false, cloudBatch: false });
          this.apply();
          return;
        }
      }
      this.raw = (this.localEntries || []).filter((e) => String(e.w)[0].toLowerCase() === L);
      this.setData({ loading: false, cloudBatch: false });
      this.apply();
      return;
    }

    try {
      const res = await searchWorddict({ prefix: L, lib: this.data.dictId });
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

  /**
   * 本地词库（雅思）是否整体走云端：云端 count ≥ 本地词条数才切。
   * 一次决定整个页面的生命周期（含状态栏总数），结果缓存在 this._localUseCloud。
   */
  async ensureLocalCloudDecision() {
    if (this._localUseCloud !== undefined) return this._localUseCloud;
    let total = 0;
    try {
      total = await countWorddict(this.data.dictId);
    } catch (e) {
      total = 0;
    }
    const localCount = (this.localEntries || []).length;
    const use = total >= localCount && localCount > 0;
    this._localUseCloud = use;
    this.setData({ cloudBatch: use, totalText: fmtNum(total > 0 ? total : localCount) });
    return use;
  },

  async runSearch(q) {
    if (!q) {
      this.loadLetter(this.data.letter);
      return;
    }
    if (this.data.localMode) {
      const useCloud = await this.ensureLocalCloudDecision();
      if (useCloud) {
        this.setData({ loading: true });
        try {
          const res = await searchWorddict({ keyword: q, lib: this.data.dictId });
          this.raw = res.words || [];
          this.setData({ loading: false });
          this.apply();
          return;
        } catch (e) {
          console.error('[dictionary-browse] 云端搜索失败，本轮回落本地', e);
          // 同 loadLetter：回落本地要把 cloudBatch 置回 false
          const kw = String(q).toLowerCase();
          this.raw = (this.localEntries || []).filter((e) => String(e.w).toLowerCase().includes(kw));
          this.setData({ loading: false, cloudBatch: false });
          this.apply();
          return;
        }
      }
      const kw = String(q).toLowerCase();
      this.raw = (this.localEntries || []).filter((e) => String(e.w).toLowerCase().includes(kw));
      this.setData({ loading: false, cloudBatch: false });
      this.apply();
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await searchWorddict({ keyword: q, lib: this.data.dictId });
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
    const { sortMode, diffFilter, freqFilter, shuffleSeed, cloudBatch } = this.data;

    // ⚠ 必须先经 toRow 归一再筛/排：原始行两种形态并存
    //   云端 {word, difficulty, frequency} / 本地 {w, k, f}（考频/难度是短字段名）。
    //   直接对原始行读 difficulty 会让本地行全部落空 → 筛选出空列表（踩过一次）。
    let list = (this.raw || []).map((e) => toRow(e, cloudBatch));

    // 难度/考频筛选：云端与本地词库都有真实值（本地 f/k 由 relabel 脚本按语料算出），
    // 所以词库列表一律可筛——早期「本地没有这两个字段」的限制已失效。
    if (diffFilter !== null) list = list.filter((e) => e.difficulty === diffFilter);
    if (freqFilter !== null) list = list.filter((e) => e.frequency === freqFilter);

    const wordOf = (e) => String(e.word || '').toLowerCase();

    if (sortMode === 'diffAsc') list.sort((a, b) => a.difficulty - b.difficulty);
    else if (sortMode === 'diffDesc') list.sort((a, b) => b.difficulty - a.difficulty);
    else if (sortMode === 'freqAsc') list.sort((a, b) => a.frequency - b.frequency);
    else if (sortMode === 'freqDesc') list.sort((a, b) => b.frequency - a.frequency);
    else if (sortMode === 'shuffle') list = seededShuffle(list, shuffleSeed);
    else list.sort((a, b) => wordOf(a).localeCompare(wordOf(b)));

    this.setData({
      items: list,
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
    wx.navigateTo({
      url: `/pages/dictionary-word-detail/dictionary-word-detail?word=${encodeURIComponent(word)}&dictId=${encodeURIComponent(this.data.dictId)}`,
    });
  },
});
