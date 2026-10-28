/**
 * StorageService（小程序版）—— 本地 wx.storage 缓存 + 云数据库写穿。
 * 移植自 memo-grad src/services/StorageService.ts，数据模型保持一致。
 *
 * 写穿策略：写操作先更新云数据库（_openid 自动隔离用户数据），成功后刷新本地缓存；
 * 离线时写本地并标记 dirty，下次启动时由 syncPending 上传。
 */
import { callCloud } from './cloud';
import { uuid, formatDate } from '../utils/util';

const K = {
  words: 'mg_words',
  records: 'mg_records',
  plans: 'mg_plans',
  wrong: 'mg_wrong',
  settings: 'mg_settings',
  fillDate: 'mg_autofill_date',
  ignored: 'mg_ignored_wordbank',
  articles: 'mg_articles',
  dirty: 'mg_dirty_ids',
  // 练习域（第二批）
  exams: 'mg_exam_sessions',
  examDraft: 'mg_exam_draft',
  examResult: 'mg_exam_result',
};

const mem = {};

const read = (key, fallback) => {
  if (!(key in mem)) {
    try { mem[key] = wx.getStorageSync(key) || fallback; } catch { mem[key] = fallback; }
  }
  return mem[key];
};
const write = (key, val) => { mem[key] = val; try { wx.setStorageSync(key, val); } catch {} };

/**
 * 启动时从云端全量拉取（增量游标后续迭代，初期数据量小全量足够）。
 *
 * 顺序很关键：必须先把本地未上推的写操作（脏队列）推上去，再用云端覆盖本地，
 * 否则离线新增/修改的数据会在这一刻被直接抹掉。
 */
async function pullAll() {
  await flushDirty();
  // 仍有没推出去的（如当前无网络）：这些 id 在覆盖时以本地为准，避免静默丢数据
  const pending = new Map(read(K.dirty, []).map((it) => [it.doc && it.doc.id, true]));
  pending.delete(undefined);
  try {
    const res = await callCloud('words', { action: 'pullAll' });
    write(K.words, mergeKeepingLocal(res.words || [], getWords(), pending));
    write(K.records, mergeKeepingLocal(res.records || [], getStudyRecords(), pending));
    write(K.plans, mergeKeepingLocal(res.plans || [], getStudyPlans(), pending));
    write(K.wrong, mergeKeepingLocal(res.wrongQuestions || [], getWrongQuestions(), pending));
    if (res.settings && pending.size === 0) write(K.settings, res.settings);
  } catch (e) {
    console.warn('[storage] 云端拉取失败，使用本地缓存', e);
  }
}

/** 云端文档为准，但 id 命中脏队列的用本地版本（云端还没收到，覆盖会丢数据）。 */
const mergeKeepingLocal = (serverDocs, localDocs, pending) => {
  const byId = new Map();
  for (const d of serverDocs) if (d && d.id) byId.set(d.id, d);
  for (const d of localDocs) {
    if (d && d.id && (pending.has(d.id) || !byId.has(d.id))) byId.set(d.id, d);
  }
  return [...byId.values()];
};

// ---------- Words ----------
const getWords = () => read(K.words, []).filter((w) => !w.deleted);

const getWordbookKeysIncludingDeleted = () =>
  new Set(read(K.words, []).map((w) => w.word.toLowerCase()));

async function addWord(entry) {
  const now = formatDate();
  const word = {
    id: uuid(),
    word: entry.word,
    definitions: entry.definitions || [],
    pronunciation_uk: entry.pronunciation_uk || '',
    pronunciation_us: entry.pronunciation_us || '',
    etymology: entry.etymology || '',
    memory_tip: entry.memory_tip || '',
    similar_words: entry.similar_words || [],
    frequency: entry.frequency || 0,
    difficulty: entry.difficulty || 3,
    created_at: now,
    created_ts: Date.now(),
    updated_at: now,
    updated_ts: Date.now(),
  };
  read(K.words, []).push(word);
  write(K.words, read(K.words, []));
  pushDirty('words', word, 'add');
  return word;
}

async function updateWord(id, patch) {
  const words = read(K.words, []);
  const w = words.find((x) => x.id === id);
  if (!w) return;
  Object.assign(w, patch, { updated_at: formatDate() });
  write(K.words, words);
  pushDirty('words', w, 'update');
}

/** 软删除：自动配词不会把删过的词加回。 */
async function deleteWord(id) { await updateWord(id, { deleted: true }); }

// ---------- StudyRecords ----------
const getStudyRecords = () => read(K.records, []);

