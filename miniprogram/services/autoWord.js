/**
 * 自动配词 —— 移植自 memo-grad AutoWordService。
 * 语义：生词本中「从未学过的新词」不足每日限额时按考频补足；
 * 同频档内用日期种子确定性洗牌（mulberry32），同一天结果一致。
 */
import StorageService from './storage';
import { formatDate, diffDays } from '../utils/util';
import { REVIEW_INTERVALS } from '../theme/tokens';
import { searchWorddict } from './worddict';

let inflight = null;

export function fillTodayIfNeeded(options = {}) {
  if (!inflight) {
    inflight = doFill(options.force === true, options.forceRefill === true)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function doFill(force, forceRefill) {
  try {
    const settings = StorageService.getSettings();
    if (settings.autoAddNewWords !== true) return 0;

    const today = formatDate();
    if (!force && !forceRefill && StorageService.getAutoFillLastDate() === today) return 0;

    const dailyLimit = typeof settings.dailyNewWords === 'number' ? settings.dailyNewWords : 10;
    const words = StorageService.getWords();
    const records = StorageService.getStudyRecords();
    const studiedIds = new Set(records.map((r) => r.word_id));
    const unstudied = words.filter((w) => !studiedIds.has(w.id) && !w.deleted).length;

    const gap = forceRefill ? dailyLimit : dailyLimit - unstudied;
    if (!forceRefill && gap <= 0) {
      StorageService.setAutoFillLastDate(today);
      return 0;
    }

    // 候选池：词库剔除已有（含软删除）+ 忽略
    const existKeys = StorageService.getWordbookKeysIncludingDeleted();
    const ignored = new Set(StorageService.getIgnoredWordbankWords().map((w) => w.toLowerCase()));
    const wordbank = await searchWorddict({ all: true });
    let candidates = wordbank.filter(
      (e) => !existKeys.has(e.word.toLowerCase()) && !ignored.has(e.word.toLowerCase())
    );

    // 兜底：候选池空 → 从已学词按复习间隔抽到期复习词
    if (candidates.length === 0) candidates = pickReviewFallback(words, records, dailyLimit);
    if (candidates.length === 0) return 0;

    const ordered = pickByFrequency(candidates, today);
    let added = 0;
    for (const entry of ordered.slice(0, gap)) {
      await StorageService.addWord(entry);
      added += 1;
    }
    StorageService.setAutoFillLastDate(today);
    return added;
  } catch (e) {
    console.error('[AutoWord] 配词失败', e);
    return 0;
  }
}

/** 复习词兜底：越久没复习越靠前。 */
function pickReviewFallback(myWords, records, limit) {
  const today = formatDate();
  const todayDone = new Set(
    records.filter((r) => r.study_date === today && r.result === 1).map((r) => r.word_id)
  );
  const withLast = myWords
    .filter((w) => !todayDone.has(w.id))
    .map((w) => {
      const rs = records.filter((r) => r.word_id === w.id);
      if (rs.length === 0) return null;
      const last = rs.reduce((m, r) => (r.study_date > m ? r.study_date : m), '');
      return REVIEW_INTERVALS.includes(diffDays(today, last)) ? { w, last } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.last < b.last ? -1 : 1));
  return withLast.slice(0, limit).map(({ w }) => w);
}

/** 频次降序分档 + 档内按日期种子确定性洗牌。 */
function pickByFrequency(candidates, today) {
  const groups = new Map();
  for (const e of candidates) {
    if (!groups.has(e.frequency)) groups.set(e.frequency, []);
    groups.get(e.frequency).push(e);
  }
  const rand = mulberry32(Number(today.replace(/-/g, '')) || 0);
  const ordered = [];
  for (const freq of Array.from(groups.keys()).sort((a, b) => b - a)) {
    const g = groups.get(freq);
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [g[i], g[j]] = [g[j], g[i]];
    }
    ordered.push(...g);
  }
  return ordered;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
