/**
 * AI 短文解析（学习页短文模式 / 阅读 Tab 生成文章 共用）。
 *
 * 兼容两种返回形态：
 *   1) 旧版（学习页）：`**word**` 高亮 + 文末「中文翻译：」
 *   2) 新版（生成文章页）：首行「标题：xxx」+ 上述标记
 */

/**
 * @param {string} content AI 原始返回
 * @param {string[]} words 目标词（用于标记 isWord，命中 **词** 里的词时置 true）
 * @returns {{title: string, body: string, translation: string, segments: Array<{text:string,hit:boolean}>}}
 */
export function parseArticle(content, words = []) {
  let raw = String(content || '').replace(/```[a-zA-Z]*|```/g, '').trim();

  // 标题
  let title = '';
  const titleMatch = raw.match(/^\s*标题\s*[：:]\s*(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim().replace(/^["“]|["”]$/g, '');
    raw = raw.replace(titleMatch[0], '').trim();
  }

  // 中文翻译
  let body = raw;
  let translation = '';
  const marker = raw.search(/中文翻译|中文译文|译文/);
  if (marker >= 0) {
    body = raw.slice(0, marker);
    translation = raw.slice(marker).replace(/^[^：:]*[：:]\s*/, '').trim();
  }

  const hitSet = new Set(words.map((w) => String(w).toLowerCase()));
  const segments = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m = re.exec(body);
  while (m) {
    if (m.index > last) segments.push({ text: body.slice(last, m.index), hit: false });
    const word = m[1];
    segments.push({ text: word, hit: hitSet.size === 0 || hitSet.has(word.toLowerCase()) });
    last = m.index + m[0].length;
    m = re.exec(body);
  }
  if (last < body.length) segments.push({ text: body.slice(last), hit: false });

  return {
    title,
    body: body.replace(/\*\*/g, '').trim(),
    translation,
    segments: segments.filter((s) => s.text),
  };
}

/**
 * 未加 ** 标记时的兜底：按目标词把纯文本切成交替片段。
 *
 * 空白处理是关键：切割后空白可能落在片段**首部**（如 ` in the ...`），
 * 而元素内容起始处的空白会被渲染层折叠掉 —— 表现为"目标词后换行"。
 * 这里统一把空白**归并到前一个片段的末尾**（元素内容中部的空白不会被折叠），
 * 且保持普通空格，以便正常折行。
 */
export function markWords(plain, words = []) {
  const text = String(plain == null ? '' : plain);
  const list = words
    .filter(Boolean)
    .map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (list.length === 0 || !text) return [{ text, hit: false }];
  const re = new RegExp(`\\b(${list.join('|')})\\b`, 'gi');
  const out = [];
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });

  // 把每个片段首部的空白搬到前一个片段的末尾
  for (let i = 1; i < out.length; i += 1) {
    const lead = out[i].text.match(/^[ \t]+/);
    if (!lead) continue;
    out[i].text = out[i].text.slice(lead[0].length);
    out[i - 1].text += lead[0];
  }
  return out.filter((s) => s.text);
}

/** 智能推荐选词：优先「文章覆盖次数少」→「历史正确率低」。 */
export function recommendWords(words, coverage, accuracy, count) {
  const scored = words.map((w) => ({
    w,
    cov: coverage[w.word.toLowerCase()] || 0,
    acc: accuracy[w.id] == null ? 1 : accuracy[w.id],
  }));
  scored.sort((a, b) => {
    if (a.cov !== b.cov) return a.cov - b.cov;
    return a.acc - b.acc;
  });
  // 覆盖 ≥3 次的词不推荐（与 App 一致）
  const fresh = scored.filter((s) => s.cov < 3);
  const pool = fresh.length >= count ? fresh : scored;
  return pool.slice(0, count).map((s) => s.w);
}
