/**
 * 真题阅览 —— 合并 memo-grad 的 RealExamTranslationScreen / RealExamWritingScreen。
 *
 * 翻译、写作为主观题，无自动判分，只提供：
 *   翻译：Directions + 英文原文 + 逐句（或整段）参考译文，默认折叠，点击揭晓。
 *   写作：每篇 Directions + 参考范文 + 范文中译 + 写作解析，默认折叠。
 *
 * 由 exam-list 通过 `?year=&set=e1|e2&mode=translation|writing&pid=` 进入。
 */
import { getExamSet, findPaper } from '../../services/realExam';
import { applyTheme } from '../../utils/theme';

const SET_OF = { e1: 'english1', e2: 'english2' };

const TITLE_OF = {
  translation: '翻译',
  writing: '写作',
};

const HINT_OF = {
  translation: '翻译为主观题，无标准答案。建议先自己译一遍，再对照参考译文。',
  writing: '写作为主观题，无标准答案。建议先自己写一篇，再对照参考范文。',
};

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    loading: true,
    missing: false,
    mode: '',
    hint: '',
    direction: '',
    hasPassage: false,
    passage: '',
    /** 翻译：isSentence 时按句展示 */
    isSentence: false,
    items: [],
    /** 写作：parts */
    parts: [],
  },

  onLoad(options) {
    const year = Number(options.year) || 0;
    const mode = options.mode || '';
    const pid = options.pid || '';
    this.year = year;
    this.mode = mode;
    this.paperId = pid;
    this.setId = SET_OF[options.set] || 'english1';

    wx.setNavigationBarTitle({ title: `${year} · ${TITLE_OF[mode] || '阅览'}` });
    this.setData({ mode, hint: HINT_OF[mode] || '' });
    this.load();
  },

  async load() {
    try {
      const set = await getExamSet(this.year, this.setId);
      const paper = findPaper(set, this.mode, this.paperId);
      if (!paper) {
        this.setData({ loading: false, missing: true });
        return;
      }
      this.paper = paper;
      if (this.mode === 'translation') this.applyTranslation(paper);
      else this.applyWriting(paper);
      this.setData({ loading: false });
    } catch (err) {
      console.warn('[real-exam-read] 拉取真题失败：', err);
      this.setData({ loading: false, missing: true });
    }
  },

  applyTranslation(paper) {
    const isSentence = paper.subtype === 'sentence';
    const items = (paper.items || []).map((it) => ({
      key: it.index,
      label: `第 ${it.index} 句`,
      en: it.en || '',
      zh: it.zh || '',
      note: it.note || '',
      open: false,
    }));
    this.setData({
      direction: paper.direction || '',
      hasPassage: !!paper.passage,
      passage: paper.passage || '',
      isSentence,
      items,
    });
  },

  applyWriting(paper) {
    const parts = (paper.parts || []).map((p, i) => ({
      key: String(i),
      label: p.label || '',
      direction: p.direction || '',
      sample: p.sample || '',
      sampleTranslation: p.sampleTranslation || '',
      analysis: p.analysis || '',
      open: false,
    }));
    this.setData({ parts });
  },

  toggleItem(e) {
    const k = e.currentTarget.dataset.key;
    const idx = this.data.items.findIndex((x) => String(x.key) === String(k));
    if (idx < 0) return;
    this.setData({ [`items[${idx}].open`]: !this.data.items[idx].open });
  },

  togglePart(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ [`parts[${idx}].open`]: !this.data.parts[idx].open });
  },

  backToList() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/exam-list/exam-list' }) });
  },
});
