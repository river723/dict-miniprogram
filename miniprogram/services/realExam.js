/**
 * 真题内容服务 —— 数据按「年份 + 卷别」拆篇存在云存储，
 * 由 content 云函数的 examList / examDetail 分发。
 * 对应 App 的 utils/realExamContent.ts（getExamYears / getExamSet）。
 *
 * 单套卷结构：
 *   { id, year, type: 'english1'|'english2',
 *     reading: [{id, title?, passage, paragraphs?, questions:[{id,stem,options[],answer,explanation?}]}],
 *     cloze:   {id, passage, paragraphs?, blanks:[{index,options[],answer,explanation?}]} | null,
 *     newType: {id, subtype, direction, passage?, options[], questions[]} | null,
 *     translation: {id, subtype, direction, passage?, items[]} | null,
 *     writing: {id, parts:[{label,direction,sample?,sampleTranslation?,analysis?}]} | null }
 */
import { callCloud } from './cloud';

let indexCache = null;
const setCache = {};

/** 真题索引 [{id, year, title}]。 */
export async function getExamIndex() {
  if (indexCache) return indexCache;
  const res = await callCloud('content', { action: 'examList' });
  indexCache = (res && res.list) || [];
  return indexCache;
}

/** 年份倒序（App 的 getExamYears 等价物）。 */
export async function getExamYears() {
  const list = await getExamIndex();
  return [...new Set(list.map((e) => e.year))].sort((a, b) => b - a);
}

export const examSetId = (year, setId) => `${year}-${setId === 'english2' ? 'e2' : 'e1'}`;

/** 取单套卷（带内存缓存）。 */
export async function getExamSet(year, setId) {
  const id = examSetId(year, setId);
  if (setCache[id]) return setCache[id];
  const res = await callCloud('content', { action: 'examDetail', id });
  setCache[id] = (res && res.exam) || null;
  return setCache[id];
}

/** 试卷里各类题目的定位（答题页按参数找 paper）。 */
export function findPaper(set, kind, paperId) {
  if (!set) return null;
  if (kind === 'reading') return (set.reading || []).find((p) => p.id === paperId) || null;
  if (kind === 'cloze') return set.cloze && set.cloze.id === paperId ? set.cloze : null;
  if (kind === 'newtype') return set.newType && set.newType.id === paperId ? set.newType : null;
  if (kind === 'translation') return set.translation && set.translation.id === paperId ? set.translation : null;
  if (kind === 'writing') return set.writing && set.writing.id === paperId ? set.writing : null;
  return null;
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** 去掉选项文本里自带的 "A) " / "A. " / "A、" 前缀。 */
export function stripLetterPrefix(text) {
  if (!text) return '';
  return String(text).replace(/^\s*[A-Ha-h][).、．]\s*/, '');
}

/** 新题型子类型的中文标签。 */
export const SUBTYPE_LABEL = {
  ordering: '段落排序',
  heading: '段落小标题（7选5）',
  sentence: '选句填空（7选5）',
  matching: '多项对应（信息匹配）',
  truefalse: '正误判断（T/F）',
};

/** 真题作答结果：{[questionId]: 'A'|null} → 统一转成 answers + 得分。 */
export function buildRealExamAnswers(items, correctMap) {
  const answers = items.map((it) => ({
    questionId: it.questionId,
    selected: it.selected || null,
    correct: !!it.selected && it.selected === correctMap[it.questionId],
  }));
  const score = answers.filter((a) => a.correct).length;
  return { answers, score, total: answers.length };
}

/**
 * 真题错题 AI 解析（对应 App 的 AIService.generateRealExamExplanation）。
 * 返回纯文本解析；调用方负责回写错题快照。
 */
export async function generateRealExamExplanation(wq) {
  const res = await callCloud('ai', {
    action: 'real_exam_explanation',
    mode: wq.mode,
    stem: wq.stem,
    blankIndex: wq.blankIndex,
    options: wq.options || [],
    correctAnswer: wq.correctAnswer,
    userAnswer: wq.userAnswer,
  });
  return (res && res.content) || '';
}
