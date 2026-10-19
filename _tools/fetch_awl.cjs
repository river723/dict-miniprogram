/**
 * 抓取并归档 Academic Word List (AWL) 的**词形级语料词频**。
 *
 * 为什么需要它（雅思词库考频重标的依据）：
 *   雅思词库原来的 frequency/difficulty 是「从考研词库整条搬过来」的，
 *   考的是考研不是雅思；AI 段更是让模型凭记忆拍数字。两者都不能当「雅思考频」用。
 *   AWL（Coxhead, 2000）基于 350 万词的学术语料（arts/commerce/law/science），
 *   给出 570 词族 / 3109 词形的**实测每百万词频次**，且 sublist 1→10 按频率递减。
 *   这是雅思阅读（学术英语）最常被引用的、公开可查的考频代理数据。
 *
 * 数据源：eapfoundation.com 的 AWL「frequencies」页（headword + sublist + 词形频次）。
 * 输出：_tools/awl_freq.json
 *   {
 *     "source": "...", "fetchedAt": "...",
 *     "corpus": "Coxhead academic corpus, 每百万词频次",
 *     "sublist": { analyse: 1, ..., yield: 10 },      // 570 个词头 → sublist 1..10
 *     "freq":    { analysis: 3973, ..., analyse: 519 } // 3109 个词形 → 每百万词频
 *   }
 *
 * 用法：
 *   node _tools/fetch_awl.cjs                     # 自己下载（需直连或已配代理）
 *   node _tools/fetch_awl.cjs --from=awl.html     # 解析已下载的 HTML（网络不通时用）
 *   node _tools/fetch_awl.cjs --curl              # 借 curl 下载（走系统代理最省事）
 *
 * 上游页面改版会导致解析不到数据，所以脚本内置**规格校验**，不符即退出非 0，
 * 绝不静默产出半份词表（下游 relabel 脚本会二次校验）。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outFile = path.join(__dirname, 'awl_freq.json');

const SRC_URL = 'https://www.eapfoundation.com/vocab/academic/awllists/frequencies/';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

/* ---------------- 取 HTML ---------------- */

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve(raw));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', (e) => reject(e));
  });
}

async function loadHtml() {
  if (args.from) {
    return { html: fs.readFileSync(String(args.from), 'utf8'), via: String(args.from) };
  }
  // --curl：交给 curl 处理（会自动读 HTTP_PROXY/HTTPS_PROXY 环境变量，最省事）
  if (args.curl) {
    const tmp = path.join(require('os').tmpdir(), 'awl_freq_src.html');
    execFileSync('curl', ['-s', '-m', '60', '-L', SRC_URL, '-o', tmp], { stdio: 'inherit' });
    return { html: fs.readFileSync(tmp, 'utf8'), via: `curl ${SRC_URL}` };
  }
  return { html: await download(SRC_URL), via: SRC_URL };
}

/* ---------------- 解析 ---------------- */

/** headword → sublist：表格前两列形如 <td>analyse</td><td>1</td> */
function parseSublists(html) {
  const map = {};
  const re = /<td[^>]*>\s*([a-z][a-z-]{2,})\s*<\/td>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>/gi;
  let m = re.exec(html);
  while (m) {
    const w = m[1];
    const n = Number(m[2]);
    // AWL sublist 只会是 1..10；其它数字（如页面别处的计数列）不收
    if (n >= 1 && n <= 10 && !map[w]) map[w] = n;
    m = re.exec(html);
  }
  return map;
}

/** 词形 → 每百万词频：<a>analysis</a>&nbsp;(3973) */
function parseFreqs(html) {
  const map = {};
  const re = />([a-z][a-z-]{1,})<\/a>\s*&nbsp;\((\d[\d,]*)\)/gi;
  let m = re.exec(html);
  while (m) {
    const w = m[1];
    const f = Number(m[2].replace(/,/g, ''));
    // 同一词形在页面上可能重复出现（不同区块），取最高频次
    if (Number.isFinite(f) && (!map[w] || f > map[w])) map[w] = f;
    m = re.exec(html);
  }
  return map;
}

/* ---------------- 校验 ---------------- */

/** AWL 规格：sublist 1..9 各 60 词族，sublist 10 为 30 词族，合计 570。 */
function checkSpec(sublist, freq) {
  const errs = [];
  const bySub = {};
  Object.values(sublist).forEach((n) => { bySub[n] = (bySub[n] || 0) + 1; });
  if (Object.keys(sublist).length !== 570) {
    errs.push(`headword 数 ${Object.keys(sublist).length} ≠ 570`);
  }
  for (let i = 1; i <= 9; i += 1) {
    if (bySub[i] !== 60) errs.push(`sublist ${i} 有 ${bySub[i] || 0} 个词族，应为 60`);
  }
  if (bySub[10] !== 30) errs.push(`sublist 10 有 ${bySub[10] || 0} 个词族，应为 30`);
  // AWL 官方约 3100 词形；留出余量防上游微调
  const n = Object.keys(freq).length;
  if (n < 2500 || n > 3500) errs.push(`词形数 ${n} 不在预期区间 2500~3500`);
  return errs;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const { html, via } = await loadHtml();
  const sublist = parseSublists(html);
  const freq = parseFreqs(html);

  const errs = checkSpec(sublist, freq);
  if (errs.length) {
    console.error('✗ AWL 数据规格校验未过（上游可能改版，不要用这份数据）：');
    errs.forEach((e) => console.error(`  · ${e}`));
    process.exit(1);
  }

  // sublist 里的 headword 未必都在 freq 里（极低频词可能没单独给频次），这是正常的
  const heads = Object.keys(sublist).sort();
  const missFreq = heads.filter((w) => !freq[w]);

  const payload = {
    source: SRC_URL,
    fetchedVia: via,
    fetchedAt: new Date().toISOString().slice(0, 10),
    corpus: 'Coxhead academic corpus（arts/commerce/law/science，约 350 万词）；freq 为每百万词出现次数',
    note: 'AWL 只覆盖学术文本约 10% 的词，未命中不代表词在雅思里不出现，只代表「非学术高频词」',
    sublist,
    freq,
  };
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');

  console.log(`✓ 解析成功（来源 ${via}）`);
  console.log(`  headword : ${heads.length}（sublist 1~9 各 60，10 为 30 ✔）`);
  console.log(`  词形频次 : ${Object.keys(freq).length} 个词形有实测频次`);
  console.log(`  headword 中无独立频次的: ${missFreq.length} 个（极低频，属正常）`);
  console.log(`  已写入   : ${outFile}（${fs.statSync(outFile).size} 字节）`);
})().catch((e) => {
  console.error('抓取失败：', e.message || e);
  console.error('若本机需代理，可改用：node _tools/fetch_awl.cjs --curl   或先 curl 下载后 --from=<文件>');
  process.exit(1);
});