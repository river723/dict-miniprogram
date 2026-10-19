/**
 * 重标雅思 4491 词的「考频」与「难度」——**用真实语料数据，不再用考研考频冒充**。
 *
 * 要解决的问题（2026-10-19 核实）：
 *   ① 现有 import-data/worddict-ielts.jsonl 的 2758 条富词条，frequency/difficulty 是
 *      从考研词库 import-data/worddict-all.json 整条搬过来的（abandon 两边都是 2/3），
 *      考的是考研不是雅思；② 剩余 1733 条计划让 AI 凭记忆拍数字，更不可信。
 *
 * 本脚本的口径（每个数字都要能说清出处）：
 *   frequency 考频 1-5 ——「在学术/通用语料里每百万词出现多少次」换算成星级：
 *     · 首选 AWL 学术语料实测词频（Coxhead 350 万词学术语料 arts/commerce/law/science，
 *       雅思阅读就是学术英语，这是最贴近的公开权威数据）；覆盖率约 14.5%。
 *     · AWL 未命中的词（雅思表里大量是生活/学科基础词，本就不在 AWL 学术高频词范围内）
 *       回落 Google Web 语料实测词频（Norvig count_1w），同样换算成每百万词口径。
 *     · 两源都无 → 1 星。**每个词都记 src（awl / web / none）与原始 ppm，可审计。**
 *     ⚠ 口径提醒：不存在「雅思官方逐词考频」这种公开数据，本值是**权威语料代理指标**，
 *       不是「某词在雅思卷子上出现过几次」。
 *   difficulty 难度 1-5 —— 纯客观指标，不掺考频，两轴互相独立：
 *     音节数（主因子）> 派生后缀复杂度 > 义项数量 > 词长。
 *     学术抽象度不由 AI 判断，全是机械可复算的量。
 *
 * 输入：_tools/ielts_defs.json（词表+释义）、_tools/awl_freq.json（fetch_awl.cjs 产出）
 * 输出：_tools/ielts_metrics.json = { word: {f, k, src, ppm, syl} }
 *       以及 _tools/ielts_wfreq.json（4491 词在通用语料里的实测频次，缓存，避免重复下载 5MB）
 *
 * 用法：
 *   node _tools/relabel_ielts_metrics.cjs            # 用缓存的通用语料频次
 *   node _tools/relabel_ielts_metrics.cjs --refresh  # 重新抓取通用语料频次
 *   node _tools/relabel_ielts_metrics.cjs --from-freq=/path/count_1w.txt  # 用已下载文件
 *   node _tools/relabel_ielts_metrics.cjs --dry-run  # 只看统计不写文件
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const DEFS = path.join(__dirname, 'ielts_defs.json');
const AWL = path.join(__dirname, 'awl_freq.json');
const OUT = path.join(__dirname, 'ielts_metrics.json');
const WFREQ_CACHE = path.join(__dirname, 'ielts_wfreq.json');

/** Google Web Trillion Word Corpus 词频表（Norvig 整理），每行「词\t出现次数」。 */
const WEB_FREQ_URL = 'https://norvig.com/ngrams/count_1w.txt';
/** 该语料约 1e12 词，故每百万词频次 = 原始计数 / 1e6。 */
const WEB_CORPUS_TOKENS = 1e12;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

/* ---------------- 通用语料频次 ---------------- */

function parseWebFreq(text, wanted) {
  const out = {};
  const lines = text.split('\n');
  for (const line of lines) {
    // Norvig count_1w.txt 是 **TAB** 分隔（早期版本曾用空格，别只认一种）
    let sp = line.indexOf('\t');
    if (sp <= 0) sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const w = line.slice(0, sp).trim().toLowerCase();
    const n = Number(line.slice(sp + 1).trim());
    if (!Number.isFinite(n) || !w) continue;
    if (wanted.has(w)) out[w] = n; // 只留 4491 个目标词，别把 5MB 塞进仓库
  }
  return out;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve(raw));
    }).on('timeout', function onT() { this.destroy(); reject(new Error('下载超时')); })
      .on('error', reject);
  });
}