async function addStudyRecord({ word_id, result, study_mode }) {
  const rec = {
    id: uuid(),
    word_id,
    result, // 1 认识 / 0 不认识
    study_mode: study_mode || 'flashcard',
    study_date: formatDate(),
  };
  read(K.records, []).push(rec);
  write(K.records, read(K.records, []));
  pushDirty('records', rec, 'add');
  return rec;
}

// ---------- StudyPlans ----------
const getStudyPlans = () => read(K.plans, []);

async function addStudyPlan(plan) {
  const p = { id: uuid(), completed: false, ...plan };
  read(K.plans, []).push(p);
  write(K.plans, read(K.plans, []));
  pushDirty('plans', p, 'add');
  return p;
}

async function completePlan(planId) {
  const plans = read(K.plans, []);
  const p = plans.find((x) => x.id === planId);
  if (p) {
    p.completed = true;
    write(K.plans, plans);
    pushDirty('plans', p, 'update');
  }
}

// ---------- WrongQuestions ----------
const getWrongQuestions = () => read(K.wrong, []);

/** 记录/更新错题：做对 mastery_count 次后自动移出（WRONG_QUESTION_MASTERY_THRESHOLD=3）。 */
async function recordWrongAnswer(word_id, question) {
  const list = read(K.wrong, []);
  let wq = list.find((x) => x.word_id === word_id);
  if (!wq) {
    wq = { id: uuid(), word_id, question: question || '', wrong_count: 0, mastery_count: 0, created_at: formatDate() };
    list.push(wq);
  }
  wq.wrong_count += 1;
  wq.mastery_count = 0;
  wq.updated_at = formatDate();
  write(K.wrong, list);
  pushDirty('wrongQuestions', wq, 'update');
}

async function recordWrongCorrect(word_id) {
  const list = read(K.wrong, []);
  const wq = list.find((x) => x.word_id === word_id);
  if (!wq) return false;
  wq.mastery_count += 1;
  wq.updated_at = formatDate();
  const mastered = wq.mastery_count >= 3;
  if (mastered) {
    wq.mastered = true;
  }
  write(K.wrong, list);
  pushDirty('wrongQuestions', wq, 'update');
  return mastered;
}

// ---------- Settings ----------
/** 与 App SettingsScreen 的字段保持一致（缺字段会导致设置页控件初值为 undefined）。 */
const DEFAULT_SETTINGS = {
  theme: 'light',            // light | dark | system
  dailyNewWords: 10,         // 1 - 50
  autoAddNewWords: true,
  examQuestionCount: 10,     // 5 - 20
  examAutoAdvance: true,     // 答对后 2.5s 自动下一题
  soundEnabled: true,
  autoPlaySound: true,       // soundEnabled 为 false 时强制 false
  articleWordCount: 10,      // 5 - 20
  articleLength: 200,        // 100 - 500，步长 50
  aiProvider: 'deepseek',
  activeLibraryId: 'all',   // 激活词库：'all'=云端考研词库 / 'ielts'=内置雅思基础词汇
};

const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(K.settings, {}) });

/** 当前激活词库 id（自动配词据此切换候选来源）；非法值回落 'all'。 */
const getActiveLibraryId = () => {
  const id = getSettings().activeLibraryId;
  return id === 'ielts' ? 'ielts' : 'all';
};

async function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  // 关闭发音功能时，自动发音必须一起关掉（App 侧同规则）
  if (s.soundEnabled === false) s.autoPlaySound = false;
  write(K.settings, s);
  pushDirty('settings', s, 'update');
  return s;
}

/** 恢复默认设置（不动学习数据）。 */
async function resetSettings() {
  write(K.settings, { ...DEFAULT_SETTINGS });
  pushDirty('settings', { ...DEFAULT_SETTINGS }, 'update');
  return { ...DEFAULT_SETTINGS };
}

/** 清除所有本地数据 + 设置回到默认。 */
async function clearAllData() {
  const keys = Object.values(K).filter((k) => k !== K.dirty);
  for (const k of keys) {
    mem[k] = undefined;
    try { wx.removeStorageSync(k); } catch {}
  }
  write(K.settings, { ...DEFAULT_SETTINGS });
}

// ---------- 自动配词守卫 ----------
const getAutoFillLastDate = () => read(K.fillDate, '');
const setAutoFillLastDate = (d) => write(K.fillDate, d);

// ---------- 一次性迁移标记（如生词本字段回填） ----------
const getFlag = (key) => { const m = read('mg_flags', {}); return m[key]; };
const setFlag = (key, val) => { const m = read('mg_flags', {}); m[key] = val; write('mg_flags', m); };

