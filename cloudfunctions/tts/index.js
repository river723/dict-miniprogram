/**
 * tts 云函数 —— 单词发音中转（base64 直返，不落云存储）。
 *
 * 为什么需要中转：小程序的 InnerAudioContext 播网络音频，要求域名在后台配置为合法域名；
 * 而 dict.youdao.com 是第三方域名，配置需要往对方服务器根目录放校验文件 —— 做不到。
 * 结果就是开发版能响（开发者工具可勾"不校验合法域名"）、**体验版/正式版必然没声音**。
 * 这里由云函数代拉音频、以 base64 返回，前端写成本地文件再播，绕开域名限制。
 *
 * 为什么是 base64 而不是转存云存储：
 *   - 单文件实测均值 13.29 KB，base64 后约 17.7 KB，远低于云函数返回体 1MB 上限；
 *   - 不占云存储、不产生下载次数与 CDN 流量；
 *   - 代码比"上传云存储 + fileID 落库"少约三分之一。
 * 代价：每个设备每个词都要真拉一次有道，所以**前端必须做本地文件缓存**
 * （见 miniprogram/utils/tts.js），否则云函数调用次数（基础版 20 万/月）会先爆。
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const HOST = 'dict.youdao.com';
const TIMEOUT = 8000;
/** 单文件硬上限：实测最大 135 KB，留足余量；同时兜住返回体 1MB 限制。 */
const MAX_BYTES = 512 * 1024;

/**
 * 实例级缓存（同一云函数实例复用时命中，省一次上游往返）。
 * 300 条 × 13 KB ≈ 4 MB，相对 256 MB 函数内存可忽略；实例回收即失效，不影响正确性。
 */
const CACHE_MAX = 300;
const cache = new Map();

exports.main = async (event) => {
  const word = String((event && event.word) || '').trim();
  const type = event && Number(event.type) === 1 ? 1 : 2; // 1=美音 2=英音（与原前端实现一致）
  if (!word) return { ok: false, error: '缺少 word' };
  if (word.length > 64 || !/^[a-zA-Z][a-zA-Z'\- ]*$/.test(word)) {
    return { ok: false, error: `非法单词：${word}` };
  }

  const key = `${type}|${word.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) {
    return {
      ok: true, word, type, ext: sniffExt(hit), bytes: hit.length,
      b64: hit.toString('base64'), cached: true,
    };
  }

  try {
    const buf = await fetchAudio(word, type);
    if (!buf || buf.length === 0) return { ok: false, error: '未获取到音频' };
    if (buf.length > MAX_BYTES) return { ok: false, error: `音频过大：${buf.length} 字节` };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, buf);
    return {
      ok: true, word, type, ext: sniffExt(buf), bytes: buf.length,
      b64: buf.toString('base64'),
    };
  } catch (e) {
    console.error('[tts]', word, (e && e.message) || e);
    return { ok: false, error: (e && e.message) || '获取发音失败' };
  }
};

/**
 * 按文件头判断真实格式 —— 有道并非一律返回 MP3。
 * 实测：abandon 返回 ID3 头（MP3，11 KB），communism 返回 RIFF 头（WAV，135 KB）。
 * 扩展名必须写实，否则 WAV 存成 .mp3 在部分机型上会解码失败。
 */
function sniffExt(buf) {
  if (buf.length > 12) {
    const head = buf.slice(0, 4).toString('ascii');
    if (head === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE') return 'wav';
    if (head === 'OggS') return 'ogg';
  }
  return 'mp3';
}

function fetchAudio(word, type) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    const req = https.request({
      host: HOST,
      port: 443,
      path: `/dictvoice?type=${type}&audio=${encodeURIComponent(word)}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'audio/mpeg,*/*' },
      timeout: TIMEOUT,
    }, (res) => {
      const ct = res.headers['content-type'] || '';
      if (res.statusCode !== 200) {
        res.resume();
        return done(reject, new Error(`上游返回 ${res.statusCode}`));
      }
      if (!/audio|mpeg|octet-stream/i.test(ct)) {
        res.resume();
        return done(reject, new Error(`上游返回非音频：${ct}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          return done(reject, new Error('音频超过上限'));
        }
        chunks.push(c);
      });
      res.on('end', () => done(resolve, Buffer.concat(chunks)));
      res.on('error', (e) => done(reject, new Error(`上游响应异常：${e.message}`)));
    });
    req.on('timeout', () => { req.destroy(); done(reject, new Error('上游超时')); });
    req.on('error', (e) => done(reject, new Error(`上游请求失败：${e.message}`)));
    req.end();
  });
}
