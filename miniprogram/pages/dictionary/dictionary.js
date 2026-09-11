/**
 * 词库选择页 —— 对齐 memo-grad DictionaryScreen。
 * 列出可用词库（当前内置 1 个），点「打开词库」进入浏览/查询页。
 * 词条数由云函数 pick 的 candidates 实时得出（加载前显示「? 词」）。
 */
import { pickWorddict } from '../../services/worddict';

const DICTIONARIES = [
  {
    id: 'local',
    name: '考研核心词库',
    description:
      '内置增强词库，剔除了超简单初高中基础词、小众专业冷词、极少考察的古旧词汇，只保留真题有考察价值的词，含释义、例句、词源与记忆技巧，可离线浏览与查询。',
  },
];

/** 千分位（不用 toLocaleString，避免运行时差异）。 */
function group(n) {
  const s = String(n == null ? 0 : n);
  if (s.length <= 3) return s;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

Page({
  data: {
    dicts: DICTIONARIES.map((d) => ({ ...d, countText: '? 词' })),
    loading: true,
    error: '',
  },

  onLoad() {
    this.loadCounts();
  },

  async loadCounts() {
    try {
      // limit=1 只取 1 个词，candidates 即候选池总量（排除项为空 → 全库词条数）。
      const res = await pickWorddict({ limit: 1, seed: 1 });
      const total = group(res.candidates || 0);
      this.setData({
        loading: false,
        error: '',
        dicts: this.data.dicts.map((d) => ({ ...d, countText: `${total} 词` })),
      });
    } catch (e) {
      console.error('[dictionary] 词库 meta 拉取失败', e);
      this.setData({ loading: false, error: '词库信息加载失败，可下拉重试' });
    }
  },

  onPullDownRefresh() {
    this.loadCounts().finally(() => wx.stopPullDownRefresh());
  },

  openDict(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/dictionary-browse/dictionary-browse?dictId=${id}` });
  },
});
