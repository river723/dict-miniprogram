/**
 * 真题列表 —— 对齐 memo-grad RealExamListScreen。
 *
 * 结构：年份卡（可展开/收起，首次进入默认展开最近一年）× 卷别（英语一 / 英语二）
 *      × 条目（阅读理解 Text1-4 / 完形填空 / 新题型 / 翻译 / 写作）。
 *
 * 平台说明：
 * - 内容按「年份 + 卷别」拆篇存在云存储，展开年份时才懒加载，避免一次拉全量。
 * - 每个条目下方的状态（上次得分 / 待复习错题数）来自本地
 *   RealExamSession 与真题错题本，随 onShow 刷新。
 */
import StorageService from '../../services/storage';
import { getExamYears, getExamSet } from '../../services/realExam';
import { REAL_EXAM_ENTRY_META, REAL_EXAM_SUBTYPE_LABEL } from '../../constants/index';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'english1', label: '英语一' },
  { key: 'english2', label: '英语二' },
];

/** 卷别 → URL 短码（避免 navigation query 里塞长英文名）。 */
const CODE_OF = { english1: 'e1', english2: 'e2' };

const SET_LABEL = { english1: '英语一', english2: '英语二' };

Page({
  data: {
    filters: FILTERS,
    filter: 'all',
    loading: true,
    empty: false,
    years: [],
  },

  // paperId → { text, cls }
  statusMap: {},
  // `${year}|${setId}` → ExamSet
  raw: {},

  onLoad() {
    this.loadYears();
  },

  onShow() {
    this.loadStatus();
  },

  // ---------- 年份 / 套卷加载 ----------
  async loadYears() {
    let list = [];
    try {
      list = await getExamYears();
    } catch (err) {
      console.warn('[exam-list] 拉取年份列表失败：', err);
    }
    const years = list.map((year, i) => ({
      year,
      expanded: i === 0,
      sets: [],
      loaded: false,
    }));
    this.setData({ years, empty: years.length === 0, loading: false });
    if (years.length > 0) this.loadYearContent(years[0].year);
  },

  /** 展开某年时按需拉取两套卷(year-e1 / year-e2)，失败的那套降级为「加载失败」。 */
  async loadYearContent(year) {
    const idx = this.data.years.findIndex((y) => y.year === year);
    if (idx < 0) return;
    if (this.data.years[idx].loaded) return;

    const [e1, e2] = await Promise.all([
      getExamSet(year, 'english1').catch(() => 'error'),
      getExamSet(year, 'english2').catch(() => 'error'),
    ]);
    this.raw[`${year}|english1`] = e1;
    this.raw[`${year}|english2`] = e2;

    this.setData({ [`years[${idx}].loaded`]: true });
    this.renderYear(idx);
  },

  renderYear(idx) {
    const year = this.data.years[idx].year;
    const sets = ['english1', 'english2'].map((setId) => {
      const set = this.raw[`${year}|${setId}`];
      if (set === 'error') {
        return { setId, label: SET_LABEL[setId], state: 'error', entries: [] };
      }
      if (!set) {
        return { setId, label: SET_LABEL[setId], state: 'missing', entries: [] };
      }
      return {
        setId,
        label: SET_LABEL[setId],
        state: 'ok',
        entries: this.buildEntries(set, year, setId),
      };
    });
    this.setData({ [`years[${idx}].sets`]: sets });
  },

  buildEntries(set, year, setId) {
    const entries = [];
    const push = (mode, paperId, opts) => {
      const meta = REAL_EXAM_ENTRY_META[mode] || {};
      const status = this.statusMap[paperId] || null;
      entries.push({
        mode,
        paperId,
        year,
        setCode: CODE_OF[setId],
        icon: meta.icon || 'file-document-outline',
        title: opts.title,
        countText: opts.count != null ? ` (${opts.count}题)` : '',
        badge: opts.badge || '',
        statusText: status ? status.text : '',
        statusCls: status ? status.cls : '',
        subLabel: opts.subLabel || '',
      });
    };

    (set.reading || []).forEach((p, i) => {
      push('reading', p.id, {
        title: p.title || `Text ${i + 1}`,
        count: (p.questions || []).length,
      });
    });
    if (set.cloze) {
      push('cloze', set.cloze.id, { title: '完形填空', count: (set.cloze.blanks || []).length || 20 });
    }
    if (set.newType) {
      push('newtype', set.newType.id, {
        title: '新题型',
        count: (set.newType.questions || []).length,
        subLabel: REAL_EXAM_SUBTYPE_LABEL[set.newType.subtype] || '',
      });
    }
    if (set.translation) {
      push('translation', set.translation.id, { title: '翻译', badge: '阅览' });
    }
    if (set.writing) {
      push('writing', set.writing.id, { title: '写作', badge: '阅览' });
    }
    return entries;
  },

  // ---------- 做题状态（会话 + 错题本） ----------
  loadStatus() {
    const sessions = StorageService.getRealExamSessions();
    const wrongs = StorageService.getRealExamWrongQuestions();

    // 每套试卷取 id 最大的一次会话作为「上次」
    const latest = {};
    sessions.forEach((s) => {
      const cur = latest[s.paperId];
      if (!cur || String(s.id) > String(cur.id)) latest[s.paperId] = s;
    });

    const map = {};
    Object.keys(latest).forEach((pid) => {
      map[pid] = { lastScore: latest[pid].score, lastTotal: latest[pid].total, wrongCount: 0 };
    });
    wrongs.forEach((w) => {
      const e = map[w.paperId] || { lastScore: 0, lastTotal: 0, wrongCount: 0 };
      e.wrongCount += 1;
      map[w.paperId] = e;
    });

    this.statusMap = {};
    Object.keys(map).forEach((pid) => {
      const st = map[pid];
      const parts = [];
      let cls = 'muted';
      if (st.lastTotal > 0) {
        const acc = st.lastScore / st.lastTotal;
        parts.push(`上次 ${st.lastScore}/${st.lastTotal}`);
        cls = acc >= 0.7 ? 'success' : acc >= 0.5 ? 'warning' : 'danger';
      }
      if (st.wrongCount > 0) {
        parts.push(`错${st.wrongCount}待复习`);
        if (st.lastTotal === 0) cls = 'warning';
      }
      if (parts.length === 0) return;
      this.statusMap[pid] = { text: parts.join(' · '), cls };
    });

    this.refreshVisibleStatus();
  },

  /** 已渲染出来的条目同步最新状态文本。 */
  refreshVisibleStatus() {
    const patch = {};
    this.data.years.forEach((y, yi) => {
      (y.sets || []).forEach((set, si) => {
        (set.entries || []).forEach((entry, ei) => {
          const status = this.statusMap[entry.paperId] || null;
          patch[`years[${yi}].sets[${si}].entries[${ei}].statusText`] = status ? status.text : '';
          patch[`years[${yi}].sets[${si}].entries[${ei}].statusCls`] = status ? status.cls : '';
        });
      });
    });
    if (Object.keys(patch).length > 0) this.setData(patch);
  },

  // ---------- 交互 ----------
  setFilter(e) {
    const filter = e.currentTarget.dataset.key;
    if (filter === this.data.filter) return;
    this.setData({ filter });
  },

  toggleYear(e) {
    const year = Number(e.currentTarget.dataset.year);
    const idx = this.data.years.findIndex((y) => y.year === year);
    if (idx < 0) return;
    const expanded = !this.data.years[idx].expanded;
    this.setData({ [`years[${idx}].expanded`]: expanded });
    if (expanded) this.loadYearContent(year);
  },

  onEntryTap(e) {
    const { mode, pid, year, set: code } = e.currentTarget.dataset;
    if (mode === 'translation' || mode === 'writing') {
      wx.navigateTo({
        url: `/pages/real-exam-read/real-exam-read?year=${year}&set=${code}&mode=${mode}&pid=${pid}`,
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/exam-practice/exam-practice?year=${year}&set=${code}&mode=${mode}&pid=${pid}`,
    });
  },

  goPractice() {
    wx.navigateTo({ url: '/pages/practice/practice' });
  },
});
