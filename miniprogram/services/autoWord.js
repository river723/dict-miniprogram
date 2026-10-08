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
import { pickWorddict, searchWorddict } from './worddict';

// 最近一次配词结果：用于「继续学习」区分『词库真·用尽』与『配词失败/超时』，
// 避免把网络/云函数抖动误报成「词库已用尽」，让用户误以为自动配词开关失效。
let lastResult = { exhausted: false, error: null };

/**
 * 自动配词。返回本次「实际新加入生词本的数量」（数字）。
 *
 * 非 force 调用依赖 doFill 内部的 autoFillLastDate 幂等（同一天只配一次）；
 * 不再用模块级 inflight 单飞，否则「继续学习」(force) 的强制补充会被 refresh
 * 的非强制调用结果覆盖（拿到 added=0 而误报词库已用尽）。
 *
 * 失败原因通过 getLastFillResult() 暴露给 UI。
 */
export function fillTodayIfNeeded(options = {}) {
  const force = options.force === true || options.forceRefill === true;
  return doFill(force, options.forceRefill === true)
    .then((r) => {
      lastResult = { exhausted: !!(r && r.exhausted), error: null };
      return (r && r.added) || 0;
    })
    .catch((e) => {
      console.error('[AutoWord] 配词失败', e);
      lastResult = { exhausted: false, error: (e && e.message) || 'unknown' };
      return 0;
    });
}

/** 读取最近一次配词的结果，供 UI 区分失败类型。 */
export function getLastFillResult() {
  return lastResult;
}

/**
 * 返回 { added, exhausted }：
 * - added：本次实际新加入生词本的数量；
 * - exhausted：true 表示「确实无新词可调度」（候选池真空且复习兜底也空），对应『词库已用尽』；
 *   false 仅代表『本次未补充』（开关关 / 今日已配 / 已够额度 / 配词失败）。
 * 真正的异常（云函数超时 / 网络抖动）会抛出，由 fillTodayIfNeeded 的 .catch 记录为 lastResult.error。
 */
async function doFill(force, forceRefill) {
  try {
    const settings = StorageService.getSettings();
    if (settings.autoAddNewWords !== true) return { added: 0, exhausted: false };

    const today = formatDate();
    if (!force && !forceRefill && StorageService.getAutoFillLastDate() === today) {
      return { added: 0, exhausted: false };
    }

    const dailyLimit = typeof settings.dailyNewWords === 'number' ? settings.dailyNewWords : 10;
    const words = StorageService.getWords();
    const records = StorageService.getStudyRecords();
    const studiedIds = new Set(records.map((r) => r.word_id));
    const unstudied = words.filter((w) => !studiedIds.has(w.id) && !w.deleted).length;

    const gap = forceRefill ? dailyLimit : dailyLimit - unstudied;
    if (!forceRefill && gap <= 0) {
      StorageService.setAutoFillLastDate(today);
      return { added: 0, exhausted: false };
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
    if (candidates.length === 0) return { added: 0, exhausted: true };

    // 诊断：打印词库候选词是否带扩展字段，用于确认 wordict 云函数是否已部署（FIELDS 修复上线）
    // 以及 worddict 集合里这些字段是否真有值。连接真机点「继续学习」即可在 console 看到。
    if (picked.candidates > 0 && picked.words[0]) {
      const s = picked.words[0];
      console.log(
        '[AutoWord][诊断] 词库候选样本 keys=',
        Object.keys(s).join(','),
        '| 词根=', !!s.etymology,
        '| 易混词=', !!(s.similar_words && s.similar_words.length),
        '| 记忆=', !!s.memory_tip,
        '| 音标UK=', !!s.pronunciation_uk,
      );
    }

    let added = 0;
    // 用 search action（返回全文档，无 field 限制）补全候选词的扩展字段，
    // 这样即便线上 wordict 云函数的 pick 仍跑旧 FIELDS，自动配词补进生词本的词也能带全信息。
    const toAdd = candidates.slice(0, gap);
    const enriched = await Promise.all(toAdd.map((e) => enrichCandidate(e)));
    for (const entry of enriched) {
      // 复习兜底拿回来的是生词本里已有的词，不能重复添加
      const key = String(entry.word || '').toLowerCase();
      if (existKeys.has(key)) continue;
      await StorageService.addWord(entry);
      added += 1;
    }
    StorageService.setAutoFillLastDate(today);
    return { added, exhausted: false };
  } catch (e) {
    // 真正的配词失败（云函数超时 / 网络抖动）抛出，由上层记录为 error，
    // 绝不静默成「词库已用尽」。
    console.error('[AutoWord] 配词失败', e);
    throw e;
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

/**
 * 补全单条候选词的扩展字段（词根/记忆/易混词/音标）。
 * 用 search action（返回全文档，无 field 限制）兜底——不依赖 wordict 云函数 pick 的 FIELDS 部署。
 * 若 pick 已返回扩展字段则直接返回；补全失败也不阻断配词（原样返回）。
 */
async function enrichCandidate(entry) {
  if (entry.etymology || (entry.similar_words && entry.similar_words.length) || entry.memory_tip) {
    return entry;
  }
  try {
    const { words } = await searchWorddict({ keyword: entry.word });
    const full = words && words.find(
      (w) => String(w.word).toLowerCase() === String(entry.word).toLowerCase()
    );
    if (!full) return entry;
    return {
      ...entry,
      etymology: entry.etymology || full.etymology || '',
      memory_tip: entry.memory_tip || full.memory_tip || '',
      similar_words: entry.similar_words && entry.similar_words.length
        ? entry.similar_words
        : (full.similar_words || []),
      pronunciation_uk: entry.pronunciation_uk || full.pronunciation_uk || '',
      pronunciation_us: entry.pronunciation_us || full.pronunciation_us || '',
    };
  } catch (e) {
    return entry;
  }
}

/**
 * 一次性回填：生词本里缺失扩展字段（词根/记忆/易混词）的词，从词库补全。
 * 用 search action 取全文档，不依赖 wordict 云函数 pick 的 FIELDS 部署。
 * 已运行过（mg_flags.wordbookEnrichedV1）则跳过。分块并发避免一次性过多云调用。
 */
export async function enrichWordbookOnce() {
  try {
    if (StorageService.getFlag('wordbookEnrichedV1')) return;
    const needEnrich = StorageService.getWords().filter(
      (w) => !w.etymology && !w.memory_tip && !(w.similar_words && w.similar_words.length)
    );
    if (needEnrich.length === 0) {
      StorageService.setFlag('wordbookEnrichedV1', true);
      return;
    }
    const CHUNK = 8;
    for (let i = 0; i < needEnrich.length; i += CHUNK) {
      const batch = needEnrich.slice(i, i + CHUNK);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map(async (w) => {
        try {
          const { words } = await searchWorddict({ keyword: w.word });
          const full = words && words.find(
            (f) => String(f.word).toLowerCase() === String(w.word).toLowerCase()
          );
          if (full) {
            await StorageService.updateWord(w.id, {
              etymology: full.etymology || '',
              memory_tip: full.memory_tip || '',
              similar_words: full.similar_words || [],
              pronunciation_uk: full.pronunciation_uk || '',
              pronunciation_us: full.pronunciation_us || '',
            });
          }
        } catch (e) { /* 单个词补全失败不影响整体 */ }
      }));
    }
    StorageService.setFlag('wordbookEnrichedV1', true);
  } catch (e) {
    console.error('[AutoWord] 回填生词本字段失败', e);
  }
}
