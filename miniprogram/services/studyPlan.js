/**
 * 复习/到期词选择 + 统计 —— 移植自 memo-grad StudyPlanService。
 * 核心算法：艾宾浩斯 REVIEW_INTERVALS=[1,2,4,7,15,30]，
 * 正确率≥0.8 升档、否则回落到间隔 1。
 */
import StorageService from './storage';
import { formatDate, addDays, subDays, diffDays, weekdayLabel } from '../utils/util';
import { REVIEW_INTERVALS, UI_CONFIG } from '../theme/tokens';

/** 今日到期复习词：最后学习日距今天数命中任一复习间隔。 */
export function getDueReviewWords() {
  const today = formatDate();
  const words = StorageService.getWords();
  const records = StorageService.getStudyRecords();
  return words.filter((w) => {
    const rs = records.filter((r) => r.word_id === w.id);
    if (rs.length === 0) return false;
    if (rs.some((r) => r.study_date === today)) return false; // 今天已学过
    const last = rs.reduce((m, r) => (r.study_date > m ? r.study_date : m), '');
    return REVIEW_INTERVALS.includes(diffDays(today, last));
  });
}

/** 今日待学新词（生词本中从未有学习记录的）。 */
export function getTodayNewWords() {
  const records = StorageService.getStudyRecords();
  const studied = new Set(records.map((r) => r.word_id));
  return StorageService.getWords().filter((w) => !studied.has(w.id));
}

/** 根据某词历史正确率计算下一次复习间隔。 */
export function nextIntervalForWord(wordId) {
  const records = StorageService.getStudyRecords().filter((r) => r.word_id === wordId);
  if (records.length === 0) return REVIEW_INTERVALS[0];
  const rate = records.filter((r) => r.result === 1).length / records.length;
  if (rate >= UI_CONFIG.MIN_CORRECT_RATE_FOR_ADVANCE) {
    const last = records.reduce((m, r) => (r.study_date > m ? r.study_date : m), '');
    const since = diffDays(formatDate(), last);
    // 找到当前所处档位并 +1，封顶
    let idx = REVIEW_INTERVALS.findIndex((i) => i >= since);
    if (idx < 0) idx = REVIEW_INTERVALS.length - 1;
    return REVIEW_INTERVALS[Math.min(idx + 1, REVIEW_INTERVALS.length - 1)];
  }
  return REVIEW_INTERVALS[0]; // 回落
}

/** 学习结果落库：记录 + 计划完成 + 生成后续复习计划。 */
export async function recordStudyResult(word, result, studyMode) {
  await StorageService.addStudyRecord({ word_id: word.id, result, study_mode: studyMode });
  const interval = nextIntervalForWord(word.id);
  return StorageService.addStudyPlan({
    word_id: word.id,
    plan_date: formatDate(addDays(new Date(), interval)),
    plan_type: 'review',
    completed: false,
  });
}

/** 近 7 天学习趋势（统计页用）。 */
export function getWeeklyTrend() {
  const records = StorageService.getStudyRecords();
  const plans = StorageService.getStudyPlans();
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = subDays(new Date(), i);
    const date = formatDate(d);
    const dayRecords = records.filter((r) => r.study_date === date);
    const correct = dayRecords.filter((r) => r.result === 1).length;
    const dayPlans = plans.filter((p) => p.plan_date === date);
    const completed = dayPlans.filter((p) => p.completed).length;
    trend.push({
      date,
      dayLabel: weekdayLabel(d),
      studyCount: dayRecords.length,
      correctCount: correct,
      accuracy: dayRecords.length ? correct / dayRecords.length : null,
      plannedCount: dayPlans.length,
      completedCount: completed,
    });
  }
  return trend;
}

/** 掌握度统计：学过且正确率≥0.8 记为已掌握。 */
export function getMasteryStats() {
  const words = StorageService.getWords();
  const records = StorageService.getStudyRecords();
  const byWord = new Map();
  for (const r of records) {
    if (!byWord.has(r.word_id)) byWord.set(r.word_id, { total: 0, correct: 0 });
    const s = byWord.get(r.word_id);
    s.total += 1;
    s.correct += r.result;
  }
  let mastered = 0;
  let learned = 0;
  for (const [, s] of byWord) {
    if (s.total > 0) learned += 1;
    if (s.total > 0 && s.correct / s.total >= 0.8) mastered += 1;
  }
  return { totalWords: words.length, learnedWords: learned, masteredWords: mastered };
}
