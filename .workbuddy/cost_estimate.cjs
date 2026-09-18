/**
 * 成本复算（2026-09-18）
 *
 * 关键更新：DeepSeek 于 2026-09-10 12:00 调整 flash 系列定价
 *   空闲时段：输入(未命中) 1 元/百万 · 输入(命中) 0.02 元/百万 · 输出 4 元/百万
 *   高峰时段：工作日 9:00-12:00 / 14:00-18:00，全部 2 倍
 * → 输出单价从原来的 2 元涨到 4 元（空闲），是我上一版文档的两倍
 *
 * 用法：node .workbuddy/cost_estimate.cjs
 * 单价变动时只需改下方 IN_MISS / OUT / PEAK / PEAK_SHARE 四个常量后重跑，
 * 再用输出结果更新 docs/商业化方案.md 第 1 节。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'cloudfunctions/ai/index.js'), 'utf8');

const names = [
  'buildAnalyzePrompt', 'buildQuizPrompt', 'formatWordList',
  'buildDefinitionQuestionsPrompt', 'buildClozeQuestionsPrompt',
  'buildRealExamExplanationPrompt', 'buildStoryPrompt',
];
let code = '';
for (const n of names) {
  const m = src.match(new RegExp(`function ${n}\\s*\\([\\s\\S]*?\\n\\}\\n`, 'm'));
  if (!m) throw new Error('未找到 ' + n);
  code += m[0] + '\n';
}
const THEME_CN = { technology: '科技', life: '生活', history: '历史', nature: '自然', science: '科学' };
const F = new Function('THEME_CN', code + '\nreturn {' + names.join(',') + '};')(THEME_CN);

const WORDS = ['peace', 'turbulent', 'refuge', 'scent', 'hum', 'dusty', 'corner',
  'reluctant', 'spine', 'volunteer', 'quarterly', 'fair', 'stubborn', 'glimpse', 'frail'];

// ---------- 输出规模：给「偏小 / 典型 / 偏大」三档，而不是单点猜测 ----------
const C = {
  analyze: {
    label: 'analyze 单词解析',
    prompt: F.buildAnalyzePrompt('turbulent'),
    out: [
      '{"word":"peace","phonetic_uk":"/piːs/","definitions":[{"pos":"n.","meaning":"和平；安宁"},{"pos":"n.","meaning":"平静；安静"}],"obscure_meanings":[],"root_analysis":"来自拉丁语 pax","memory_tip":"pax 即和平"}',
      '{"word":"turbulent","phonetic_uk":"/ˈtɜːbjələnt/","definitions":[{"pos":"adj.","meaning":"动荡的；混乱的；汹涌的"},{"pos":"adj.","meaning":"（情绪）剧烈的，难以控制的"}],"obscure_meanings":[{"familiar":"混乱的","obscure":"（水、空气）汹涌的，剧烈流动的","example":"The turbulent river swept away the old wooden bridge."}],"root_analysis":"来自拉丁语 turba（骚动、混乱），同源词 disturb、trouble","memory_tip":"turba（骚动）→ turbulent，一片骚动就是动荡不安"}',
      // 僻义多、例句长时的上限
      '{"word":"turbulent","phonetic_uk":"/ˈtɜːbjələnt/","definitions":[{"pos":"adj.","meaning":"动荡的；混乱的；不稳定的"},{"pos":"adj.","meaning":"（水流、气流）汹涌的，猛烈而不规则的"},{"pos":"adj.","meaning":"（情绪、局势）剧烈的，难以控制的，骚动的"}],"obscure_meanings":[{"familiar":"混乱的","obscure":"（水、空气）汹涌的，剧烈流动的","example":"The turbulent river swept away the old wooden bridge within minutes."},{"familiar":"动荡的","obscure":"（人）桀骜不驯的，难以管束的","example":"A turbulent teenager, he refused every rule the school imposed on him."}],"root_analysis":"来自拉丁语 turba（骚动、混乱、人群），经由 turbulare 演变而来；同源词包括 disturb（扰乱）、trouble（麻烦）、perturb（使不安），核心意象都是「搅动」","memory_tip":"抓住 turba（骚动）这条线：一片骚动就是动荡不安。disturb = dis + turb = 搅乱；turbulent 就是「被搅得停不下来」"}',
    ],
  },
  quiz: {
    label: 'quiz 出 10 道选择题',
    prompt: F.buildQuizPrompt(WORDS, 10),
    out: [1, 2, 3].map((k) => Array.from({ length: 10 }).map(() =>
      `{"word":"peace","question":"The word \\"peace\\" in the passage is closest in meaning to ______.","translation_hint":"文中 peace 一词最接近的意思是","options":["和平；安宁","动荡；混乱","避难所；庇护","微弱的声音"],"answer":0}`
    ).join(',')),
  },
  definition_questions: {
    label: 'definition_questions 释义单选(15词)',
    prompt: F.buildDefinitionQuestionsPrompt(WORDS.map((w) => ({ word: w, meaning: '示例释义' }))),
    out: [1, 2, 3].map((k) => JSON.stringify(Array.from({ length: 15 }).map(() => ({
      target_word: 'peace',
      sentence: 'She finally found a quiet **peace** in the dusty corners of the old library where nobody ever came to disturb her.',
      options: [
        'a state of calm and freedom from disturbance',
        'a strong feeling of anger or dislike towards someone',
        'an unexpected and pleasant discovery made by chance',
        'the act of building something with great care and skill',
      ],
      correct_definition: 'a state of calm and freedom from disturbance',
      chinese_translation: '她终于在那座无人到访的旧图书馆的积尘角落里找到了一份宁静。',
    }))).repeat(k === 1 ? 1 : k === 2 ? 1 : 1)),
  },
  cloze_questions: {
    label: 'cloze_questions 完形选词(15词)',
    prompt: F.buildClozeQuestionsPrompt(WORDS.map((w) => ({ word: w, meaning: '示例释义' }))),
    out: [1, 2, 3].map((k) => JSON.stringify(Array.from({ length: 15 }).map(() => ({
      target_word: 'turbulent',
      sentence: 'After so many [BLANK] years at sea the old sailor finally settled down in a quiet village by the river.',
      options: ['turbulent', 'reluctant', 'frail', 'stubborn'],
      correct_answer: 'turbulent',
      chinese_hint: '在海上经历了这么多年动荡之后，这位老水手终于在一个安静的河畔村庄定居下来。',
    })))),
  },
  real_exam_explanation: {
    label: 'real_exam_explanation 真题解析',
    prompt: F.buildRealExamExplanationPrompt({
      mode: 'reading',
      stem: 'The author suggests that the ancient practice of storytelling was primarily intended to ______.',
      options: ['preserve historical records for future generations', 'strengthen social bonds within a community', 'entertain children during long winter nights', 'transmit practical survival skills to hunters'],
      correctAnswer: 'B', userAnswer: 'A',
    }),
    // prompt 要求「150 字以内」
    out: [
      '选 B。原文第二段说讲故事是为了让部落在漫长冬夜里凝聚在一起，强调的是共同体纽带。',
      '正确答案 B。原文第二段明确指出讲故事让人们在漫长冬夜里围坐在一起、共同记住祖先的名字，核心功能是维系共同体纽带，而非记录历史。考生选 A 的常见误区是把文中提到的"记住祖先名字"直接等同于"保存历史档案"，但原文强调的是情感联结与身份认同。解题技巧：定位转折词 however 后的句子，答案往往在其附近。',
      '正确答案 B。原文第二段明确指出，讲故事让部落在漫长冬夜里围坐在一起、共同记住祖先的名字，其核心功能是维系共同体内部的联结，而不是保存历史档案。A 项是典型干扰项：把"记住祖先名字"直接等同于"为后代保存历史记录"，混淆了情感认同与文献保存两件事。C 项虽在文中出现过冬夜意象，但那是场景描述而非目的。D 项文中未提。解题技巧：当选项复述了原文的细节却改变了它的目的时，要回到"作者为什么提这个细节"这一层判断，转折词后的句子通常是关键。'.replace(/。$/, ''),
    ],
  },
  story: {
    label: 'story 生成短文(150词+翻译)',
    prompt: F.buildStoryPrompt(WORDS, 'life', 150, true),
    out: [1, 2, 3].map((k) => 'The Quiet Library\n\n' +
      'The old library stood at the corner of a quiet street, and Alex had always found peace within its walls. '.repeat(3 + k) +
      '\n\n中文翻译：' + '那座旧图书馆坐落在一段安静街道的拐角处，Alex 总能在它的墙内找到安宁。'.repeat(6 + k * 3)),
  },
};

function estTokens(text) {
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.replace(/[\u4e00-\u9fff]/g, ' ');
  const enWords = (rest.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  const other = rest.replace(/[A-Za-z][A-Za-z'-]*/g, '').replace(/\s+/g, '').length;
  return cn * 0.6 + enWords * 1.3 + other * 1;
}

