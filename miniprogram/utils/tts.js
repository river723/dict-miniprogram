/**
 * 单词发音 —— 经 tts 云函数中转，落本地文件后播放。
 *
 * 背景：直接播 `https://dict.youdao.com/dictvoice` 在体验版/正式版必然失败
 * （第三方域名无法配置为合法域名），所以改为「云函数代拉 → base64 → 写本地文件 → 播」。
 *
 * ⚠️ 本地缓存不是优化，而是这套方案能不能成立的前提：
 * 基础版云函数调用只有 20 万次/月，每次播放都走云端的话约 67 个重度用户就打满。
 * 缓存后做到「每个设备每个词只调一次云函数，重复播放 0 调用 0 流量」。
 *
 * 存储边界（已核实）：
 *   - 本地用户文件 + 缓存文件合计上限 **200 MB** → 4801 词全缓存约 62 MB 占 31%，
 *     所以这里用 LRU **只留最近 400 个**（约 5 MB），背词是滚动的，老词缓存了也用不上。
 *   - Storage 单 key 上限 1 MB、总上限 10 MB → 索引只存 word→文件名+时间戳，足够小。
 */
import { callCloud } from '../services/cloud';

const IDX_KEY = 'tts_cache_v1';
const MAX_FILES = 400;
const TYPE = 2; // 2=英音（与原实现 dictvoice?type=2 一致）

/** word → { f: 文件名, t: 时间戳 } */
let index = null;
/** 正在拉取的词，避免同一个词并发重复请求 */
const pending = new Map();

function fs() {
  return wx.getFileSystemManager();
}

function dir() {
  return `${wx.env.USER_DATA_PATH}/tts`;
}

function norm(word) {
  return String(word == null ? '' : word).trim().toLowerCase();
}

/**
 * 文件名：单词本身（可读、便于排查）+ 短哈希（避免不同写法撞名）。
 * 扩展名用云函数嗅探出的真实格式 —— 有道并非一律返回 MP3（实测 communism 返回 WAV），
 * 一律存成 .mp3 在部分机型上会解码失败。
 */
function fileName(key, ext) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  const base = key.replace(/[^a-z0-9]+/g, '_').slice(0, 32);
  return `${base}_${(h >>> 0).toString(36)}.${ext}`;
}

function loadIndex() {
  if (index) return index;
  try {
    const v = wx.getStorageSync(IDX_KEY);
    index = v && typeof v === 'object' ? v : {};
  } catch (e) {
    index = {};
  }
  return index;
}

function saveIndex() {
  try {
    wx.setStorageSync(IDX_KEY, index);
  } catch (e) {
    // 索引写失败最多导致下次重新拉取，不影响播放
  }
}

function drop(key) {
  const idx = loadIndex();
  const rec = idx[key];
  if (!rec) return;
  delete idx[key];
  saveIndex();
  try {
    fs().unlink({ filePath: `${dir()}/${rec.f}` });
  } catch (e) { /* noop */ }
}

/** LRU：超出上限就按时间从旧到新删。 */
function trim() {
  const idx = loadIndex();
  const keys = Object.keys(idx);
  if (keys.length <= MAX_FILES) return;
  keys.sort((a, b) => (idx[a].t || 0) - (idx[b].t || 0));
  const dropCount = keys.length - MAX_FILES;
  for (let i = 0; i < dropCount; i += 1) drop(keys[i]);
}

function ensureDir() {
  try {
    fs().mkdir({ dirPath: dir(), recursive: true });
  } catch (e) {
    // 已存在时会抛，忽略
  }
}

function fileExists(path) {
  try {
    fs().accessSync(path);
    return true;
  } catch (e) {
    return false;
  }
}

function writeBase64(path, b64) {
  return new Promise((resolve, reject) => {
    fs().writeFile({
      filePath: path,
      data: b64,
      encoding: 'base64',
      success: resolve,
      fail: (e) => reject(new Error((e && e.errMsg) || '写入音频失败')),
    });
  });
}

/**
 * 取到本地可播的文件路径。
 * @returns {Promise<{path:string, cached:boolean}>}
 */
async function resolve(word) {
  const key = norm(word);
  if (!key) throw new Error('单词为空');

  const idx = loadIndex();
  const rec = idx[key];
  if (rec) {
    const p = `${dir()}/${rec.f}`;
    if (fileExists(p)) {
      rec.t = Date.now();
      saveIndex();
      return { path: p, cached: true };
    }
    // 索引还在但文件被系统清掉了，按未命中处理
    drop(key);
  }

  if (pending.has(key)) return pending.get(key);

  const task = (async () => {
    const res = await callCloud('tts', { word: key, type: TYPE }, { silent: true });
    if (!res || !res.b64) throw new Error((res && res.error) || '未获取到发音');
    ensureDir();
    const ext = res.ext === 'wav' || res.ext === 'ogg' ? res.ext : 'mp3';
    const f = fileName(key, ext);
    const path = `${dir()}/${f}`;
    await writeBase64(path, res.b64);
    const i = loadIndex();
    i[key] = { f, t: Date.now() };
    saveIndex();
    trim();
    return { path, cached: false };
  })();

  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

/** 预热：提前把某个词的音频拉到本地，下次播放即刻出声（用于自动朗读预取下一个词）。 */
export function prefetch(word) {
  const key = norm(word);
  if (!key) return;
  resolve(key).catch(() => {});
}

/** 清掉本地发音缓存（设置页可挂"清除缓存"）。 */
export function clearTtsCache() {
  const idx = loadIndex();
  Object.keys(idx).forEach((k) => drop(k));
  try {
    fs().rmdir({ dirPath: dir(), recursive: true });
  } catch (e) { /* noop */ }
}

/**
 * 建一个播放器。页面持有它，切词时调用 play()，页面卸载时 destroy()。
 * @param {{onPlay?:Function, onEnd?:Function, onError?:Function}} handlers
 *        onError(err, opts) —— opts.silent 为 true 时表示自动播放，不要弹 toast。
 */
export function createTtsPlayer(handlers = {}) {
  let ctx = null;
  let seq = 0;
  let destroyed = false;

  function stop() {
    if (!ctx) return;
    try { ctx.stop(); } catch (e) { /* noop */ }
    try { ctx.destroy(); } catch (e) { /* noop */ }
    ctx = null;
  }

  function fail(err, opts) {
    if (handlers.onError) handlers.onError(err, opts || {});
  }

  function start(word, opts, attempt) {
    const my = seq;
    resolve(word)
      .then((r) => {
        if (destroyed || my !== seq) return; // 期间已经切到别的词，丢弃
        stop();
        const c = wx.createInnerAudioContext();
        ctx = c;
        c.src = r.path;
        c.onPlay(() => { if (handlers.onPlay) handlers.onPlay(); });
        c.onEnded(() => { if (handlers.onEnd) handlers.onEnd(); });
        c.onError((err) => {
          // 命中了本地缓存却播不了 —— 文件多半已损坏/被清理，丢掉索引重试一次
          if (r.cached && attempt === 0) {
            drop(norm(word));
            start(word, opts, 1);
            return;
          }
          stop();
          fail(err, opts);
        });
        c.play();
      })
      .catch((e) => {
        if (destroyed || my !== seq) return;
        fail(e, opts);
      });
  }

  return {
    play(word, opts = {}) {
      if (destroyed || !word) return;
      seq += 1; // 让上一次尚未完成的播放失效
      stop();
      start(word, opts, 0);
    },
    stop,
    destroy() {
      destroyed = true;
      stop();
    },
  };
}
