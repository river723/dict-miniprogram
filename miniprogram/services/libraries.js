/**
 * 词库注册表 —— 开发者预置词库 + 用户单选激活。
 *
 * 设计：单一「激活词库」决定自动配词从哪里取候选，也决定浏览/详情页的释义来源。
 * - 'all'：云端考研词库（4801 词，由 worddict 云函数按考频挑词，不打包进客户端）。
 * - 'ielts'：雅思核心词（4491 词）。两层数据：
 *     ① 云端富词条集合 worddict_ielts（释义含例句/词根/记忆法/易混词/考频/难度，
 *        由 scripts/gen-ielts-rich.mjs 生成、import-worddict-ielts.mjs 导入）；
 *     ② 内置基础词条 data/libraries/ielts.js（音标+中文释义，离线兜底）。
 *   浏览/详情优先走云端富词条，云端未命中或离线时回落本地词条。
 *
 * 两种词库的数据形态不同，统一抽象成两个访问器：
 * - getLibraryWords(id)     → string[] | null：只要单词串（自动配词候选池用）。
 * - getLibraryEntry(id, w)  → {w,ph,d} | null：要整条词义（浏览/详情页显示用）。
 *   云端词库没有本地词条，返回 null，由 services/wordEnrich.js 走云端补全。
 *
 * 新增内置词库的步骤：① data/libraries/xx.js 导出词条数组；② LIBRARIES 加一项；
 * ③ getLibraryEntries 注册。其余页面无需改动（都经 wordEnrich 取释义）。
 */
import ieltsEntries from '../data/libraries/ielts';

export const LIBRARIES = [
  {
    id: 'all',
    name: '全部（考研词库）',
    desc: '云端 4801 考研词库 · 按考频排序',
    clientSide: false,
  },
  {
    id: 'ielts',
    name: '雅思基础词汇',
    desc: '4491 个雅思核心词 · 云端富词条 + 本地离线',
    clientSide: true,
  },
];

/** 内置词库的「词条」来源表：id → entries[]。云端词库不在此表。 */
const ENTRY_SOURCES = {
  ielts: ieltsEntries,
};

/** 内置词库词条的「小写 → 词条」索引，懒构建（O(n) 一次）。 */
const entryIndexCache = {};
function entryIndex(id) {
  if (!entryIndexCache[id]) {
    const src = ENTRY_SOURCES[id];
    if (!src) return null;
    const idx = {};
    src.forEach((e) => { idx[String(e.w).toLowerCase()] = e; });
    entryIndexCache[id] = idx;
  }
  return entryIndexCache[id];
}

/** 按 id 取词库元信息；未知 id 回落到 'all'。 */
export function getLibrary(id) {
  return LIBRARIES.find((l) => l.id === id) || LIBRARIES[0];
}

/** 某词库的全部词条数组（云端词库返回 null）。 */
export function getLibraryEntries(id) {
  return ENTRY_SOURCES[id] || null;
}

/** 返回某词库的单词数组。云端词库返回 null（需走云函数）。 */
export function getLibraryWords(id) {
  const entries = ENTRY_SOURCES[id];
  return entries ? entries.map((e) => e.w) : null;
}

/**
 * 取某词库里单个词的本地词条 {w, ph, d}；本地没有返回 null。
 * 大小写不敏感。云端词库恒返回 null（交给 wordEnrich 走云端）。
 */
export function getLibraryEntry(id, word) {
  if (!word) return null;
  const idx = entryIndex(id);
  if (!idx) return null;
  return idx[String(word).toLowerCase()] || null;
}

/**
 * 确定性洗牌（mulberry32）：同一 seed 结果一致，保证「同一天自动配词得到相同候选」。
 * 内置词库没有考频字段，用确定性洗牌代替考频排序，每天稳定、跨天轮换。
 */
export function seededShuffle(arr, seed) {
  let s = (Number(seed) || 0) >>> 0;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
