#!/usr/bin/env node
/**
 * 生成「雅思富词条」—— 对齐云 worddict 集合的字段结构，供内置雅思词库补全
 * 释义（含例句）/ 词根词缀 / 记忆技巧 / 易混词 / 考频 / 难度。
 *
 * 两步走，能白嫖的就白嫖：
 *   ① 复用：雅思 4491 词中有 2758 个已存在于考研词库 import-data/worddict-all.json，
 *      直接复制其富词条（只补上雅思侧的音标），零成本、零幻觉；
 *   ② 生成：剩余 1733 个词调 DeepSeek 生成（约 ¥3，并发 8 约 15 分钟）。
 *
 * 产物：import-data/worddict-ielts.jsonl（每行一条，字段与 worddict 集合一致）
 *   再由 scripts/import-worddict-ielts.mjs 导入云集合 worddict_ielts。
 *
 * 用法：
 *   node scripts/gen-ielts-rich.mjs --dry-run              # 只看计划与成本，不调用
 *   node scripts/gen-ielts-rich.mjs --reuse-only           # 只落复用部分（零成本，不需要密钥）
 *   node scripts/gen-ielts-rich.mjs --sample=5             # 先生成 5 条人工审（写到 .sample.jsonl）
 *   node scripts/gen-ielts-rich.mjs                        # 全量（断点续跑）
 *   node scripts/gen-ielts-rich.mjs --concurrency=4        # 降并发防限流
 *
 * 密钥：环境变量 DEEPSEEK_API_KEY（只在本进程内存中使用，不写盘、不进产物）。
 * 可选：AI_BASE_URL（默认 https://api.deepseek.com）、AI_MODEL（默认 deepseek-flash）。
 *
 * 断点续跑：已写入产物的单词自动跳过；中断后重跑同一命令即可接着来。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import https from 'node:https';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const OUT_REUSE = resolve(ROOT, 'import-data/worddict-ielts.jsonl');
const OUT_SAMPLE = resolve(ROOT, 'import-data/worddict-ielts.sample.jsonl');
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 8);
const SAMPLE = args.sample ? Number(args.sample) : 0;
const DRY_RUN = !!args['dry-run'];
const REUSE_ONLY = !!args['reuse-only'];
const ONLY = args.only || 'missing'; // missing=只生成考研库没有的（默认）

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '').replace(/\/v1$/, '');
const MODEL = process.env.AI_MODEL || 'deepseek-flash';

// DeepSeek 2026-09-10 起：空闲 输入未命中 ¥1/百万 · 输出 ¥4/百万；工作日 9-12/14-18 翻倍
const PRICE_IN = 1.0 / 1e6;
const PRICE_OUT = 4.0 / 1e6;

/* ---------------- 数据加载 ---------------- */

/** 读内置雅思词条 [{w, ph, d}]（ESM default export）。 */
async function loadIeltsEntries() {
  const mod = await import(pathToFileURL(resolve(ROOT, 'miniprogram/data/libraries/ielts.js')).href);
  return mod.default || [];
}

/** 读考研富词条，返回 小写单词 → 词条。 */
function loadKyoyoRich() {
  const lines = readFileSync(resolve(ROOT, 'import-data/worddict-all.json'), 'utf8').split('\n').filter((l) => l.trim());
  const map = new Map();
  lines.forEach((l) => {
    try {
      const e = JSON.parse(l);
      if (e && e.word) map.set(String(e.word).toLowerCase(), e);
    } catch (e2) { /* 跳过坏行 */ }
  });
  return map;
}

/** 读已产出的 jsonl，返回 小写单词 → 词条（断点续跑用）。 */
function loadDone(path) {
  const done = new Map();
  if (!existsSync(path)) return done;
  readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => {
    try {
      const e = JSON.parse(l);
      if (e && e.word) done.set(String(e.word).toLowerCase(), e);
    } catch (e2) { /* 跳过坏行 */ }
  });
  return done;
}

/* ---------------- 目标结构 ---------------- */

const normDefs = (list) => (Array.isArray(list) ? list : [])
  .filter((d) => d && String(d.meaning || '').trim())
  .map((d) => ({
    part_of_speech: String(d.part_of_speech || d.pos || '').trim(),
    meaning: String(d.meaning || '').trim(),
    example: String(d.example || '').trim(),
    is_core: !!d.is_core,
    is_rare_sense: !!d.is_rare_sense,
  }));

