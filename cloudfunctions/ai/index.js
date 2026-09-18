/**
 * ai 云函数 —— DeepSeek 代理（密钥只存云函数环境变量 DEEPSEEK_API_KEY，绝不下发前端）。
 * action:
 *   analyze  单词解析：翻译、词性、熟词僻义、例句
 *   quiz     依据给定词表生成选择题（中文释义单选，含题干中文翻译）
 *   story    依据给定词表生成短文（上下文记词）
 *   definition_questions  生成「英文释义单选题」（题干含目标词，选项为英文释义）
 *   cloze_questions       生成「完形选词题」（题干留 [BLANK]，选项为单词）
 *
 * 后两个供「练习 Tab · AI 出题」使用，返回结构见各自的 build 函数。
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BASE_URL = process.env.AI_BASE_URL || 'api.deepseek.com';
const MODEL = process.env.AI_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const TIMEOUT = 120000;

/**
 * 思考模式开关。DeepSeek V4.1-Flash 官方默认「开启思考 + effort=high」，
 * 思维链经 reasoning_content 返回并计入输出 token 计费。
 * 本函数 6 个 action 全部是「给定输入 → 固定格式输出」，不需要多步推理，
 * 显式关闭可省下可观比例的输出 token，并显著降低响应延迟。
 */
const THINKING = process.env.AI_THINKING || 'disabled';

/**
 * 各 action 的输出上限（token）。按 .workbuddy/cost_estimate.cjs 的实测输出规模留 2~3 倍余量。
 * 不设上限时模型最大可输出 384K token —— 单次跑满高峰约 ¥3.07，是典型值的近千倍。
 */
const MAX_TOKENS = {
  analyze: 900,
  quiz: 3000,
  story: 1400,
  definition_questions: 7000,
  cloze_questions: 5000,
  real_exam_explanation: 500,
};
const DEFAULT_MAX_TOKENS = 2000;

exports.main = async (event) => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, error: '未配置 DEEPSEEK_API_KEY 环境变量' };
  try {
    let prompt = '';
    switch (event.action) {
      case 'analyze':
        prompt = buildAnalyzePrompt(event.word);
        break;
      case 'quiz':
        prompt = buildQuizPrompt(event.words, event.count || 10);
        break;
      case 'story':
        prompt = buildStoryPrompt(event.words, event.theme, event.length, event.withTitle);
        break;
      case 'definition_questions':
        prompt = buildDefinitionQuestionsPrompt(event.words);
        break;
      case 'cloze_questions':
        prompt = buildClozeQuestionsPrompt(event.words);
        break;
      case 'real_exam_explanation':
        prompt = buildRealExamExplanationPrompt(event);
        break;
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
    const content = await chat(key, prompt, event.action);
    return { ok: true, content };
  } catch (e) {
    console.error('[ai]', e);
    return { ok: false, error: e.message };
  }
};

function buildAnalyzePrompt(word) {
  return [
    `你是考研英语词汇专家。请解析单词 "${word}"，严格输出以下 JSON（不要 markdown 代码块）：`,
    `{`,
    `  "word": "${word}",`,
    `  "phonetic_uk": "英式音标",`,
    `  "definitions": [{"pos": "词性", "meaning": "中文释义"}],`,
    `  "obscure_meanings": [{"familiar": "熟义", "obscure": "僻义", "example": "例句"}],`,
    `  "root_analysis": "词根词缀分析",`,
    `  "memory_tip": "记忆技巧"`,
    `}`,
  ].join('\n');
}

function buildQuizPrompt(words, count) {
  return [
    `你是考研英语出题专家。基于以下单词出 ${count} 道中文释义单选题（每题 4 个选项，含 1 个中文题干翻译提示）。`,
    `单词列表：${words.join(', ')}`,
    `严格输出 JSON 数组（不要 markdown 代码块），每题格式：`,
    `{"word": "单词", "question": "题干", "translation_hint": "题干中文翻译", "options": ["A","B","C","D"], "answer": 0}`,
    `answer 为正确选项的下标（0-3）。`,
  ].join('\n');
}

/** 把 [{word, meaning}] 或 ['word'] 统一格式化成提示词里的词表。 */
function formatWordList(words) {
  return (words || [])
    .map((w, i) => (typeof w === 'string' ? `${i + 1}. ${w}` : `${i + 1}. ${w.word}${w.meaning ? ' —— ' + w.meaning : ''}`))
    .join('\n');
}

/** 释义单选：题干含目标词（用 **词** 标出），选项是英文释义。 */
function buildDefinitionQuestionsPrompt(words) {
  return [
    '你是考研英语出题专家。请为下面每个单词各出 1 道「英文释义单选题」。',
    '单词与释义：',
    formatWordList(words),
    '',
    '要求：',
    '1. sentence：一个含目标单词的英文句子，难度贴近考研阅读；目标单词必须用 **词** 包裹（例如 **abandon**）。',
    '2. options：4 个英文释义选项（英文短语），其中恰好 1 个是该词的正确英文释义，其余 3 个为干扰项。',
    '3. correct_definition：正确选项的原文，必须与 options 中某一项完全一致。',
    '4. chinese_translation：该英文句子的中文翻译。',
    '严格输出 JSON 数组（不要 markdown 代码块、不要多余说明），每项格式：',
    '{"target_word":"abandon","sentence":"He had to **abandon** the plan.","options":["...","...","...","..."],"correct_definition":"...","chinese_translation":"..."}',
  ].join('\n');
}

