/**
 * 发音音频（有道 dictvoice）转存云存储 的成本/配额估算。
 *
 * 用法：node .workbuddy/tts_storage_estimate.cjs            # 用内置默认参数算
 *      node .workbuddy/tts_storage_estimate.cjs --sample 60 # 重新联网抽样再算
 *
 * 参数（顶部可改）：
 *   AVG_KB   单个音频均值 KB（实测值，见下方 SAMPLE_NOTE）
 *   WORDS    词库规模（默认读 import-data/worddict-*.json 自动统计）
 *   TYPE     youdao 发音类型：1=美音 2=英音
 *
 * SAMPLE_NOTE（2026-09-20 实测，从词库均匀抽 60 词，60/60 成功）：
 *   平均 13.29 KB · 中位 10.54 KB · P90 12.98 KB · 最大 135 KB（communism，个别异常长）
 *   → 推算用均值 13.29 KB；保守上界可用 P90。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const AVG_KB = 13.29;
const TYPE = 2; // 1=美音 2=英音
const SAMPLE = process.argv.includes('--sample');

// 微信云开发「基础版」配额（2026 官方配额表）
const QUOTA = {
  storageMB: 5 * 1024,        // 云存储容量 5GB
  uploadOps: 60 * 10000,      // 上传操作次数 60 万/月
  downloadOps: 150 * 10000,   // 下载操作次数 150 万/月
  cdnMB: 5 * 1024,            // CDN 流量 5GB/月
  fnCalls: 20 * 10000,        // 云函数调用次数 20 万/月
};

function countWords() {
  const dir = path.join(__dirname, '..', 'import-data');
  const set = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/^worddict-.*\.json$/.test(f)) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        const w = String(o.word || o.word_id || '').trim().toLowerCase();
        if (w) set.add(w);
      } catch (e) { /* JSONL 里可能有空行/坏行，跳过 */ }
    }
  }
  return [...set];
}

function fetchSize(word) {
  return new Promise((r) => {
    const req = https.request(
      { host: 'dict.youdao.com', port: 443, path: `/dictvoice?audio=${encodeURIComponent(word)}&type=${TYPE}`, method: 'GET', timeout: 10000 },
      (res) => { let n = 0; res.on('data', (c) => { n += c.length; }); res.on('end', () => r(n)); },
    );
    req.on('timeout', () => { req.destroy(); r(-1); });
    req.on('error', () => r(-2));
    req.end();
  });
}

(async () => {
  const words = countWords();
  const N = words.length;

  let avgKB = AVG_KB;
  if (SAMPLE) {
    const n = 60;
    const step = Math.max(1, Math.floor(N / n));
    const pick = [];
    for (let i = 0; i < N && pick.length < n; i += step) pick.push(words[i]);
    const got = [];
    for (const w of pick) got.push(await fetchSize(w));
    const ok = got.filter((x) => x > 0).sort((a, b) => a - b);
    avgKB = ok.reduce((a, b) => a + b, 0) / ok.length / 1024;
    console.log(`实测抽样 ${ok.length}/${pick.length} 词 → 均值 ${avgKB.toFixed(2)} KB`);
  } else {
    console.log(`使用内置均值 ${AVG_KB} KB（加 --sample 可重新联网实测）`);
  }

  const totalMB = (N * avgKB) / 1024;
  const pct = (v, q) => `${((v / q) * 100).toFixed(2)}%`;

  console.log(`\n词库规模: ${N} 词   单文件均值: ${avgKB.toFixed(2)} KB`);
  console.log('\n=== 一次性：全量转存云存储 ===');
  console.log(`  存储空间      ${totalMB.toFixed(1)} MB / ${QUOTA.storageMB} MB   = ${pct(totalMB, QUOTA.storageMB)}  ← 关键指标`);
  console.log(`  上传操作      ${N} 次 / ${QUOTA.uploadOps} 次   = ${pct(N, QUOTA.uploadOps)}`);

  console.log('\n=== 每月：按播放量（无本地缓存的最坏情况）===');
  console.log(`  ${'重度用户(3000次/月)'.padEnd(22)}${'CDN流量'.padEnd(12)}${'下载次数'.padEnd(12)}云函数调用`);
  for (const users of [1, 10, 50, 100, 300]) {
    const plays = users * 3000;
    const cdn = (plays * avgKB) / 1024;
    console.log(`  ${(users + ' 人').padEnd(24)}${(cdn.toFixed(1) + 'MB').padEnd(14)}${(plays / 10000).toFixed(1) + '万次'.padEnd(10)}${(plays / 10000).toFixed(1)}万次`);
  }
  console.log(`\n  配额上限: CDN流量 ${QUOTA.cdnMB / 1024}GB · 下载 ${QUOTA.downloadOps / 10000}万次 · 云函数 ${QUOTA.fnCalls / 10000}万次`);
  console.log(`  → 无本地缓存时，云函数调用 ${(QUOTA.fnCalls / 3000).toFixed(0)} 个重度用户即打满（最紧的一项）`);

  console.log('\n=== 加上「前端本地文件缓存」后 ===');
  console.log(`  每个设备每个词只走一次云调用；重复播放 = 0 云调用、0 流量`);
  console.log(`  单设备把整个词库听一遍的上限: ${totalMB.toFixed(1)} MB（= 存储配额的 ${pct(totalMB, QUOTA.storageMB)}）`);
})();