const IN_MISS = 1.0 / 1e6;   // 空闲：输入未命中
const OUT = 4.0 / 1e6;       // 空闲：输出（2026-09-10 起，原为 2 元）
const PEAK = 2.0;            // 工作日 9-12 / 14-18 翻倍

// 考研学生作息 → 高峰时段占比。早读(6:30-8)空闲、上午(9-12)高峰、
// 下午(14-18)高峰、晚自习(19-23)空闲 → 高峰约占一半
const PEAK_SHARE = 0.5;

console.log('=== 单价（2026-09-10 12:00 起生效）===');
console.log('空闲：输入未命中 ¥1/百万 · 缓存命中 ¥0.02/百万 · 输出 ¥4/百万');
console.log('高峰（周一至周五 9-12 / 14-18）：全部 2 倍');
console.log('注：上一版文档用的是调价前的输出 ¥2/百万 —— 已失效\n');

const rows = [];
console.log('功能'.padEnd(34) + '输入tok'.padStart(9) + '输出tok(小/典/大)'.padStart(22) +
  '空闲单次'.padStart(12) + '含峰单次'.padStart(12));
console.log('-'.repeat(104));

for (const [key, c] of Object.entries(C)) {
  const inTok = estTokens(c.prompt);
  const outs = c.out.map(estTokens);
  const mid = outs[1];
  const costOff = inTok * IN_MISS + mid * OUT;
  const costMix = inTok * IN_MISS * (1 + (PEAK - 1) * PEAK_SHARE) + mid * OUT * (1 + (PEAK - 1) * PEAK_SHARE);
  rows.push({ key, label: c.label, inTok, outs, costOff, costMix });
  console.log(
    c.label.padEnd(32) +
    String(Math.round(inTok)).padStart(8) +
    ('  ' + outs.map((o) => Math.round(o)).join(' / ')).padStart(22) +
    ('¥' + costOff.toFixed(5)).padStart(12) +
    ('¥' + costMix.toFixed(5)).padStart(12)
  );
}

