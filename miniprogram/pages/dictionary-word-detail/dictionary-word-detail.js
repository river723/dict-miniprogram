/**
 * 词条详情（词库，只读）—— 对齐 memo-grad DictionaryWordDetailScreen。
 * 数据取自词库（云函数按关键词精确命中），不做写回补全；
 * 额外提供「加入生词本」入口，与生词本流程打通。
 */
import StorageService from '../../services/storage';
import { searchWorddict } from '../../services/worddict';
import { getLibrary, getLibraryWords } from '../../services/libraries';
import { applyTheme } from '../../utils/theme';
import { createTtsPlayer } from '../../utils/tts';

const DIFF_COLORS = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];

const pad5 = (n, ch) => {
  const v = Math.max(0, Math.min(5, n || 0));
  return ch.repeat(v) + (ch === '★' ? '☆' : '□').repeat(5 - v);
};

Page({
  data: {
    loading: true,
    word: null,
    stars: '',
    squares: '',
    diffColor: '#3F7A5C',
    definitions: [],
    soundEnabled: true,
    inWordbook: false,
    saving: false,
    showAdd: false,
    notFound: false,
    localOnly: false,
    libraryName: '',
  },

  onLoad(options) {
    this.key = decodeURIComponent((options && options.word) || '');
    const dictId = decodeURIComponent((options && options.dictId) || '');
    const lib = dictId ? getLibrary(dictId) : null;
    this.localMode = !!(lib && lib.clientSide);
    this.localDictId = dictId;
    this.load();
  },

  onShow() {

    applyTheme(this);
    if (this.data.word) this.refreshFlags();
  },

  async load() {
    if (!this.key) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ loading: true, localOnly: false, notFound: false });
    try {
      const res = await searchWorddict({ keyword: this.key });
      const list = res.words || [];
      const hit = list.find((w) => String(w.word).toLowerCase() === this.key.toLowerCase()) || list[0] || null;
      if (!hit) {
        // 云端未命中：若该词来自本地内置词库（如雅思纯词表），不应报"未找到"，
        // 而是渲染本地词条视图（单词可发音、可加生词本，仅暂无详细释义）。
        if (this.localMode && this.isInLocalLibrary(this.key)) {
          const lib = getLibrary(this.localDictId);
          this.setData({
            loading: false,
            notFound: false,
            localOnly: true,
            libraryName: lib ? lib.name : '',
            word: { word: this.key },
            definitions: [],
          });
          this.refreshFlags();
          return;
        }
        this.setData({ loading: false, notFound: true, word: null });
        return;
      }
      const level = Math.max(1, Math.min(5, hit.difficulty || 3));
      const definitions = (hit.definitions || []).map((d) => ({
        part_of_speech: d.part_of_speech || d.pos || '',
        meaning: d.meaning || '',
        example: d.example || '',
        is_core: !!d.is_core,
        is_rare_sense: !!d.is_rare_sense,
      }));
      const similar = Array.isArray(hit.similar_words)
        ? hit.similar_words.filter((s) => s && (s.word || s.description))
        : [];

      this.setData({
        loading: false,
        notFound: false,
        word: {
          word: hit.word,
          pronunciation_uk: hit.pronunciation_uk || '',
          pronunciation_us: hit.pronunciation_us || '',
          etymology: hit.etymology || '',
          memory_tip: hit.memory_tip || '',
          similar,
        },
        definitions,
        stars: pad5(hit.difficulty, '★'),
        squares: pad5(hit.frequency, '■'),
        diffColor: DIFF_COLORS[level - 1],
      });
      this.refreshFlags();
    } catch (e) {
      console.error('[dictionary-word-detail] 查询失败', e);
      this.setData({ loading: false, notFound: true });
      wx.showToast({ title: '词条加载失败', icon: 'none' });
    }
  },

  refreshFlags() {
    const key = this.key.toLowerCase();
    const keys = StorageService.getWordbookKeysIncludingDeleted();
    this.setData({
      inWordbook: keys.has ? keys.has(key) : false,
      soundEnabled: StorageService.getSettings().soundEnabled !== false,
    });
  },

  /** 该词是否属于当前本地内置词库（大小写不敏感）。 */
  isInLocalLibrary(word) {
    if (!this.localMode || !this.localDictId) return false;
    const list = getLibraryWords(this.localDictId) || [];
    const k = String(word).toLowerCase();
    return list.some((w) => String(w).toLowerCase() === k);
  },

  onUnload() {
    if (this.tts) this.tts.destroy();
  },

  playAudio() {
    const w = this.data.word;
    if (!w || !this.data.soundEnabled) return;
    if (!this.tts) {
      this.tts = createTtsPlayer({
        onError: (err) => {
          console.warn('[dictionary] 发音播放失败：', (err && err.errMsg) || err);
          wx.showToast({ title: '发音播放失败', icon: 'none' });
        },
      });
    }
    this.tts.play(w.word);
  },

  askAdd() {
    if (this.data.inWordbook || !this.data.word) return;
    this.setData({ showAdd: true });
  },

  cancelAdd() {
    this.setData({ showAdd: false });
  },

  async confirmAdd() {
    const w = this.data.word;
    if (!w || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await StorageService.addWord({
        word: w.word,
        definitions: this.data.definitions.map((d) => ({
          part_of_speech: d.part_of_speech,
          meaning: d.meaning,
          example: d.example,
          is_core: d.is_core,
          is_rare_sense: d.is_rare_sense,
        })),
        pronunciation_uk: w.pronunciation_uk || '',
        pronunciation_us: w.pronunciation_us || '',
        etymology: w.etymology || '',
        memory_tip: w.memory_tip || '',
        similar_words: w.similar || [],
      });
      this.setData({ saving: false, showAdd: false, inWordbook: true });
      wx.showToast({ title: '已加入生词本', icon: 'success' });
    } catch (e) {
      console.error('[dictionary-word-detail] 加入生词本失败', e);
      this.setData({ saving: false, showAdd: false });
      wx.showToast({ title: '加入失败，请重试', icon: 'none' });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },
});
