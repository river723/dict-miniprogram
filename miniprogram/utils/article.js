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
 * 空白处理（关键，踩过多轮坑）：
 *   CSS 会折叠「元素边界的空白」—— 片段末尾的空格（跨元素边界）被吃掉；
 *   片段开头的空格（元素内容起始处）也被吃掉。
 *   因此这里把空格从片段文本里**剥离**，改为给片段附上 `spaceBefore` 标记，
 *   由 WXML 用独立的空格节点（&nbsp;）渲染。
 *   之所以 nbsp 可用：空格节点是**独立元素**，断行发生在元素之间（行内元素边界），
 *   nbsp 只保证自身不被拆开，不会像之前那样把整句锁成一个不可断的长串。
 *
 * @returns {Array<{text: string, hit: boolean, spaceBefore: number}>}
 */
export function markWords(plain, words = []) {
  const text = String(plain == null ? '' : plain);
  const list = words
    .filter(Boolean)
    .map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  if (list.length === 0 || !text) return [{ text, hit: false, spaceBefore: 0 }];
  const re = new RegExp(`\\b(${list.join('|')})\\b`, 'gi');
  const raw = [];
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) raw.push({ text: text.slice(last, m.index), hit: false });
    raw.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) raw.push({ text: text.slice(last), hit: false });

  // 把每个片段「首尾的空格」都剥出来，记到 spaceBefore / spaceAfter，
  // 交给 WXML 用独立空格节点渲染，彻底避开元素边界空白折叠。
  const out = raw.map((s) => {
    let t = s.text;
    let before = 0;
    let after = 0;
    const lead = t.match(/^[ \t]+/);
    if (lead) {
      before = lead[0].length;
      t = t.slice(lead[0].length);
    }
    const tail = t.match(/[ \t]+$/);
    if (tail) {
      after = tail[0].length;
      t = t.slice(0, t.length - tail[0].length);
    }
    return { text: t, hit: s.hit, spaceBefore: before, spaceAfter: after };
  });

  // 相邻片段的 spaceAfter + 下一个的 spaceBefore 合并为下一个的 spaceBefore
  const merged = [];
  for (const s of out) {
    if (merged.length && merged[merged.length - 1].spaceAfter > 0) {
      // 上一段尾随空格：如果本轮还有前导空格，取较大值（通常都是 1）
      s.spaceBefore = Math.max(s.spaceBefore, merged[merged.length - 1].spaceAfter);
      merged[merged.length - 1].spaceAfter = 0;
    }
    merged.push(s);
  }
  // 末尾残留的 spaceAfter（段落收尾空格）无意义，丢弃
  return merged.filter((s) => s.text);
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
