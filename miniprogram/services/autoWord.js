/**
 * 自动配词 —— 移植自 memo-grad AutoWordService。
 * 语义：生词本中「从未学过的新词」不足每日限额时按考频补足；
 * 同频档内用日期种子确定性洗牌，同一天结果一致。
 *
 * 注意：候选池的筛选与洗牌放在 worddict 云函数的 `pick` 里做，不在客户端拉全量 ——
 * 词库 4801 条约 3.4MB，而小程序链路单次响应上限 1MB，整包拉回必失败。
 */
import StorageService from './storage';
import { formatDate, diffDays } from '../utils/util';
import { REVIEW_INTERVALS } from '../theme/tokens';
import { pickWorddict } from './worddict';

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

    // 候选池：词库剔除已有（含软删除）+ 忽略。
    // 挑选放服务端做 —— 词库 3.4MB，整包拉回客户端会撞 1MB 响应上限。
    const existKeys = StorageService.getWordbookKeysIncludingDeleted();
    const ignored = StorageService.getIgnoredWordbankWords();
    const picked = await pickWorddict({
      exclude: Array.from(existKeys),
      ignored,
      limit: gap,
      seed: Number(today.replace(/-/g, '')) || 0,
    });

    // 候选池空 → 从已学词按复习间隔抽到期复习词
    let candidates = picked.candidates > 0 ? picked.words : pickReviewFallback(words, records, dailyLimit);
    if (candidates.length === 0) return 0;

    let added = 0;
    for (const entry of candidates.slice(0, gap)) {
      // 复习兜底拿回来的是生词本里已有的词，不能重复添加
      const key = String(entry.word || '').toLowerCase();
      if (existKeys.has(key)) continue;
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