async function loadWebFreq(wanted) {
  if (args['from-freq']) {
    const got = parseWebFreq(fs.readFileSync(String(args['from-freq']), 'utf8'), wanted);
    fs.writeFileSync(WFREQ_CACHE, `${JSON.stringify(got, null, 1)}\n`, 'utf8'); // 存缓存，下次免下载
    return got;
  }
  if (!args.refresh && fs.existsSync(WFREQ_CACHE)) {
    return JSON.parse(fs.readFileSync(WFREQ_CACHE, 'utf8'));
  }
  console.log('  · 抓取 Google Web 语料词频（约 5MB，仅提取目标词）…');
  let text;
  try {
    text = await download(WEB_FREQ_URL);
  } catch (e) {
    // 直连不通就走 curl（自动继承系统代理）
    console.log(`  · 直连失败（${e.message}），改用 curl 走代理…`);
    const tmp = path.join(require('os').tmpdir(), 'count_1w.txt');
    execFileSync('curl', ['-s', '-m', '120', '-L', WEB_FREQ_URL, '-o', tmp], { stdio: 'inherit' });
    text = fs.readFileSync(tmp, 'utf8');
  }
  const got = parseWebFreq(text, wanted);
  fs.writeFileSync(WFREQ_CACHE, `${JSON.stringify(got, null, 1)}\n`, 'utf8');
  return got;
}

/* ---------------- 客观指标 ---------------- */

/** 英文音节数启发式：数元音组，silent-e 与 -le 结尾做修正。 */
function syllables(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  if (/(?:[^aeiou]e)$/.test(w)) w = w.slice(0, -1);           // make → mak
  if (/(?:[^aeiou]le)$/.test(w) && !/[aeiou]{2}/.test(w.slice(-3))) w += 'e'; // table → table 的 le 要算
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (/(?:[^aeiou]ed|[^aeiou]es|[^aeiou]ing)$/.test(String(word))) n -= 1; // -ed/-es/-ing 常不成音节
  return Math.max(1, n);
}

/** 派生后缀：加了它，词更难拼写/记忆（机械判定，不含主观判断）。 */
const DERIV_SUFFIX = /(?:(?:tion|sion|ment|ness|ity|ities|ance|ence|ship|hood|ism|ist|ify|ise|ize|ology|graphy|logy|scope|wise|wards?|ings?)$)/;

/** 释义里的义项数（本地数据按「；」分隔），多义词更难记。 */
function senseCount(def) {
  const s = String(def || '').trim();
  if (!s) return 1;
  return Math.min(4, Math.max(1, s.split(/[；;]/).filter((x) => x.trim()).length));
}

/* ---------------- 星级分档 ---------------- */

/** AWL 数据（fetch_awl.cjs 产出），主流程加载后赋给这里，供 sublistOfForm 词形还原用。 */
let awl = null;

/**
 * 考频分档：**单一可比标尺 + 学术加权**。
 *
 * 为什么不能把两个语料的 ppm 直接混用（实测踩过的坑）：
 *   AWL 学术语料把学术词抬高约 **19.4 倍**（学术/通用 ppm 比值中位数，见 README 注释）。
 *   若「AWL 命中就用学术 ppm、否则用通用 ppm」，651 个 AWL 词会系统性霸占高分，
 *   其余 3840 词被压到最低档（实测 85% 都是 1★，星级失去区分度）。
 *
 * 现行口径：
 *   1) 基准 = Google Web 语料实测每百万词频次（webPpm），**绝对阈值**分档；
 *      不用等分位数——那会把 "accessory（配件）" 硬塞进 5★，语义失真；
 *   2) 加权 = 命中 AWL（含派生形，见 sublistOfForm）则取其 sublist 对应的下限星。
 *      AWL 的 sublist 本身就是「学术文本里的频率分级」，sublist 1 最常考；只上调不下调；
 *   3) 语义 = 「该词在语料里的绝对常用度」，不是「在雅思卷子上出现过几次」
 *      （后者不存在公开逐词权威数据）。
 */