// ---------- 加权平均 ----------
// 使用结构：解析占大头（点词即查），出题/短文是低频主动操作
const MIX = {
  analyze: 0.60, story: 0.15, quiz: 0.10,
  definition_questions: 0.05, cloze_questions: 0.05, real_exam_explanation: 0.05,
};
let avgMix = 0;
for (const [k, w] of Object.entries(MIX)) {
  avgMix += rows.find((r) => r.key === k).costMix * w;
}
console.log('-'.repeat(104));
console.log('加权平均单次（含峰谷）: ¥' + avgMix.toFixed(5) + '  ≈ ' + (avgMix * 100).toFixed(3) + ' 分/次');
console.log('（上一版文档：¥0.00107 含峰 —— 当时按输出 ¥2 算）');

console.log('\n=== 重度用户月成本（AI 部分）===');
for (const n of [100, 150, 300]) {
  console.log(`  ${String(n).padStart(3)} 次/月 → ¥${(avgMix * n).toFixed(3)}`);
}

// ---------- 云开发：区分「固定」与「边际」 ----------
console.log('\n=== 云开发：固定 vs 边际（官方文档口径）===');
console.log('基础套餐 ¥19.9/月 含配额：调用次数 20万次 · 容量 2GB ·');
console.log('  云函数资源使用量 10万GBs · 外网出流量 2GB · CDN流量 5GB');
console.log('超出后按量：调用次数 0.5 元/万次 · 云函数资源使用量 0.00011108 元/GBs');
console.log('');
console.log('→ 所以「单用户边际成本」里的云函数/存储部分，只要没超配额就是 ¥0，');
console.log('  已由 ¥19.9 固定费覆盖。上一版把它算进单用户成本（¥0.08+¥0.05）属重复计算。');

