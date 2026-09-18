/**
 * 真题答题壳 —— 合并 memo-grad 的 RealExamReadingScreen / RealExamClozeScreen /
 * RealExamNewTypeScreen 三个答题屏。
 *
 * 由 exam-list 通过 `?year=&set=e1|e2&mode=reading|cloze|newtype&pid=` 进入，
 * 按 mode 从套卷里定位 paper 后渲染：
 *   reading  —— 整篇原文 + 4-5 道单选（选项竖排）
 *   cloze    —— 含 [N] 占位符的原文 + 20 空四选一（选项两列）
 *   newtype  —— Directions + 文章/选项池 + 41-45 位号字母选择器（提交后原地揭晓）
 *
 * 平台说明：
 * - 选中即写草稿（按 paperId 分开存），中途退出后重进自动续答。
 * - 提交后统一落盘 RealExamSession，并把错题 upsert 到真题错题本。
 * - reading / cloze 提交后跳结果页；newtype 与 App 一致，原地揭晓对错与解析。
 */
import StorageService from '../../services/storage';
import { getExamSet, findPaper, stripLetterPrefix, SUBTYPE_LABEL } from '../../services/realExam';
import { applyTheme } from '../../utils/theme';

const SET_OF = { e1: 'english1', e2: 'english2' };
const LETTERS = ['A', 'B', 'C', 'D'];

const TITLE_OF = {
  reading: '阅读理解',
  cloze: '完形填空',
  newtype: '新题型',
};

