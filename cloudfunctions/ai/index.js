/**
 * ai 云函数 —— DeepSeek 代理（密钥只存云函数环境变量 DEEPSEEK_API_KEY，绝不下发前端）。
 * action:
 *   analyze  单词解析：翻译、词性、熟词僻义、例句
 *   quiz     依据给定词表生成选择题（中文释义单选，含题干中文翻译）
 *   story    依据给定词表生成短文（上下文记词）
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BASE_URL = 'api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const TIMEOUT = 120000;

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
        prompt = buildStoryPrompt(event.words);
        break;
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
    const content = await chat(key, prompt);
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

function buildStoryPrompt(words) {
  return [
    `你是考研英语写作专家。请用以下单词写一篇 150 词左右、难度适中的英文短文，`,
    `并将目标单词自然融入文中（用 **词** 标出），文末给中文全文翻译。`,
    `单词列表：${words.join(', ')}`,
  ].join('\n');
}

function chat(apiKey, prompt) {
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
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) return reject(new Error(json.error.message || 'AI 服务错误'));
          resolve(json.choices[0].message.content);
        } catch (e) {
          reject(new Error('AI 响应解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('AI 请求超时')); });
    req.write(JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }));
    req.end();
  });
}