/** 完形选词：题干留 [BLANK]，选项是单词。 */
function buildClozeQuestionsPrompt(words) {
  return [
    '你是考研英语出题专家。请为下面每个单词各出 1 道「完形选词题」。',
    '单词与释义：',
    formatWordList(words),
    '',
    '要求：',
    '1. sentence：一个英文句子，目标单词的位置用 [BLANK] 占位（例如 "He decided to [BLANK] his old plan."），句中不要出现目标单词本身。',
    '2. options：4 个英文单词选项，其中恰好 1 个是正确答案（即目标单词），其余 3 个为干扰词。',
    '3. correct_answer：正确选项的单词，必须与 options 中某一项完全一致。',
    '4. chinese_hint：该句的中文提示，帮助理解语境但不要直接给出答案。',
    '严格输出 JSON 数组（不要 markdown 代码块、不要多余说明），每项格式：',
    '{"target_word":"abandon","sentence":"He had to [BLANK] the plan.","options":["...","...","...","..."],"correct_answer":"...","chinese_hint":"..."}',
  ].join('\n');
}

/**
 * 真题错题解析：给定题干 / 选项 / 正确答案 / 考生答案，输出中文解析。
 * 供「错题本 · 真题错题」的 AI 解析按钮使用，结果回写到错题快照。
 */
function buildRealExamExplanationPrompt({ mode, stem, blankIndex, options, correctAnswer, userAnswer }) {
  const typeLabel = mode === 'reading' ? '阅读理解' : mode === 'newtype' ? '新题型' : '完形填空';
  const opts = (options || []).map((o, i) => `${'ABCDEFGH'[i]}. ${o}`).join('\n');
  return [
    `你是考研英语辅导老师。下面是考生做错的一道${typeLabel}题，请用中文给出简明解析。`,
    stem ? `题干：${stem}` : '',
    blankIndex != null ? `（这是第 ${blankIndex} 空）` : '',
    opts ? `选项：\n${opts}` : '',
    `正确答案：${correctAnswer}`,
    userAnswer ? `考生答案：${userAnswer}` : '',
    '',
    '要求：直接输出解析正文（不要 markdown 代码块、不要 JSON）。内容包括：',
    '1. 正确答案为什么对（结合原文线索或语法搭配）；',
    '2. 考生答案为什么错（常见误区）；',
    '3. 一句话解题技巧。',
    '全文控制在 150 字以内。',
  ].filter(Boolean).join('\n');
}

const THEME_CN = {  technology: '科技',
  life: '生活',
  history: '历史',
  nature: '自然',
  science: '科学',
};

/**
 * 短文生成。向后兼容：只传 words 时行为与旧版一致（约 150 词、无标题）。
 * theme / length / withTitle 为「阅读 Tab · 生成文章」页新增的可选参数。
 * 返回文本必须保留 **词** 与「中文翻译：」两处标记 —— 学习页短文模式依赖它们切分。
 */
function buildStoryPrompt(words, theme, length, withTitle) {
  const n = Number(length) > 0 ? Number(length) : 150;
  const themeLine = theme && theme !== 'random'
    ? `主题方向：${THEME_CN[theme] || theme}。`
    : '主题不限。';
  return [
    `你是考研英语写作专家。请用以下单词写一篇约 ${n} 词、难度适中的英文短文，`,
    `并将目标单词自然融入文中（用 **词** 标出）。${themeLine}`,
    withTitle ? '第一行输出「标题：<英文标题>」，标题不要加引号。' : '',
    `文末另起一行，以「中文翻译：」开头给出全文中文翻译。`,
    `单词列表：${words.join(', ')}`,
  ].filter(Boolean).join('\n');
}

function chat(apiKey, prompt, action) {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: MAX_TOKENS[action] || DEFAULT_MAX_TOKENS,
  };
  // 厂商默认即思考模式时，可设 AI_THINKING=default 交由厂商决定
  if (THINKING !== 'default') body.thinking = { type: THINKING };

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE_URL,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: TIMEOUT,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(json.error.message || 'AI 服务错误'));
          const choice = json.choices && json.choices[0];
          if (!choice) return reject(new Error('AI 响应结构异常'));
          if (choice.finish_reason === 'length') {
            console.warn(`[ai] ${action} 输出被 max_tokens=${body.max_tokens} 截断`);
          }
          resolve(choice.message.content);
        } catch (e) {
          reject(new Error('AI 响应解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('AI 请求超时')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}