const getIgnoredWordbankWords = () => read(K.ignored, []);
const saveIgnoredWordbankWords = (list) => write(K.ignored, Array.isArray(list) ? list : []);

// ---------- Articles（趣味文章，本地优先；生成后写本地缓存） ----------
const getArticles = () => {
  const list = read(K.articles, []);
  // 自愈：清掉历史遗留的「完全重复」条目（同标题 + 同正文 + 同目标词），
  // 否则修复前的旧数据会让列表出现两条一模一样的文章。仅在确有重复时才写回，避免每次读取都落盘。
  const seen = new Set();
  const clean = [];
  let hasDup = false;
  for (const a of list) {
    const sig = `${a.title} ${a.content} ${(a.word_ids || []).join(',')}`;
    if (seen.has(sig)) { hasDup = true; continue; }
    seen.add(sig);
    clean.push(a);
  }
  if (hasDup) write(K.articles, clean);
  return clean;
};

const getArticleById = (id) => read(K.articles, []).find((a) => a.id === id) || null;

async function updateArticle(id, patch) {
  const list = read(K.articles, []);
  const a = list.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch);
  write(K.articles, list);
}

async function addArticle(entry) {
  const list = read(K.articles, []);
  // 防重复：同一篇（标题 + 正文 + 目标词完全一致）只允许落一条。
  // 否则保存按钮在 navigateBack 延迟/失败期间被二次点击会写出两条一模一样的文章。
  const content = entry.content || '';
  const wordIds = (entry.word_ids || []).join(',');
  const title = entry.title || '未命名文章';
  const dup = list.find(
    (a) => a.title === title && a.content === content && (a.word_ids || []).join(',') === wordIds
  );
  if (dup) return dup;
  const now = formatDate();
  const article = {
    id: uuid(),
    title,
    content,
    translation: entry.translation || '',
    words: entry.words || [],
    word_ids: entry.word_ids || [],
    theme: entry.theme || 'random',
    read_count: 0,
    created_at: now,
  };
  list.unshift(article);
  write(K.articles, list);
  return article;
}

async function markArticleRead(id) {
  const list = read(K.articles, []);
  const a = list.find((x) => x.id === id);
  if (!a) return;
  a.read_count = (a.read_count || 0) + 1;
  write(K.articles, list);
}

async function deleteArticle(id) {
  write(K.articles, read(K.articles, []).filter((a) => a.id !== id));
}

// ---------- 便捷查询 ----------
const getWordById = (id) => read(K.words, []).find((w) => w.id === id && !w.deleted) || null;

const getStudyRecordsByDate = (date) => read(K.records, []).filter((r) => r.study_date === date);

// ---------- 练习会话 ExamSession（AI 出题） ----------
const getExamSessions = () => read(K.exams, []).filter((s) => !s.deleted);

/** 按 id 取单条练习记录（重做套题用）。 */
const getExamSessionById = (id) => getExamSessions().find((s) => s.id === id) || null;

async function saveExamSession(session) {
  const rec = {
    id: uuid(),
    questions: session.questions || [],
    answers: session.answers || [],
    question_type: session.question_type,
    accuracy: session.accuracy || 0,
    origin_id: session.origin_id || null,
    source: session.source || 'generation',
    deleted: false,
    created_at: session.created_at || formatDate(),
  };
  read(K.exams, []).unshift(rec);
  write(K.exams, read(K.exams, []));
  pushDirty('examSessions', rec, 'add');
  return rec;
}

/** 软删除：同一套题（origin_id 相同）的记录会一起消失，保留在库中以便云端对账。 */
async function deleteExamSession(id) {
  const list = read(K.exams, []);
  const s = list.find((x) => x.id === id);
  if (s) { s.deleted = true; write(K.exams, list); pushDirty('examSessions', s, 'update'); }
}

async function deleteExamSet(rootId) {
  const list = read(K.exams, []);
  for (const s of list) {
    if (s.id === rootId || s.origin_id === rootId) {
      s.deleted = true;
      pushDirty('examSessions', s, 'update');
    }
  }
  write(K.exams, list);
}

// ---------- 练习草稿（整套一份，与 App 一致） ----------
const getExamDraft = () => read(K.examDraft, null) || null;
const saveExamDraft = (draft) => write(K.examDraft, draft);
const clearExamDraft = () => write(K.examDraft, null);

// 答题页 → 结果页的一次性交接载荷（本地，不上云）：结果页消费后清空
const getExamResult = () => read(K.examResult, null) || null;
const saveExamResult = (payload) => write(K.examResult, payload);
const clearExamResult = () => write(K.examResult, null);

