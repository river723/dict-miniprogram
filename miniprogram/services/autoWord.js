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
import { getLibraryWords, seededShuffle } from './libraries';
import { fromCloudEntry, enrichSync } from './wordEnrich';

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
    const existKeys = StorageService.getWordbookKeysIncludingDeleted();
    const ignored = StorageService.getIgnoredWordbankWords();
    const seed = Number(today.replace(/-/g, '')) || 0;
    const activeLibraryId = settings.activeLibraryId || 'all';

    let candidates = [];
    let usingClientLibrary = false;

    // 内置词库：候选池在客户端本地完成，确定性洗牌代替考频排序（同 seed 稳定、跨天轮换）。
    if (activeLibraryId !== 'all') {
      const libWords = getLibraryWords(activeLibraryId);
      if (libWords && libWords.length) {
        usingClientLibrary = true;
        const excludeSet = new Set(
          [...existKeys, ...ignored].map((k) => String(k).toLowerCase())
        );
        const pool = libWords.filter((w) => !excludeSet.has(String(w).toLowerCase()));
        candidates = seededShuffle(pool, seed)
          .slice(0, gap)
          .map((w) => ({ word: w }));
        if (candidates.length === 0) return { added: 0, exhausted: true };
      }
      // libWords 为空（未知词库）→ 回落云端考研词库
    }

    if (!usingClientLibrary) {
      // 云端考研词库：挑选放服务端做 —— 词库 3.4MB，整包拉回客户端会撞 1MB 响应上限。
      const picked = await pickWorddict({
        exclude: Array.from(existKeys),
        ignored,
        limit: gap,
        seed,
      });

      // 候选池空 → 从已学词按复习间隔抽到期复习词
      candidates = picked.candidates > 0 ? picked.words : pickReviewFallback(words, records, dailyLimit);
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
    }

    let added = 0;
    // 用 search action（返回全文档，无 field 限制）补全候选词的扩展字段，
    // 这样即便线上 wordict 云函数的 pick 仍跑旧 FIELDS，自动配词补进生词本的词也能带全信息。
    const toAdd = candidates.slice(0, gap);
    const enriched = await Promise.all(toAdd.map((e) => enrichCandidate(e, activeLibraryId)));
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
 * 查某个词的云端完整词条（自动配词 / 回填生词本用）。
 * 按传入词库先查自己的集合，未命中再查考研集合兜底 ——
 * 雅思 4491 词中 2758 个与考研重叠，两边都有完整词条；云端雅思集合还没导入时，
 * 这条兜底保证老行为不退化（早年就是只查考研库）。
 */
async function lookupFullWord(word, lib) {
  const libs = lib === 'all' ? ['all'] : [lib, 'all'];
  for (const l of libs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { words } = await searchWorddict({ keyword: word, lib: l });
      const full = words && words.find(
        (w) => String(w.word).toLowerCase() === String(word).toLowerCase()
      );
      if (full) return full;
    } catch (e) { /* 这个库没查到/查失败，换下一个 */ }
  }
  return null;
}

/**
 * 把云端原始文档收敛成「整串释义」兜底单条（本地内置词库 d 串的同款结构）。
 * 用于云端无结构化 definitions 时，保证生词本里至少有中文释义可显示。
 */
function defStringToRow(def) {
  return def
    ? [{ part_of_speech: '', meaning: String(def).trim(), example: '', is_core: true, is_rare_sense: false }]
    : [];
}

/**
 * 补全单条候选词的扩展字段（词根/记忆/易混词/音标/**结构化中文释义**）。
 * 用 search action（返回全文档，无 field 限制）兜底——不依赖 wordict 云函数 pick 的 FIELDS 部署。
 *
 * ⚠️ 修复点：旧版只搬 etymology/memory/similar/pronunciation，**漏搬 definitions**。
 *   云端考研候选（pick 已带回 definitions）没问题；但「内置词库（雅思）候选」是客户端
 *   生成的 `{word}` 裸串，definitions 只能靠这里从云端富词条取——漏搬会导致雅思词
 *   加入生词本后卡片背面没有中文释义（词库里明明有）。
 *   云端未命中（如雅思集合尚未导入/离线）再回落本地内置词条的整串释义 d。
 *
 * 若 pick 已带回全量字段（含 definitions）则原样返回，避免重复云调用。
 * @param {object} entry 候选词
 * @param {string} lib   候选词所属词库（决定先查哪个云集合）
 */
