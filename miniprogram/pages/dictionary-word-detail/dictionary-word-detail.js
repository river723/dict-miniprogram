/**
 * 词条详情（词库，只读）—— 对齐 memo-grad DictionaryWordDetailScreen。
 * 数据取自词库（云函数按关键词精确命中），不做写回补全；
 * 额外提供「加入生词本」入口，与生词本流程打通。
 */
import StorageService from '../../services/storage';
import { getLibrary } from '../../services/libraries';
import { enrichSync, enrichCloud } from '../../services/wordEnrich';
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
    localPh: '',
    localDef: '',
    localFreq: 0,
    upgrading: false,
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

  /**
   * 加载词条：本地即时上屏 → 云端富词条无缝升级 → 都没有才报未找到。
   *  - 雅思等内置词库：本地有简明词条（{w,ph,d}），先渲染；云端富词条
   *    （worddict_ielts 集合）到达后换成完整视图。云端未命中（如集合尚未导入）
   *    就保持本地视图，不打扰用户。
   *  - 考研等云端词库：本地无词条，等云端结果，未命中报「未找到」。
   */
  async load() {
    if (!this.key) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ loading: true, localOnly: false, notFound: false, localPh: '', localDef: '', upgrading: false });

    // ① 本地词条即时上屏（同步、零成本；考研库本地无词条，跳过）
    let local = null;
    if (this.localMode) {
      local = enrichSync(this.localDictId, this.key);
      if (local) {
        const lib = getLibrary(this.localDictId);
        // 本地词条自带 f/k（真实语料考频 + 客观难度指标），先渲染出来，
        // 云端富词条到达后会被覆盖——本地这份也能独立成立，不再是「只有音标释义」。
        const lv = Math.max(1, Math.min(5, local.difficulty || 1));
        const fq = Math.max(0, Math.min(5, local.frequency || 0));
        this.setData({
          loading: false,
          notFound: false,
          localOnly: true,
          upgrading: true, // 云端富词条在途，本地视图上给个小提示
          libraryName: lib ? lib.name : '',
          localPh: local.ph || '',
          localDef: local.def || '',
          localFreq: fq,
          stars: pad5(lv, '★'),
          squares: pad5(fq, '■'),
          diffColor: DIFF_COLORS[lv - 1],
          // 音标一并写入，加入生词本时能带上
          word: { word: local.word, pronunciation_uk: local.ph || '', pronunciation_us: '' },
          definitions: [],
        });
        this.refreshFlags();
      }
    }

    // ② 云端富词条（按词库选集合）到达后无缝升级
    try {
      const rich = await enrichCloud(this.localDictId, this.key);
      if (rich) {
        const level = Math.max(1, Math.min(5, rich.difficulty || 3));
        this.setData({
          loading: false,
          notFound: false,
          localOnly: false,
          upgrading: false,
          word: {
            word: rich.word,
            // 云端缺音标时用本地词条兜底（42 个雅思词无本地音标，两侧都缺才留空）
            pronunciation_uk: rich.ph || (local && local.ph) || '',
            pronunciation_us: '',
            etymology: rich.etymology,
            memory_tip: rich.memory_tip,
            similar: rich.similar_words,
          },
          definitions: rich.definitions,
          stars: pad5(rich.difficulty, '★'),
          squares: pad5(rich.frequency, '■'),
          diffColor: DIFF_COLORS[level - 1],
        });
        this.refreshFlags();
        return;
      }
      // ③ 云端未命中：有本地词条就保持本地视图；否则干净空态
      if (local) {
        this.setData({ upgrading: false });
      } else {
        this.setData({ loading: false, notFound: true, word: null });
      }
    } catch (e) {
      console.error('[dictionary-word-detail] 查询失败', e);
      // 本地词条已上屏就保留（不拿加载失败打扰用户）；否则按未找到处理并提示
      if (local) {
        this.setData({ upgrading: false });
      } else {
        this.setData({ loading: false, notFound: true, word: null });
        wx.showToast({ title: '词条加载失败', icon: 'none' });
      }
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

  /**
   * 该词在当前本地内置词库里是否有词条（含释义）。
   * 走 libraries.js 的小写索引，O(1)；早年是线性扫 4491 个词，已废弃。
   */
  isInLocalLibrary(word) {
    if (!this.localMode || !this.localDictId) return false;
    return !!enrichSync(this.localDictId, word);
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
      let definitions = this.data.definitions.map((d) => ({
        part_of_speech: d.part_of_speech,
        meaning: d.meaning,
        example: d.example,
        is_core: d.is_core,
        is_rare_sense: d.is_rare_sense,
      }));
      // 本地内置词条是整串释义（无结构化 definitions），兜底成一条，
      // 保证加入生词本后在学习流程里仍看得到意思。
      if (definitions.length === 0 && this.data.localDef) {
        definitions = [{
          part_of_speech: '',
          meaning: this.data.localDef,
          example: '',
          is_core: true,
          is_rare_sense: false,
        }];
      }
      await StorageService.addWord({
        word: w.word,
        definitions,
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