const normSimilar = (list) => (Array.isArray(list) ? list : [])
  .filter((s) => s && String(s.word || '').trim())
  .map((s) => ({
    word: String(s.word || '').trim(),
    relation: ['spelling', 'meaning', 'pronunciation'].includes(s.relation) ? s.relation : 'spelling',
    description: String(s.description || '').trim(),
  }));

const clamp15 = (n, dflt = 3) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(5, Math.max(1, Math.round(v)));
};

/** 统一成与 worddict 集合一致的文档结构。 */
function toDoc(word, { definitions, etymology, similar_words, memory_tip, frequency, difficulty }, phonetic) {
  return {
    word_id: word,
    word,
    prefix: word[0].toLowerCase(),
    phonetic_uk: phonetic || '',
    definitions: normDefs(definitions),
    etymology: String(etymology || '').trim(),
    similar_words: normSimilar(similar_words),
    memory_tip: String(memory_tip || '').trim(),
    frequency: clamp15(frequency),
    difficulty: clamp15(difficulty),
  };
}

/* ---------------- AI 调用 ---------------- */

function chat(prompt) {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 1500,
    thinking: { type: 'disabled' }, // 与 ai 云函数一致：固定格式输出，关思考省钱降延迟
  });
  const url = new URL(`${BASE}/v1/chat/completions`);

  return new Promise((done, fail) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      timeout: 60000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return fail(new Error(json.error.message || 'AI 服务错误'));
          const choice = json.choices && json.choices[0];
          if (!choice) return fail(new Error('AI 响应结构异常'));
          if (choice.finish_reason === 'length') return fail(new Error('输出被 max_tokens 截断'));
          const usage = json.usage || {};
          done({ content: choice.message.content, usage });
        } catch (e) {
          fail(new Error(`AI 响应解析失败：${String(raw).slice(0, 120)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); fail(new Error('AI 请求超时')); });
    req.on('error', (e) => fail(new Error(`网络错误：${e.message}`)));
    req.write(body);
    req.end();
  });
}

/** 剥掉模型可能带的 markdown 代码块围栏，取出 JSON 主体。 */
function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e < 0 || e <= s) throw new Error('响应中没有 JSON 对象');
  return JSON.parse(t.slice(s, e + 1));
}

/* ---------------- 校验 ---------------- */

function validate(entry, word) {
  const errs = [];
  if (!entry || typeof entry !== 'object') return ['响应不是对象'];
  if (!Array.isArray(entry.definitions) || entry.definitions.length === 0) errs.push('definitions 为空');
  else {
    entry.definitions.forEach((d, i) => {
      if (!d || typeof d !== 'object') { errs.push(`definitions[${i}] 不是对象`); return; }
      if (!String(d.meaning || '').trim()) errs.push(`definitions[${i}].meaning 为空`);
      if (!String(d.example || '').trim()) errs.push(`definitions[${i}].example 为空`);
      else if (!exampleHasWord(d.example, word)) errs.push(`definitions[${i}].example 未包含目标词`);
    });
  }
  if (!String(entry.etymology || '').trim()) errs.push('etymology 为空');
  if (!String(entry.memory_tip || '').trim()) errs.push('memory_tip 为空');
  if (entry.similar_words != null && !Array.isArray(entry.similar_words)) errs.push('similar_words 不是数组');
  if (!(Number(entry.frequency) >= 1 && Number(entry.frequency) <= 5)) errs.push('frequency 越界');
  if (!(Number(entry.difficulty) >= 1 && Number(entry.difficulty) <= 5)) errs.push('difficulty 越界');
  return errs;
}

/** 例句必须含目标词（允许常见变形：去 -s/-es/-d/-ed/-ing 后再比）。 */
function exampleHasWord(example, word) {
  const ex = String(example).toLowerCase();
  const w = word.toLowerCase();
  if (ex.includes(w)) return true;
  const stems = [w.replace(/(?:es|s|d|ed|ing)$/, ''), w.slice(0, Math.max(4, w.length - 3))];
  return stems.some((s) => s.length >= 4 && ex.includes(s));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 主流程 ---------------- */

async function main() {
  const ielts = await loadIeltsEntries();
  const rich = loadKyoyoRich();
  const phOf = new Map(ielts.map((e) => [e.w.toLowerCase(), e.ph || '']));
  const words = ielts.map((e) => e.w);

  // 分类：可复用 vs 需生成
  const reuse = [];
  const todo = [];
  words.forEach((w) => {
    const k = w.toLowerCase();
    const hit = rich.get(k);
    if (hit && ONLY === 'missing') reuse.push({ word: w, rich: hit });
    else todo.push(w);
  });

  const done = loadDone(OUT_REUSE);
  const reusePending = reuse.filter((r) => !done.has(r.word.toLowerCase()));
  const genPending = todo.filter((w) => !done.has(w.toLowerCase()));

  console.log('=== 雅思富词条生成计划 ===');
  console.log(`雅思词条总数      : ${words.length}`);
  console.log(`① 复用考研富词条  : ${reuse.length}（已完成 ${reuse.length - reusePending.length}）`);
  console.log(`② 需 AI 生成       : ${todo.length}（已完成 ${todo.length - genPending.length}）`);
  console.log(`本次待写          : ${reusePending.length + genPending.length}`);
  console.log(`模型 / 并发       : ${MODEL} / ${CONCURRENCY}`);

  if (DRY_RUN) {
    const est = estimate(genPending.length);
    console.log('\n--- 成本估算（仅 AI 生成部分）---');
    console.log(`输入合计约 ${est.inTok} tok，输出合计约 ${est.outTok} tok`);
    console.log(`空闲单价合计      : ¥${est.idle.toFixed(2)}`);
    console.log(`含高峰(×1.5)合计  : ¥${est.peak.toFixed(2)}`);
    console.log(`预计耗时          : 约 ${est.minutes} 分钟（并发 ${CONCURRENCY}）`);
    console.log('\n（dry-run，未调用 AI）');
    return;
  }

  if (!API_KEY && !REUSE_ONLY) {
    console.error('\n缺少环境变量 DEEPSEEK_API_KEY。请先设置后再运行，例如：');
    console.error('  DEEPSEEK_API_KEY=sk-xxx node scripts/gen-ielts-rich.mjs');
    process.exit(1);
  }

  const outPath = SAMPLE > 0 ? OUT_SAMPLE : OUT_REUSE;
  if (SAMPLE > 0 && existsSync(OUT_SAMPLE)) {
    console.log(`\n注意：--sample 模式每次全量重跑前 ${SAMPLE} 个词，写入 ${OUT_SAMPLE.replace(`${ROOT}/`, '')}`);
  }

  // 先落复用部分（零成本、无网络）；sample 模式同样只取前 N 条看格式
  let written = 0;
  const lines = [];
  const reuseTake = SAMPLE > 0 ? reusePending.slice(0, SAMPLE) : reusePending;
  reuseTake.forEach((r) => {
    const doc = toDoc(r.word, r.rich, phOf.get(r.word.toLowerCase()));
    lines.push(JSON.stringify(doc));
  });
  if (lines.length > 0) {
    appendFileSync(outPath, `${lines.join('\n')}\n`);
    written += lines.length;
    console.log(`\n① 复用写入完成：${lines.length} 条 → ${outPath.replace(`${ROOT}/`, '')}`);
  }
  if (REUSE_ONLY) {
    printStat(written, 0, 0);
    console.log('（--reuse-only：仅落复用部分，未调用 AI。补跑不带该参数的同名命令即可续生成剩余词。）');
    return;
  }

  // 再生产部分
  const queue = (SAMPLE > 0 ? genPending.slice(0, SAMPLE) : genPending).slice();
  if (queue.length === 0) {
    console.log('没有待生成的词。');
    printStat(written, 0, 0);
    return;
  }

  console.log(`\n② 开始生成 ${queue.length} 个词（并发 ${CONCURRENCY}）…`);
  let ok = 0;
  let failed = 0;
  let inTok = 0;
  let outTok = 0;
  const failures = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const word = queue[cursor];
      cursor += 1;
      let lastErr = '';
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const { content, usage } = await chat(buildPrompt(word));
          const entry = extractJson(content);
          const errs = validate(entry, word);
          if (errs.length > 0) throw new Error(`校验未过：${errs.join('；')}`);
          const doc = toDoc(word, entry, phOf.get(word.toLowerCase()));
          appendFileSync(outPath, `${JSON.stringify(doc)}\n`);
          ok += 1;
          inTok += usage.prompt_tokens || 0;
          outTok += usage.completion_tokens || 0;
          lastErr = '';
          break;
        } catch (e) {
          lastErr = e.message || String(e);
          const is429 = /429|rate|limit/i.test(lastErr);
          await sleep(is429 ? 10000 * attempt : 1000 * attempt);
        }
      }
      if (lastErr) {
        failed += 1;
        failures.push({ word, err: lastErr });
        console.warn(`  ✗ ${word}：${lastErr}`);
      }
      if ((ok + failed) % 25 === 0) {
        console.log(`  进度 ${ok + failed}/${queue.length}（成功 ${ok} / 失败 ${failed}）`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  printStat(written, ok, failed);
  console.log(`\nToken 用量：输入 ${inTok} / 输出 ${outTok}`);
  console.log(`本次 AI 花费估算：空闲 ¥${(inTok * PRICE_IN + outTok * PRICE_OUT).toFixed(3)}`
    + `｜含高峰约 ¥${(inTok * PRICE_IN * 1.5 + outTok * PRICE_OUT * 1.5).toFixed(3)}`);

  if (failures.length > 0) {
    const fp = resolve(ROOT, 'import-data/worddict-ielts.failures.json');
    writeFileSync(fp, JSON.stringify(failures, null, 2));
    console.log(`\n失败 ${failures.length} 个，已写入 ${fp.replace(`${ROOT}/`, '')}，重跑同一命令即可只补这些。`);
  }
  console.log(`\n下一步：node scripts/import-worddict-ielts.mjs --env=<云环境ID>（需 TCB_SECRET_ID/TCB_SECRET_KEY）`);
}

function buildPrompt(word) {
  // 与 cloudfunctions/ai 的 buildDefinePrompt 保持一致；此处独立一份，避免批量脚本反向依赖云函数
  return [
    `你是雅思词汇编纂专家。请为单词 "${word}" 编写一条完整词条，严格输出以下 JSON（不要 markdown 代码块、不要任何解释文字）：`,
    `{"definitions":[{"part_of_speech":"n.","meaning":"中文释义","example":"含该词的英文例句","is_core":true,"is_rare_sense":false}],"etymology":"词根词缀分析","similar_words":[{"word":"易混词","relation":"spelling","description":"为何易混及词义区别"}],"memory_tip":"一句话记忆技巧","frequency":3,"difficulty":3}`,
    ``,
    `要求：`,
    `1. definitions 给 1-3 个义项，按重要性排序；最常用的义项 is_core=true；若该词在雅思阅读中常考「熟词僻义」，把僻义单列一个义项并置 is_rare_sense=true。`,
    `2. example 为 8-15 词的英文句子，必须原样包含单词 ${word}（允许使用其常见变形），难度贴近雅思阅读。`,
    `3. etymology 拆解可识别的词根/词缀并说明引申过程；确实无词根可分析时，简述词源或写「来源不详」，不要编造。`,
    `4. similar_words 只收真正易混的词（拼写相近或词义相近），relation 取值 spelling / meaning / pronunciation；确实没有易混词时返回空数组 []，不要硬凑。`,
    `5. frequency 取 1-5（该词在雅思考试中的常见程度），difficulty 取 1-5（记忆难度）。`,
    `6. 除 similar_words 可为空数组外，其余字段均不可为空字符串。`,
  ].join('\n');
}

function estimate(n) {
  // 提示词约 320 tok；富词条输出约 260 tok（3 义项含例句 + 词根 + 记忆法 + 易混词）
  const inTok = Math.round(n * 320);
  const outTok = Math.round(n * 260);
  const idle = inTok * PRICE_IN + outTok * PRICE_OUT;
  const seconds = (n / CONCURRENCY) * 3;
  return {
    inTok, outTok,
    idle,
    peak: idle * 1.5,
    minutes: Math.max(1, Math.round(seconds / 60)),
  };
}

function printStat(reused, generated, failed) {
  const done = loadDone(OUT_REUSE).size;
  console.log(`\n=== 汇总 ===`);
  console.log(`本次写入：复用 ${reused} + 生成 ${generated} = ${reused + generated}，失败 ${failed}`);
  console.log(`产物累计：${done} / 4491 条 → ${OUT_REUSE.replace(`${ROOT}/`, '')}`);
  if (done >= 4491) console.log('✅ 已覆盖全部雅思词条，可以执行导入了。');
}

main().catch((e) => {
  console.error('运行失败：', e);
  process.exit(1);
});
