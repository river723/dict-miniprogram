/**
 * 连载故事内容 —— 对齐 memo-grad utils/storyUtils.ts + utils/storyContent.ts。
 *
 * 章节按 `content/stories/{id}.json` 存在云存储，由 content 云函数 storyList /
 * storyDetail 分发。这里负责：
 *   - 章节详情拉取与内存缓存
 *   - 索引里的相邻章节 id（上一章 / 下一章）
 *   - 中英段落配对 + 目标词切分（渲染用）
 */
import { callCloud } from '../services/cloud';
import { markWords } from './article';

let indexCache = null;
const chapterCache = {};

/** 章节索引 [{id, title, word_count, theme, summary}]。 */
export async function getStoryIndex() {
  if (indexCache) return indexCache;
  const res = await callCloud('content', { action: 'storyList' });
  indexCache = (res && res.list) || [];
  return indexCache;
}

export async function getStorySeries() {
  const res = await callCloud('content', { action: 'storyList' });
  return (res && res.series) || { series_title: '', total_chapters: 0 };
}

/** 单章详情（带内存缓存）。 */
export async function getStoryChapter(id) {
  const key = String(id);
  if (chapterCache[key]) return chapterCache[key];
  const res = await callCloud('content', { action: 'storyDetail', id: key });
  chapterCache[key] = (res && res.story) || null;
  return chapterCache[key];
}

/** 相邻章节 id。 */
export async function getAdjacentChapterIds(id) {
  const list = await getStoryIndex();
  const idx = list.findIndex((c) => String(c.id) === String(id));
  if (idx < 0) return {};
  return {
    prev: idx > 0 ? list[idx - 1].id : undefined,
    next: idx < list.length - 1 ? list[idx + 1].id : undefined,
  };
}

/** 判断短文本是否像标题（无句末标点），用于识别英文正文开头多出的章节标题行。 */
function isTitleLike(text) {
  const t = String(text || '').trim();
  if (!t || t.length >= 40) return false;
  return !/[.!?。！？]$/.test(t);
}

/**
 * 英文正文与中文译文按 `\n\n` 拆段并按下标配对。
 * 处理英文开头多出的标题行、以及中英段数不等的情况（与 App buildBilingualPairs 一致）。
 */
export function buildBilingualPairs(content, translation) {
  const enParas = String(content || '').split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  const zhParas = String(translation || '')
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pairs = [];

  let enStart = 0;
  if (enParas.length === zhParas.length + 1 && zhParas.length > 0 && isTitleLike(enParas[0])) {
    pairs.push({ en: enParas[0], zh: '' });
    enStart = 1;
  }

  const maxLen = Math.max(enParas.length - enStart, zhParas.length);
  for (let i = 0; i < maxLen; i += 1) {
    const en = enParas[enStart + i];
    const zh = zhParas[i];
    if (en !== undefined) pairs.push({ en, zh: zh || '' });
    else pairs.push({ en: '', zh: zh || '' });
  }
  return pairs;
}

/** 把每段英文切成「普通文本 / 目标词」交替片段，供渲染高亮。 */
export function buildSegments(pairs, words) {
  return pairs.map((p) => ({
    // en 必须带上：WXML 用 wx:if="{{para.en}}" 判断是否渲染英文段落
    en: p.en || '',
    segs: markWords(p.en, words || []).map((s) => ({
      text: s.text,
      hit: s.hit,
    })),
    zh: p.zh,
  }));
}