/**
 * AWL sublist → 学术考频下限星。
 * sublist 1-10 是 Coxhead 按「学术文本里出现频率」排的，sublist 1 最常考，
 * 所以直接映射成星当**下限**（只上调不下调）：sublist 9-10 虽然通用语料里罕见，
 * 但它在学术文本里确实出现（amend/brief/workshop…），给 2★ 而非 1★。
 * ⚠ 早先版本把 sublist 绕道 ppm 再分档，实测只上调 32 词（上限被压到 3★），
 *   等于加权几乎失效——映射必须直达星级。
 */
const AWL_SUBLIST_STAR = {
  1: 5, 2: 5,
  3: 4, 4: 4,
  5: 3, 6: 3,
  7: 2, 8: 2,
  9: 2, 10: 2,
};

/** web 语料实测每百万词频次 → 1~5 星（绝对阈值，语义=常见度）。 */
function ppmToStar(ppm) {
  if (ppm >= 100) return 5;
  if (ppm >= 30) return 4;
  if (ppm >= 8) return 3;
  if (ppm >= 1) return 2;
  return 1;
}

/**
 * 该词形属于哪个 AWL sublist（考虑派生形）。
 * sublist 表只有 570 个词头，而词形表有 3109 个词形，
 * 只查 sublist 会漏掉 analysis/analytical 这类派生形（实测漏 213 词）。故先做词形还原。
 */
function sublistOfForm(lw) {
  if (awl.sublist[lw]) return awl.sublist[lw];
  const cands = [
    lw.replace(/(?:es|s)$/, ''),
    lw.replace(/ed$/, 'e'),          // analyzed → analyse
    lw.replace(/ing$/, 'e'),         // analysing → analyse
    lw.replace(/(?:ed|ing)$/, ''),   // analysing → analys
    lw.replace(/(?:ical|al|ic|ness|ments|ment|ations|ation|ities|ity|ances|ance|ences|ence|ives|ive|ists|ist|isms|ism|izations|ization|ized|ised|izing|ising)$/, ''),
  ];
  for (const c of cands) {
    if (c.length >= 3 && awl.sublist[c]) return awl.sublist[c];
  }
  return 0;
}

/** 客观难度分 → 1-5。音节为主，派生/义项/长度为辅。 */
function difficultyScore(word, syl, senses) {
  let s = 0;
  s += syl >= 5 ? 4 : syl === 4 ? 3 : syl === 3 ? 2 : 1;   // 音节数（主因子）
  s += Math.min(2, senses - 1) * 0.5;                        // 义项多 → 难记
  if (DERIV_SUFFIX.test(word.toLowerCase())) s += 0.5;       // 派生后缀 → 拼写难
  if (String(word).length > 10) s += 0.5;                    // 长词
  return s;                                                   // 范围 1~6.5
}

/**
 * 难度原始分 → 1~5 星。阈值按 4491 词实测分布校准（探针 _probe_difficulty.cjs）：
 *   kScore 实际范围只有 1.0~5.0（最高 accommodation/administration/anthropology = 5.0），
 *   不是注释里估的 6.5——所以阈值不能照估，否则 5★ 永远空缺（实测过）。
 *   校准后分布：1★1243 / 2★2101 / 3★723 / 4★333 / 5★91。
 *   1★ 偏多是真的：雅思基础词里 23% 是单音节短词（yard/yarn/yearn/yelp/zeal），就该简单。
 */
