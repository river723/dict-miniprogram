/**
 * 练习域服务 —— AI 出题、智能选词推荐、题库分组、统计小工具。
 * 对应 memo-grad 的 ExamService / getRecommendedWords / buildExamSets。
 */
import { callCloud } from './cloud';
import StorageService from './storage';

/** 云函数单次生成的词数上限（分批请求，避免超时）。 */
const BATCH_SIZE = 5;

// ======================  基础工具  ======================

/** 从模型返回里抠出 JSON 数组（容忍 ```json 包裹与前后杂讯）。 */
export function parseJsonArray(content) {
  if (!content) return [];
  let t = String(content).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[exam] AI 返回解析失败', e);
    return [];
  }
}

/** Fisher-Yates 洗牌，返回新数组。 */
export function shuffle(list) {
  const a = (list || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(String(v).replace(/-/g, '/'));
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysSince = (dateStr, now) => {
  const d = toDate(dateStr);
  if (!d) return 0;
  return Math.floor((now - d) / 86400000);
};

/** 把 '2026-09-11 10:30' / ISO 串格式化成「9月11日」。 */
export function formatMonthDay(v) {
  const d = toDate(v);
  if (!d) return '未知时间';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 正确率的语义色 key（配合 theme.wxss 的 --mg-success / --mg-warning / --mg-danger）。 */
export const accuracyLevel = (acc) => (acc >= 0.8 ? 'success' : acc >= 0.6 ? 'warning' : 'danger');

// ======================  AI 出题  ======================

/**
 * 生成题目。分批请求云函数，归一成前端统一的题目结构。
 * @param {'definition'|'cloze'} type
 * @param {Array<{word:string, meaning:string, word_id:string}>} wordData
 * @param {(done:number,total:number)=>void} [onProgress] 每批完成后回调，用于展示进度
 * @returns {Promise<Array>} definition: {type,word_id,word,sentence,chinese_translation,options[],correct_definition}
 *                           cloze:      {type,word_id,target_word,sentence,chinese_hint,options[],correct_answer}
 */
export async function generateQuestions(type, wordData, onProgress) {
  const action = type === 'cloze' ? 'cloze_questions' : 'definition_questions';
  const total = wordData.length;
  const out = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = wordData.slice(i, i + BATCH_SIZE);
    const res = await callCloud('ai', { action, words: batch });
    const raw = parseJsonArray(res && res.content);
    if (onProgress) {
      try { onProgress(Math.min(i + BATCH_SIZE, total), total); } catch (e) { /* 忽略进度回调异常 */ }
    }

    for (const item of raw) {
      const word = String(item.target_word || '');
      const src = wordData.find((w) => w.word.toLowerCase() === word.toLowerCase()) || {};
      if (type === 'cloze') {
        if (!item.sentence || !item.options || !item.correct_answer) continue;
        out.push({
          type: 'cloze',
          word_id: src.word_id || '',
          target_word: word,
          sentence: item.sentence,
          chinese_hint: item.chinese_hint || '',
          options: shuffle(item.options),
          correct_answer: item.correct_answer,
        });
      } else {
        if (!item.sentence || !item.options || !item.correct_definition) continue;
        out.push({
          type: 'definition',
          word_id: src.word_id || '',
          word,
          sentence: item.sentence,
          chinese_translation: item.chinese_translation || '',
          options: shuffle(item.options),
          correct_definition: item.correct_definition,
        });
      }
    }
  }
  return out;
}

/** 取题目的正确答案（两种题型统一入口）。 */
export const correctAnswerOf = (q) =>
  (q.type === 'cloze' ? q.correct_answer : q.correct_definition) || '';

/**
 * 错题本记录 → 统一题目结构。
 * 错题快照是扁平的（word/type/sentence/options/correct_answer/…），
 * 「重做错题」要复用答题页，需要还原成 ExamQuestion。
 */
export function wrongToQuestion(wq) {
  const type = wq.type || 'definition';
  if (type === 'cloze') {
    return {
      type: 'cloze',
      word_id: wq.word_id || '',
      target_word: wq.target_word || wq.word || '',
      sentence: wq.sentence || '',
      chinese_hint: wq.chinese_hint || '',
      options: wq.options || [],
      correct_answer: wq.correct_answer || '',
    };
  }
  return {
    type: 'definition',
    word_id: wq.word_id || '',
    word: wq.word || '',
    sentence: wq.sentence || '',
    chinese_translation: wq.chinese_translation || '',
    options: wq.options || [],
    correct_definition: wq.correct_answer || '',
  };
}

/**
 * 生词在「生成文章」里的覆盖次数 —— 覆盖越多说明练得越透，
 * 智能推荐会优先挑覆盖少的词。返回 {wordId: count}。
 */
export function getWordArticleCoverage() {
  const map = {};
  for (const a of StorageService.getArticles()) {
    for (const id of a.word_ids || []) map[id] = (map[id] || 0) + 1;
  }
  return map;
}

/** 覆盖次数 → 展示文案（App 的 getCoverageLabel）。 */
export const getCoverageLabel = (n) => (n <= 0 ? '首次' : `第${n + 1}次`);

/** 覆盖次数 → 颜色语义（0 次绿、1 次橙、更多灰）。 */
export const getCoverageLevel = (n) => (n <= 0 ? 'success' : n === 1 ? 'warning' : 'muted');

/**
 * 智能推荐选词（对齐 App 的 getRecommendedWords）。
 *
 * 桶优先级：p0 到期复习 > p1 未覆盖且正确率<0.8 > p2 未覆盖且≥0.8
 *          > p3 覆盖1次且<0.8 > p4 覆盖1次且≥0.8 > rest（覆盖2次）
 * 覆盖 ≥3 次的词直接排除（已经练够了）。各桶内随机打乱后按序取前 count 个。
 *
 * @param {Array} words          生词本全部单词
 * @param {Object} coverage      {wordId: 覆盖次数}
 * @param {Object} accMap        {wordId: 历史正确率 0-1}
 * @param {number} count         需要几个词
 * @param {Object} lastStudyMap  {wordId: 最近学习日期}
 */
export function getRecommendedWords(words, coverage, accMap, count, lastStudyMap) {
  const cov = coverage || {};
  const acc = accMap || {};
  const last = lastStudyMap || {};
  const now = Date.now();

  /** 正确率越高，复习间隔越长（App 的规则）。 */
  const intervalOf = (a) => (a >= 0.8 ? 7 : a >= 0.5 ? 4 : 2);

  const buckets = { p0: [], p1: [], p2: [], p3: [], p4: [], rest: [] };

  for (const w of words) {
    const c = cov[w.id] || 0;
    if (c >= 3) continue;
    const a = acc[w.id] === undefined ? 1 : acc[w.id];
    const lastDate = last[w.id];

    if (c > 0 && lastDate && daysSince(lastDate, now) >= intervalOf(a)) {
      buckets.p0.push(w);
      continue;
    }
    if (c === 0) {
      (a < 0.8 ? buckets.p1 : buckets.p2).push(w);
      continue;
    }
    if (c === 1) {
      (a < 0.8 ? buckets.p3 : buckets.p4).push(w);
      continue;
    }
    buckets.rest.push(w);
  }

  const ordered = []
    .concat(shuffle(buckets.p0), shuffle(buckets.p1), shuffle(buckets.p2))
    .concat(shuffle(buckets.p3), shuffle(buckets.p4), shuffle(buckets.rest));

  return ordered.slice(0, count);
}

/** 每个词的历史正确率与最近学习日期（推荐算法与统计页共用）。 */
export function buildWordStats() {
  const acc = {};
  const last = {};
  const counts = {};
  for (const r of StorageService.getStudyRecords()) {
    const id = r.word_id;
    if (!id) continue;
    if (!counts[id]) counts[id] = { total: 0, correct: 0 };
    counts[id].total += 1;
    if (r.result === 1) counts[id].correct += 1;
    const d = r.study_date || '';
    if (!last[id] || d > last[id]) last[id] = d;
  }
  for (const id of Object.keys(counts)) {
    acc[id] = counts[id].total > 0 ? counts[id].correct / counts[id].total : 1;
  }
  return { acc, last, counts };
}

// ======================  题库分组  ======================

/**
 * 把练习会话按套题聚合（App 的 buildExamSets）。
 * 同一套题由 origin_id 关联；错题复习来源不进题库；按出题时间倒序。
 */
export function buildExamSets(sessions) {
  const groups = new Map();
  for (const s of sessions || []) {
    const key = s.origin_id || s.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const sets = [];
  for (const [rootId, members] of groups) {
    members.sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0));
    if (members[0].source === 'wrong_review') continue; // 错题复习不入题库
    const latest = members[0];
    const root = members[members.length - 1];
    sets.push({
      rootId,
      members,
      latest,
      total: (latest.questions || []).length,
      accuracy: latest.accuracy || 0,
      questionType: latest.question_type,
      createdAt: root.created_at,
      lastAt: latest.created_at,
    });
  }
  sets.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  return sets;
}

// ======================  解析高亮  ======================

/**
 * 把句子按目标词切成片段，供 WXML 渲染高亮。
 * AI 生成的句子用 **词** 标记；没有标记时按整词匹配兜底（兼容屈折变化）。
 * @returns {Array<{text:string, isWord:boolean}>}
 */
export function parseWordHighlight(sentence, word) {
  const text = String(sentence || '');
  if (!text) return [];

  // 优先用 **词** 标记
  if (text.indexOf('*') >= 0) {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts
      .filter((p) => p !== '')
      .map((p) => {
        const m = /^\*\*?([^*]+)\*\*?$/.exec(p);
        if (m) return { text: m[1], isWord: true };
        return { text: p.replace(/\*/g, ''), isWord: false };
      });
  }

  if (!word) return [{ text, isWord: false }];
  const safe = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 允许常见词尾变化：s / es / ed / ing / d
  const re = new RegExp(`\\b(${safe})(s|es|ed|ing|d)?\\b`, 'gi');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), isWord: false });
    out.push({ text: m[0], isWord: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isWord: false });
  return out.length ? out : [{ text, isWord: false }];
}

/** 完形句子按 [BLANK] 拆成前 / 空 / 后三段。 */
export function splitBlank(sentence) {
  const parts = String(sentence || '').split(/\[BLANK\]|\[\d+\]|_{2,}/i);
  return { before: parts[0] || '', after: parts.slice(1).join('') || '' };
}
