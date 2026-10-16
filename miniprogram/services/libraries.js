/**
 * 词库注册表 —— 开发者预置词库 + 用户单选激活。
 *
 * 设计：单一「激活词库」决定自动配词从哪里取候选。
 * - 'all'：云端考研词库（4801 词，由 worddict 云函数按考频挑词，不打包进客户端）。
 * - 'ielts'：内置雅思基础词汇（约 3953 词，data/libraries/ielts.js，不依赖云端，模拟器可直测）。
 *
 * 词库数据内联进客户端（仅 ielts 这约 4k 词），不进云端 worddict 集合，
 * 因此切换内置词库后自动配词完全离线可用，且不影响已存在的云端考研词库。
 */
import ieltsWords from '../data/libraries/ielts';

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
    desc: '约 3953 个雅思核心词 · 已内置',
    clientSide: true,
  },
];

/** 按 id 取词库元信息；未知 id 回落到 'all'。 */
export function getLibrary(id) {
  return LIBRARIES.find((l) => l.id === id) || LIBRARIES[0];
}

/** 返回某词库的单词数组。云端词库返回 null（需走云函数）。 */
export function getLibraryWords(id) {
  if (id === 'ielts') return ieltsWords;
  return null;
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
