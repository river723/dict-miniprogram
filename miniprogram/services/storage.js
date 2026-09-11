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
  dirty: 'mg_dirty_ids',
};

const mem = {};

const read = (key, fallback) => {
  if (!(key in mem)) {
    try { mem[key] = wx.getStorageSync(key) || fallback; } catch { mem[key] = fallback; }
  }
  return mem[key];
};
const write = (key, val) => { mem[key] = val; try { wx.setStorageSync(key, val); } catch {} };

/** 启动时从云端全量拉取（增量游标后续迭代，初期数据量小全量足够）。 */
async function pullAll() {
  try {
    const res = await callCloud('words', { action: 'pullAll' });
    write(K.words, res.words || []);
    write(K.records, res.records || []);
    write(K.plans, res.plans || []);
    write(K.wrong, res.wrongQuestions || []);
    if (res.settings) write(K.settings, res.settings);
  } catch (e) {
    console.warn('[storage] 云端拉取失败，使用本地缓存', e);
  }
}

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
    frequency: entry.frequency || 0,
    difficulty: entry.difficulty || 3,
    created_at: now,
    updated_at: now,
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
const DEFAULT_SETTINGS = {
  dailyNewWords: 10,
  autoAddNewWords: true,
  aiProvider: 'deepseek',
};

const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(K.settings, {}) });

async function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  write(K.settings, s);
  pushDirty('settings', s, 'update');
}

// ---------- 自动配词守卫 ----------
const getAutoFillLastDate = () => read(K.fillDate, '');
const setAutoFillLastDate = (d) => write(K.fillDate, d);

const getIgnoredWordbankWords = () => read(K.ignored, []);

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
  getWords, addWord, updateWord, deleteWord, getWordbookKeysIncludingDeleted,
  getStudyRecords, addStudyRecord,
  getStudyPlans, addStudyPlan, completePlan,
  getWrongQuestions, recordWrongAnswer, recordWrongCorrect,
  getSettings, saveSettings,
  getAutoFillLastDate, setAutoFillLastDate,
  getIgnoredWordbankWords,
};