async function enrichCandidate(entry, lib) {
  // 候选词已带全量扩展字段（云端 pick 已返回 definitions + 词根/记忆/易混词）则直接返回
  if (entry.definitions && entry.definitions.length &&
      (entry.etymology || (entry.similar_words && entry.similar_words.length) || entry.memory_tip)) {
    return entry;
  }

  const word = entry.word;
  let etymology = entry.etymology || '';
  let memory_tip = entry.memory_tip || '';
  let similar_words = entry.similar_words && entry.similar_words.length ? entry.similar_words : [];
  let pronunciation_uk = entry.pronunciation_uk || '';
  let pronunciation_us = entry.pronunciation_us || '';
  let definitions = entry.definitions && entry.definitions.length ? entry.definitions : [];

  // 云端富词条（按 lib 选集合，未命中再查考研兜底）：结构化 definitions 含例句
  const full = await lookupFullWord(word, lib);
  if (full) {
    const norm = fromCloudEntry(full);
    if (!etymology) etymology = norm.etymology || '';
    if (!memory_tip) memory_tip = norm.memory_tip || '';
    if (!similar_words.length) similar_words = norm.similar_words || [];
    // 雅思集合用 phonetic_uk；考研集合无音标（发音走 TTS）
    if (!pronunciation_uk) pronunciation_uk = norm.ph || '';
    if (!pronunciation_us) pronunciation_us = full.pronunciation_us || '';
    if (!definitions.length && norm.definitions && norm.definitions.length) {
      definitions = norm.definitions;
    }
  }

  // 云端未命中（如雅思集合尚未导入）或云端也无结构化释义：回落本地内置词条，
  // 至少保证「中文释义」存在（本地 d 是整串释义），避免卡片背面空白。
  if (!definitions.length) {
    const localLibs = lib === 'all' ? ['all', 'ielts'] : [lib, 'all'];
    for (const l of localLibs) {
      const local = enrichSync(l, word);
      if (local && local.def) {
        definitions = defStringToRow(local.def);
        if (!pronunciation_uk && local.ph) pronunciation_uk = local.ph;
        break;
      }
    }
  }

  return {
    word,
    definitions,
    etymology,
    memory_tip,
    similar_words,
    pronunciation_uk,
    pronunciation_us,
  };
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
    const lib = (StorageService.getSettings().activeLibraryId) || 'all';
    for (let i = 0; i < needEnrich.length; i += CHUNK) {
      const batch = needEnrich.slice(i, i + CHUNK);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map(async (w) => {
        try {
          const full = await lookupFullWord(w.word, lib);
          if (full) {
            await StorageService.updateWord(w.id, {
              etymology: full.etymology || '',
              memory_tip: full.memory_tip || '',
              similar_words: full.similar_words || [],
              pronunciation_uk: full.phonetic_uk || full.pronunciation_uk || '',
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

/**
 * 一次性回填：生词本里缺失「结构化中文释义」的词，从词库补全。
 * 修复历史遗留——旧版 enrichCandidate 漏搬 definitions，导致通过自动配词进入生词本的
 * 雅思词（客户端裸 `{word}` 候选）没有中文释义，卡片背面空白。
 * 已运行过（mg_flags.wordbookDefsV1）则跳过。分块并发避免一次性过多云调用；
 * 云端未命中再回落本地内置词条的整串释义。
 */
export async function enrichWordbookDefinitionsOnce() {
  try {
    if (StorageService.getFlag('wordbookDefsV1')) return;
    const needDefs = StorageService.getWords().filter(
      (w) => !(w.definitions && w.definitions.length)
    );
    if (needDefs.length === 0) {
      StorageService.setFlag('wordbookDefsV1', true);
      return;
    }
    const CHUNK = 8;
    const lib = (StorageService.getSettings().activeLibraryId) || 'all';
    for (let i = 0; i < needDefs.length; i += CHUNK) {
      const batch = needDefs.slice(i, i + CHUNK);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map(async (w) => {
        try {
          const full = await lookupFullWord(w.word, lib);
          let definitions = [];
          let ph = '';
          if (full) {
            const norm = fromCloudEntry(full);
            if (norm.definitions && norm.definitions.length) definitions = norm.definitions;
            if (norm.ph) ph = norm.ph;
          }
          if (!definitions.length) {
            const localLibs = lib === 'all' ? ['all', 'ielts'] : [lib, 'all'];
            for (const l of localLibs) {
              const local = enrichSync(l, w.word);
              if (local && local.def) {
                definitions = defStringToRow(local.def);
                if (!ph && local.ph) ph = local.ph;
                break;
              }
            }
          }
          if (definitions.length || ph) {
            const patch = {};
            if (definitions.length) patch.definitions = definitions;
            if (ph && !w.pronunciation_uk) patch.pronunciation_uk = ph;
            await StorageService.updateWord(w.id, patch);
          }
        } catch (e) { /* 单个词补全失败不影响整体 */ }
      }));
    }
    StorageService.setFlag('wordbookDefsV1', true);
  } catch (e) {
    console.error('[AutoWord] 回填生词本释义失败', e);
  }
}