// 调用次数压力测试
console.log('\n=== 真正的瓶颈：调用次数 20万次/月 ===');
console.log('（数据库读写 + 云存储上传下载 + 云函数调用，全部计入同一个池子）');
for (const perUser of [500, 1000, 1500]) {
  const limitUsers = Math.floor(200000 / perUser);
  console.log(`  单用户 ${String(perUser).padStart(4)} 次/月 → 配额仅够 ${String(limitUsers).padStart(3)} 个活跃用户`);
}
console.log('  超出部分 0.5 元/万次。');
for (const users of [500, 1000, 3000]) {
  const used = users * 1000;
  const over = Math.max(0, used - 200000);
  console.log(`  ${String(users).padStart(4)} 活跃用户 × 1000 次 = ${used} 次 → 超出 ${over} 次 = ¥${(over / 10000 * 0.5).toFixed(2)}/月`);
}

// ---------- 与文档结论对比 ----------
console.log('\n=== 结论对比 ===');
console.log('文档原值：AI 100 次 = ¥0.20，单用户合计 ≈ ¥0.30');
const newAI100 = avgMix * 100;
console.log('复算：AI 100 次 = ¥' + newAI100.toFixed(3) + '（' +
  (newAI100 >= 0.20 ? '比原值高 ' : '比原值低 ') +
  (Math.abs(newAI100 - 0.20) / 0.20 * 100).toFixed(0) + '%）');
console.log('边际成本（不含固定套餐）= AI 部分 ¥' + newAI100.toFixed(3));

console.log('\n=== 1000 付费用户月成本（¥9.9/月 SKU）===');
const ai = avgMix * 150 * 1000;
const call = Math.max(0, 1000 * 1000 - 200000) / 10000 * 0.5;
console.log('  AI（人均 150 次/月）  ¥' + ai.toFixed(2));
console.log('  调用次数超额        ¥' + call.toFixed(2));
console.log('  固定套餐           ¥19.9');
console.log('  合计               ¥' + (ai + call + 19.9).toFixed(2) + ' / 月（收入 ¥9,900）');
console.log('  占比               ' + ((ai + call + 19.9) / 9900 * 100).toFixed(1) + '%');

// ---------- 最坏情形 ----------
console.log('\n=== 最坏情形：代码未设 max_tokens ===');
console.log('ai/index.js 里没有任何 max_tokens 限制。V4.1-Flash 最大输出 384K token。');
for (const cap of [8192, 65536]) {
  console.log(`  单次跑满 ${cap} token（高峰）→ ¥${(cap * OUT * PEAK).toFixed(4)}（是均值的 ${((cap * OUT * PEAK) / avgMix).toFixed(0)} 倍）`);
}
console.log('  1000 用户 × 每月各 1 次跑满 8192（高峰）→ ¥' + (1000 * 8192 * OUT * PEAK).toFixed(2));
