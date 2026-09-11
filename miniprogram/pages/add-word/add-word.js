/**
 * 添加生词 —— 对齐 memo-grad AddWordScreen。
 * 两个入口：本地词库选词（→ wordbank-picker）/ 手工添加（批量解析 + 保存）。
 * 解析顺序与 App 一致：先查「本地词库」（小程序侧 = 云端 worddict 集合精确命中），
 * 未命中的再走 ai 云函数 analyze；结果分区展示（本地命中 / AI 结果）。
 */
import StorageService from '../../services/storage';
import { searchWorddict } from '../../services/worddict';
import { callCloud } from '../../services/cloud';
import { MAX_ADD_WORDS } from '../../theme/tokens';

const SPLIT_RE = /[\s\n,，。；;：:、\-]+/;

function parseWords(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(SPLIT_RE)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0 && /^[a-zA-Z]+$/.test(w))
    )
  );
}

function difficultyOf(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function labelOf(d) {
  if (d <= 2) return '简单';
  if (d <= 3) return '中等';
  if (d <= 4) return '困难';
  return '极难';
}

Page({
  data: {
    tab: 'wordbank', // wordbank | manual

    input: '',
    parsedWords: [],
    wordCount: 0,
    overflow: false,
    pronunciation: '',
    customDefinitions: '',

    analyzing: false,
    progressText: '',

    results: [],
    single: null,

    canSave: false,

    showOverwrite: false,
    overwriteWord: '',
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onInput(e) {
    const input = e.detail.value;
    const parsedWords = parseWords(input);
    const count = parsedWords.length;
    this.setData({
      input,
      parsedWords,
      wordCount: count,
      overflow: count > MAX_ADD_WORDS,
      results: [],
      single: null,
      canSave: false,
    });
  },

  onPron(e) {
    this.setData({ pronunciation: e.detail.value });
  },

  onCustomDef(e) {
    this.setData({ customDefinitions: e.detail.value });
    this.refreshCanSave();
  },

  refreshCanSave() {
    const { results, customDefinitions, wordCount, analyzing } = this.data;
    const hasResult = results.some((r) => (r.definitions || []).length > 0);
    const manual = wordCount === 1 && results.length === 0 && !!customDefinitions.trim();
    this.setData({ canSave: !analyzing && wordCount > 0 && (hasResult || manual) });
  },

  // ==================== 解析 ====================
  async analyze() {
    if (this.data.analyzing) return;
    const words = this.data.parsedWords.slice(0, MAX_ADD_WORDS);
    if (words.length === 0) {
      wx.showToast({ title: '请输入有效的单词', icon: 'none' });
      return;
    }
    this.setData({ analyzing: true, results: [], single: null, canSave: false });

    const results = [];
    try {
      for (let i = 0; i < words.length; i += 1) {
        const w = words[i];
        this.setData({ progressText: `正在分析 ${i + 1}/${words.length}：${w}` });
        let entry = await this.lookupLocal(w);
        let source = 'local';
        if (!entry) {
          entry = await this.analyzeAI(w);
          source = 'ai';
        }
        if (entry) {
          results.push({
            word: w,
            source,
            sourceLabel: source === 'local' ? '本地词库' : 'AI 分析',
            definitions: entry.definitions || [],
            etymology: entry.etymology || '',
            memory_tip: entry.memory_tip || '',
            similar_words: entry.similar_words || [],
            difficulty: difficultyOf(entry.difficulty || entry.suggestedDifficulty),
            difficultyLabel: labelOf(difficultyOf(entry.difficulty || entry.suggestedDifficulty)),
          });
        } else {
          results.push({ word: w, source: 'none', sourceLabel: '未命中', definitions: [], etymology: '', memory_tip: '', similar_words: [], difficulty: 3, difficultyLabel: '中等' });
        }
      }

      const single = words.length === 1 ? results[0] : null;
      this.setData({ analyzing: false, progressText: '', results, single });
      this.refreshCanSave();

      const hit = results.filter((r) => r.source !== 'none').length;
      if (hit === 0) wx.showToast({ title: '未找到任何解析结果', icon: 'none' });
    } catch (e) {
      console.error('[add-word] 解析失败', e);
      this.setData({ analyzing: false, progressText: '' });
      wx.showToast({ title: '分析失败，请检查网络', icon: 'none' });
    }
  },

  /** 云端词库精确命中。 */
  async lookupLocal(word) {
    try {
      const res = await searchWorddict({ keyword: word });
      const list = res.words || [];
      const hit = list.find((x) => String(x.word).toLowerCase() === word);
      if (!hit) return null;
      return {
        definitions: (hit.definitions || []).map((d) => ({
          part_of_speech: d.part_of_speech || d.pos || '',
          meaning: d.meaning || '',
          example: d.example || '',
          is_core: !!d.is_core,
          is_rare_sense: !!d.is_rare_sense,
        })),
        etymology: hit.etymology || '',
        memory_tip: hit.memory_tip || '',
        similar_words: Array.isArray(hit.similar_words) ? hit.similar_words : [],
        difficulty: hit.difficulty,
      };
    } catch (e) {
      return null;
    }
  },

  /** ai 云函数 analyze。 */
  async analyzeAI(word) {
    try {
      const res = await callCloud('ai', { action: 'analyze', word });
      let parsed = null;
      try {
        parsed = JSON.parse(String(res.content).replace(/```json|```/g, '').trim());
      } catch (e) {
        parsed = null;
      }
      if (!parsed) return null;
      return {
        definitions: (parsed.definitions || []).map((d) => ({
          part_of_speech: d.pos || '',
          meaning: d.meaning || '',
          example: d.example || '',
          is_core: !!d.is_core,
          is_rare_sense: !!d.is_rare_sense,
        })),
        etymology: parsed.root_analysis || '',
        memory_tip: parsed.memory_tip || '',
        similar_words: [],
        difficulty: parsed.suggestedDifficulty,
      };
    } catch (e) {
      return null;
    }
  },

  // ==================== 保存 ====================
  async save() {
    if (!this.data.canSave) {
      wx.showToast({ title: '请先分析或填写手动释义', icon: 'none' });
      return;
    }
    const words = this.data.parsedWords.slice(0, MAX_ADD_WORDS);
    const existing = StorageService.getWords();
    const existingMap = {};
    existing.forEach((w) => { existingMap[String(w.word).toLowerCase()] = w; });

    // 单个单词且已存在 → 覆盖确认
    if (words.length === 1) {
      const target = existingMap[words[0]];
      if (target) {
        this.setData({ showOverwrite: true, overwriteWord: words[0] });
        return;
      }
    }

    await this.doSave(words, existingMap, false);
  },

  cancelOverwrite() {
    this.setData({ showOverwrite: false });
  },

  async confirmOverwrite() {
    const words = this.data.parsedWords.slice(0, MAX_ADD_WORDS);
    const existingMap = {};
    StorageService.getWords().forEach((w) => { existingMap[String(w.word).toLowerCase()] = w; });
    this.setData({ showOverwrite: false });
    await this.doSave(words, existingMap, true);
  },

  async doSave(words, existingMap, overwrite) {
    const results = this.data.results;
    const byWord = {};
    results.forEach((r) => { byWord[r.word] = r; });

    let added = 0;
    let duplicated = 0;
    let skipped = 0;
    let failed = 0;

    wx.showLoading({ title: '保存中', mask: true });
    try {
      for (const w of words) {
        const existing = existingMap[w];
        const r = byWord[w];

        if (existing) {
          if (overwrite && r && r.source !== 'none') {
            await StorageService.updateWord(existing.id, this.buildPatch(w, r));
            added += 1;
          } else {
            duplicated += 1;
          }
          continue;
        }

        if (r && r.source !== 'none') {
          try {
            await StorageService.addWord(this.buildEntry(w, r));
            added += 1;
          } catch (e) {
            failed += 1;
          }
        } else if (words.length === 1 && this.data.customDefinitions.trim()) {
          await StorageService.addWord({
            word: w,
            definitions: [{ part_of_speech: 'n.', meaning: this.data.customDefinitions.trim(), example: '', is_core: false, is_rare_sense: false }],
            pronunciation_uk: this.data.pronunciation || '',
            pronunciation_us: this.data.pronunciation || '',
            difficulty: 3,
            frequency: 1,
          });
          added += 1;
        } else {
          skipped += 1;
        }
      }
    } finally {
      wx.hideLoading();
    }

    const parts = [`成功保存 ${added} 个单词`];
    if (failed) parts.push(`失败 ${failed} 个`);
    if (duplicated) parts.push(`已有 ${duplicated} 个`);
    if (skipped) parts.push(`未分析跳过 ${skipped} 个`);

    this.reset();
    wx.showModal({
      title: '保存成功',
      content: parts.join('，'),
      confirmText: '继续添加',
      cancelText: '返回',
      success: (res) => {
        if (!res.confirm) {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
        }
      },
    });
  },

  buildEntry(word, r) {
    return {
      word,
      definitions: r.definitions.length > 0
        ? r.definitions
        : [{ part_of_speech: 'unknown', meaning: '待添加释义', example: '', is_core: false, is_rare_sense: false }],
      etymology: r.etymology || '',
      memory_tip: r.memory_tip || '',
      similar_words: r.similar_words || [],
      pronunciation_uk: this.data.pronunciation || '',
      pronunciation_us: this.data.pronunciation || '',
      difficulty: r.difficulty || 3,
      frequency: 1,
    };
  },

  buildPatch(word, r) {
    return {
      definitions: r.definitions,
      etymology: r.etymology || '',
      memory_tip: r.memory_tip || '',
      similar_words: r.similar_words || [],
      difficulty: r.difficulty || 3,
    };
  },

  reset() {
    this.setData({
      input: '',
      parsedWords: [],
      wordCount: 0,
      overflow: false,
      pronunciation: '',
      customDefinitions: '',
      results: [],
      single: null,
      canSave: false,
    });
  },

  goPicker() {
    wx.navigateTo({ url: '/pages/wordbank-picker/wordbank-picker' });
  },

  goDictionary() {
    wx.navigateTo({ url: '/pages/dictionary/dictionary' });
  },
});