// ---------- 单词错题本（App 版模型：带题面快照） ----------
const getWrongQuestionByWord = (wordId) =>
  read(K.wrong, []).find((x) => x.word_id === wordId && !x.mastered) || null;

/**
 * 记录一次作答（App 的 addOrUpdateWrongQuestion 等价物）。
 * 答错：不存在则新建（wrong_count=1），存在则 wrong_count+1 并刷新用户答案；
 * 答对：若已在错题本则 correct_count+1，累计满 3 次直接移出。
 * @returns {{removed:boolean}} 是否因此被移出错题本
 */
async function addOrUpdateWrongQuestion(question, selectedAnswer, isCorrect) {
  const list = read(K.wrong, []);
  const key = question.word_id || question.word;
  const idx = list.findIndex((x) => (x.word_id || x.word) === key);
  const now = formatDate();

  if (!isCorrect) {
    if (idx >= 0) {
      const wq = list[idx];
      wq.wrong_count = (wq.wrong_count || 0) + 1;
      wq.wrong_answer = selectedAnswer || '';
      wq.last_attempt_at = now;
      wq.mastered = false;
      wq.updated_at = now;
      write(K.wrong, list);
      pushDirty('wrongQuestions', wq, 'update');
    } else {
      const wq = {
        id: uuid(),
        word_id: question.word_id || '',
        word: question.word || question.target_word || '',
        type: question.type || 'definition',
        sentence: question.sentence || '',
        options: question.options || [],
        correct_answer: question.correct_definition || question.correct_answer || '',
        chinese_translation: question.chinese_translation || '',
        chinese_hint: question.chinese_hint || '',
        target_word: question.target_word || '',
        wrong_answer: selectedAnswer || '',
        wrong_count: 1,
        correct_count: 0,
        mastered: false,
        last_attempt_at: now,
        created_at: now,
      };
      list.push(wq);
      write(K.wrong, list);
      pushDirty('wrongQuestions', wq, 'add');
    }
    return { removed: false };
  }

  if (idx < 0) return { removed: false };
  const wq = list[idx];
  wq.correct_count = (wq.correct_count || 0) + 1;
  wq.last_attempt_at = now;
  wq.updated_at = now;
  if (wq.correct_count >= 3) {
    list.splice(idx, 1);
    write(K.wrong, list);
    pushDirty('wrongQuestions', { ...wq, mastered: true }, 'delete');
    return { removed: true };
  }
  write(K.wrong, list);
  pushDirty('wrongQuestions', wq, 'update');
  return { removed: false };
}

async function removeWrongQuestion(id) {
  write(K.wrong, read(K.wrong, []).filter((x) => x.id !== id));
}

// ---------- 脏数据上推 ----------
function pushDirty(collection, doc, op) {
  const queue = read(K.dirty, []);
  queue.push({ collection, doc, op, t: Date.now() });
  write(K.dirty, queue);
  flushDirty();
}

let flushing = false;
async function flushDirty() {
  if (flushing) return;
  flushing = true;
  try {
    let queue = read(K.dirty, []);
    while (queue.length > 0) {
      const batch = queue.splice(0, 20);
      await callCloud('words', { action: 'pushDirty', batch }, { silent: true });
      write(K.dirty, queue);
    }
  } catch (e) {
    console.warn('[storage] 脏数据上推失败，待下次重试', e);
  } finally {
    flushing = false;
  }
}

export default {
  pullAll, flushDirty,
  getWords, getWordById, addWord, updateWord, deleteWord, getWordbookKeysIncludingDeleted,
  getStudyRecords, getStudyRecordsByDate, addStudyRecord,
  getStudyPlans, addStudyPlan, completePlan,
  getWrongQuestions, getWrongQuestionByWord, addOrUpdateWrongQuestion, removeWrongQuestion,
  recordWrongAnswer, recordWrongCorrect,
  getSettings, saveSettings, resetSettings, clearAllData, DEFAULT_SETTINGS, getActiveLibraryId,
  getAutoFillLastDate, setAutoFillLastDate,
  getFlag, setFlag,
  getIgnoredWordbankWords, saveIgnoredWordbankWords,
  getArticles, addArticle, getArticleById, updateArticle, markArticleRead, deleteArticle,
  // 练习域
  getExamSessions, saveExamSession, deleteExamSession, deleteExamSet,
  getExamSessionById,
  getExamDraft, saveExamDraft, clearExamDraft,
  getExamResult, saveExamResult, clearExamResult,
};
