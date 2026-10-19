/**
 * 词库列表页 —— 选择激活词库 + 打开浏览。
 *
 * 设计：单一「激活词库」决定自动配词从哪取候选（与设置页无关，选择在此页完成）。
 * 每个卡片展示：名称 / 描述 / 词数 / 激活态（使用中），并提供两个动作：
 *   - 「设为本词库」：写入 settings.activeLibraryId（单选激活），切换后清空自动配词日期让首页按新词库补足。
 *   - 「打开」：进入 dictionary-browse 浏览/查询该词库的单词。
 *
 * 词数：客户端内置词库（ielts）直接取本地数组长度；云端词库（all）由 countWorddict
 * 取云端真实总数（加载前显示「? 词」）。
 */
import { LIBRARIES, getLibrary, getLibraryWords } from '../../services/libraries';
import StorageService from '../../services/storage';
import { countWorddict } from '../../services/worddict';
import { applyTheme } from '../../utils/theme';

/** 千分位（不用 toLocaleString，避免运行时差异）。 */
function group(n) {
  const s = String(n == null ? 0 : n);
  if (s.length <= 3) return s;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

Page({
  data: {
    dicts: [],
    activeId: 'all',
    loading: true,
    error: '',
  },

  onShow() {
    applyTheme(this);
    // 始终基于 LIBRARIES 重建（不依赖 onLoad 时序），保留已拉到的云端词数。
    this.buildDicts();
  },

  onLoad() {
    this.buildDicts();
    this.loadCounts();
  },

  /** 构造基础卡片（含本地词库词数，云端词库词数先占位「? 词」）。 */
  buildDicts() {
    try {
      const prev = this.data.dicts || [];
      const prevMap = {};
      prev.forEach((d) => { prevMap[d.id] = d; });
      const activeId = StorageService.getActiveLibraryId();
      const dicts = LIBRARIES.map((d) => {
        const words = d.clientSide ? getLibraryWords(d.id) : null;
        const prevCount = prevMap[d.id] && prevMap[d.id].countText;
        return {
          id: d.id,
          name: d.name,
          desc: d.desc,
          clientSide: d.clientSide,
          active: d.id === activeId,
          countText: d.clientSide
            ? `${group(words ? words.length : 0)} 词`
            : (prevCount || '? 词'),
        };
      });
      this.setData({ dicts, activeId });
    } catch (e) {
      console.error('[dictionary] buildDicts 失败', e);
    }
  },

  /** 拉取云端词库的真实总词数（内置词库已在 buildDicts 算好，跳过）。 */
  async loadCounts() {
    const needCloud = this.data.dicts.filter((d) => !d.clientSide);
    if (needCloud.length === 0) {
      this.setData({ loading: false });
      return;
    }
    try {
      const total = group(await countWorddict());
      this.setData({
        loading: false,
        error: '',
        dicts: this.data.dicts.map((d) =>
          d.clientSide ? d : { ...d, countText: `${total} 词` }),
      });
    } catch (e) {
      console.error('[dictionary] 词库 meta 拉取失败', e);
      this.setData({ loading: false, error: '词库信息加载失败，可下拉重试' });
    }
  },

  onPullDownRefresh() {
    this.loadCounts().then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  /** 单选激活某个词库（自动配词来源）。 */
  async onLibraryChange(e) {
    const id = e.currentTarget.dataset.value;
    if (!id || id === this.data.activeId) return;
    await StorageService.saveSettings({ activeLibraryId: id });
    // 清空自动配词日期，让首页刷新时按新词库补足新候选（不删已有生词）。
    StorageService.setAutoFillLastDate('');
    this.buildDicts();
    this.loadCounts();
    const lib = getLibrary(id);
    wx.showToast({ title: `已切换：${lib ? lib.name : id}`, icon: 'none' });
  },

  openDict(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/dictionary-browse/dictionary-browse?dictId=${id}` });
  },
});