/** 与 App StorageService 兼容的本地时间串。 */
function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    loading: true,
    missing: false,
    mode: '',
    year: 0,
    headTitle: '',
    /** 顶部进度条百分比（0-100） */
    progress: 0,
    answered: 0,
    total: 0,
    submitted: false,
    scoreText: '',

    passage: '',
    showPassage: false,
    direction: '',
    subtypeLabel: '',
    hasPool: false,
    pool: [],
    items: [],
  },

  paper: null,
  selections: {},

  onLoad(options) {
    const year = Number(options.year) || 0;
    const mode = options.mode || '';
    const pid = options.pid || '';
    const setId = SET_OF[options.set] || 'english1';

    this.year = year;
    this.mode = mode;
    this.paperId = pid;
    this.setId = setId;

    wx.setNavigationBarTitle({ title: `${year} · ${TITLE_OF[mode] || '真题'}` });
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
      this.applyPaper();
      this.setData({ loading: false });
    } catch (err) {
      console.warn('[exam-practice] 拉取真题失败：', err);
      this.setData({ loading: false, missing: true });
    }
  },

  /** 由 paper 生成统一 items，并恢复草稿。 */
  applyPaper() {
    const { mode } = this;
    const paper = this.paper;
    const draft = StorageService.getRealExamDraft(this.paperId) || {};
    this.selections = {};

    let items = [];
    let headTitle = `${this.year} · `;
    let passage = '';
    let showPassage = false;
    const extra = { direction: '', subtypeLabel: '', hasPool: false, pool: [] };

    const toOpts = (arr) =>
      (arr || []).map((o, oi) => ({
        letter: LETTERS[oi],
        text: stripLetterPrefix(o, LETTERS[oi]),
        fixed: false,
      }));

    if (mode === 'reading') {
      headTitle += paper.title || 'Reading';
      passage = paper.passage || '';
      showPassage = true;
      items = (paper.questions || []).map((q, qi) => {
        const selected = draft[q.id] || '';
        if (selected) this.selections[q.id] = selected;
        return {
          draftKey: q.id,
          key: String(qi),
          label: `Q${qi + 1}.`,
          stem: q.stem || '',
          layout: 'list',
          answer: q.answer || '',
          explanation: q.explanation || '',
          opts: toOpts(q.options),
          selected,
        };
      });
    } else if (mode === 'cloze') {
      headTitle += 'Cloze';
      passage = paper.passage || '';
      showPassage = true;
      items = (paper.blanks || []).map((b, bi) => {
        const selected = draft[b.index] || '';
        if (selected) this.selections[b.index] = selected;
        return {
          draftKey: b.index,
          key: String(b.index),
          label: `[${b.index}]`,
          stem: '',
          layout: 'grid',
          answer: b.answer || '',
          explanation: b.explanation || '',
          opts: toOpts(b.options),
          selected,
        };
      });
    } else {
      headTitle += SUBTYPE_LABEL[paper.subtype] || '新题型';
      const pool = (paper.options || []).map((o) => ({
        letter: o.letter,
        text: o.text || '',
        fixed: !!o.fixed,
      }));
      passage = paper.passage || '';
      showPassage = !!passage;
      extra.direction = paper.direction || '';
      extra.subtypeLabel = SUBTYPE_LABEL[paper.subtype] || '';
      extra.hasPool = paper.subtype !== 'truefalse';
      extra.pool = pool;
      items = (paper.questions || []).map((q, qi) => {
        const selected = draft[q.index] || '';
        if (selected) this.selections[q.index] = selected;
        return {
          draftKey: q.index,
          key: String(qi),
          label: `第 ${q.index} 题`,
          stem: paper.subtype === 'truefalse' ? q.stem || '' : '',
          layout: 'chips',
          answer: q.answer || '',
          explanation: q.explanation || '',
          opts: pool,
          selected,
        };
      });
    }

    this.setData({
      ...extra,
      headTitle,
      passage,
      showPassage,
      items,
      countText: this.buildCount(items),
    });
    this.setData(this.counting(items));
  },

  counting(items) {
    const list = items || this.data.items;
    const answered = list.filter((it) => it.selected).length;
    const total = list.length;
    return {
      answered,
      total,
      progress: total > 0 ? Math.round((answered / total) * 100) : 0,
    };
  },

  buildCount(items) {
    const total = (items || this.data.items).length;
    const answered = (items || this.data.items).filter((it) => it.selected).length;
    return answered === total ? '所有题目已作答，可提交' : `还有 ${total - answered} 题未作答`;
  },

  // ---------- 作答 ----------
  onSelect(e) {
    if (this.data.submitted) return;
    const qi = Number(e.currentTarget.dataset.qi);
    const letter = e.currentTarget.dataset.letter;
    const item = this.data.items[qi];
    if (!item) return;
    if (this.data.submitted || e.currentTarget.dataset.fixed === 'true') return;

    const next = item.selected === letter ? '' : letter;
    const items = this.data.items.slice();
    items[qi] = { ...item, selected: next };

    if (next) this.selections[item.draftKey] = next;
    else delete this.selections[item.draftKey];
    StorageService.saveRealExamDraft(this.paperId, this.selections);

    this.setData({
      items,
      ...this.counting(items),
      countText: this.buildCount(items),
    });
  },

  onSubmit() {
    if (this.data.submitted) return;
    const { answered, total } = this.data;
    if (answered === 0) {
      wx.showToast({ title: '请先作答', icon: 'none' });
      return;
    }
    if (answered < total) {
      wx.showModal({
        title: '还有未作答的题目',
        content: `共 ${total} 题，已作答 ${answered} 题。确定提交吗？`,
        confirmText: '直接提交',
        cancelText: '继续作答',
        success: (res) => {
          if (res.confirm) this.commit();
        },
      });
      return;
    }
    this.commit();
  },

  /** 统一组装作答结果。 */
  buildAnswers() {
    const { mode } = this;
    const items = this.data.items;
    const paper = this.paper;
    if (mode === 'reading') {
      return (paper.questions || []).map((q, i) => {
        const selected = items[i] ? items[i].selected : '';
        return { questionId: q.id, selected: selected || null, correct: !!selected && selected === q.answer };
      });
    }
    if (mode === 'cloze') {
      return (paper.blanks || []).map((b, i) => {
        const selected = items[i] ? items[i].selected : '';
        return {
          questionId: `${paper.id}-b${b.index}`,
          selected: selected || null,
          correct: !!selected && selected === b.answer,
        };
      });
    }
    return (paper.questions || []).map((q, i) => {
      const selected = items[i] ? items[i].selected : '';
      return {
        questionId: `${paper.id}-p${q.index}`,
        selected: selected || null,
        correct: !!selected && selected === q.answer,
      };
    });
  },

  async commit() {
    const answers = this.buildAnswers();
    const score = answers.filter((a) => a.correct).length;
    const session = {
      year: this.year,
      mode: this.mode,
      setId: this.setId,
      paperId: this.paperId,
      answers,
      score,
      total: answers.length,
      createdAt: nowText(),
    };

    wx.showLoading({ title: '判分中', mask: true });
    try {
      const rec = await StorageService.saveRealExamSession(session);
      await StorageService.addOrUpdateRealExamWrongQuestions(session, this.paper, this.setId);
      StorageService.clearRealExamDraft(this.paperId);
      wx.hideLoading();

      if (this.mode === 'newtype') {
        this.setData({ submitted: true, progress: 100, scoreText: `${score}/${answers.length}` });
        wx.showToast({ title: `得分 ${score}/${answers.length}`, icon: 'none' });
        return;
      }
      wx.redirectTo({ url: `/pages/real-exam-result/real-exam-result?sessionId=${rec.id}` });
    } catch (err) {
      wx.hideLoading();
      console.error('[exam-practice] 保存真题记录失败：', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  // ---------- 新题型：提交后的动作 ----------
  retry() {
    this.selections = {};
    StorageService.clearRealExamDraft(this.paperId);
    const items = this.data.items.map((it) => ({ ...it, selected: '' }));
    this.setData({
      items,
      submitted: false,
      scoreText: '',
      ...this.counting(items),
      countText: this.buildCount(items),
    });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/exam-history/exam-history' });
  },

  backToList() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/exam-list/exam-list' }) });
  },
});