function scoreToStar(s) {
  if (s >= 4.5) return 5;
  if (s >= 3.5) return 4;
  if (s >= 2.5) return 3;
  if (s >= 1.5) return 2;
  return 1;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const defs = JSON.parse(fs.readFileSync(DEFS, 'utf8'));
  awl = JSON.parse(fs.readFileSync(AWL, 'utf8'));
  const words = Object.keys(defs);
  const wanted = new Set(words.map((w) => w.toLowerCase()));

  console.log('=== 雅思词考频/难度重标 ===');
  console.log(`词表: ${words.length} 词（${DEFS.replace(`${root}/`, '')}）`);

  const web = await loadWebFreq(wanted);
  const webHit = Object.keys(web).length;
  console.log(`通用语料频次覆盖: ${webHit}/${words.length}（${(webHit / words.length * 100).toFixed(1)}%）`);

  // ---- 阶段 1：收集原始量 + 客观指标 ----
  const rows = words.map((w) => {
    const lw = w.toLowerCase();
    const e = defs[w] || {};
    const webPpm = Number.isFinite(web[lw]) ? web[lw] / (WEB_CORPUS_TOKENS / 1e6) : null;
    const syl = syllables(w);
    const senses = senseCount(e.def);
    return {
      w,
      lw,
      webPpm,
      awlSub: sublistOfForm(lw),
      syl,
      senses,
      kScore: difficultyScore(w, syl, senses),
    };
  });

  // ---- 阶段 3：定档（学术加权只上调不下调） ----
  const metrics = {};
  const stat = {
    bySrc: { awl: 0, web: 0, none: 0 },
    fDist: [0, 0, 0, 0, 0],
    kDist: [0, 0, 0, 0, 0],
    lifted: 0,
  };

  rows.forEach((r) => {
    // 考频：web 实测频次绝对阈值给基准星，AWL 学术加权只上调不下调
    const base = r.webPpm === null ? 1 : ppmToStar(r.webPpm);
    const awlStar = r.awlSub ? (AWL_SUBLIST_STAR[r.awlSub] || 1) : 1;
    const f = Math.max(base, awlStar);
    if (awlStar > base) stat.lifted += 1;
    const k = scoreToStar(r.kScore);

    const src = r.awlSub ? 'awl' : (r.webPpm !== null ? 'web' : 'none');
    metrics[r.lw] = {
      f,
      k,
      src,
      webPpm: r.webPpm === null ? 0 : Math.round(r.webPpm * 100) / 100,
      awlSub: r.awlSub,
      syl: r.syl,
      senses: r.senses,
    };
    stat.bySrc[src] += 1;
    stat.fDist[f - 1] += 1;
    stat.kDist[k - 1] += 1;
  });

  // 抽样人工核对：各星级取几个代表词
  const pick = (field, star) => Object.entries(metrics)
    .filter(([, m]) => m[field] === star)
    .map(([w]) => w)
    .sort()
    .slice(0, 6);
  ['awl', 'web', 'none'].forEach((s) => {
    if (stat.bySrc[s]) {
      const ex = Object.entries(metrics).filter(([, m]) => m.src === s).slice(0, 5).map(([w]) => w);
      console.log(`  来源 ${s.padEnd(4)}: ${String(stat.bySrc[s]).padStart(4)} 词（例：${ex.join(' ')}）`);
    }
  });

  console.log(`  其中被 AWL 学术加权上调: ${stat.lifted} 词（只上调不下调）`);
  console.log(`考频分布 1★→5★: ${stat.fDist.join(' / ')}`);
  console.log(`难度分布 1★→5★: ${stat.kDist.join(' / ')}`);
  console.log(`  考频 5★ 示例: ${pick('f', 5).join(' ')}`);
  console.log(`  考频 1★ 示例: ${pick('f', 1).join(' ')}`);
  console.log(`  难度 5★ 示例: ${pick('k', 5).join(' ')}`);
  console.log(`  难度 3★ 示例: ${pick('k', 3).join(' ')}`);
  console.log(`  难度 1★ 示例: ${pick('k', 1).join(' ')}`);

  if (args['dry-run']) {
    console.log('\n（--dry-run：未写文件）');
    return;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(metrics, null, 1)}\n`, 'utf8');
  console.log(`\n✓ 已写入 ${OUT.replace(`${root}/`, '')}（${fs.statSync(OUT).size} 字节）`);
  console.log('下一步：node _tools/gen_ielts_js.cjs  # 把 f/k 合进 data/libraries/ielts.js');
})().catch((e) => {
  console.error('重标失败：', e.message || e);
  process.exit(1);
});