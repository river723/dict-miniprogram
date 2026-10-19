/**
 * 由 _tools/ielts_defs.json + _tools/ielts_metrics.json 生成 miniprogram/data/libraries/ielts.js。
 *
 * 产物为「词条数组」而非纯字符串数组：
 *   export default [{ w:'abandon', ph:'əˈbændən', d:'vt.放弃,遗弃；n.放任,狂热', f:2, k:3 }, ...]
 *
 * 设计取舍：
 *   - 词表以 eudic 真实词头为准（4491 个，全部带释义），不再用早期 FMM+LNDS 的纯词串还原
 *     （那版会切出 decreased/dangled 等幻词，且无释义）。
 *   - 字段名压到最短（w/ph/d + f/k）：4491 条 × ~70B ≈ 320KB，主包体积敏感，长命名会浪费 ~60KB。
 *     f = 考频 1-5、k = 难度 1-5，由 relabel_ielts_metrics.cjs 按真实语料 + 客观指标算出。
 *     缺 metrics 时仍可生成（f/k 缺省，不影响旧流程）。
 *   - 消费者：
 *       · services/libraries.js#getLibraryWords → 映射成字符串数组，供 autoWord 候选池使用；
 *       · services/libraries.js#getLibraryEntry → 取 {w,ph,d,f,k}，供浏览/详情页显示。
 *
 * 上游：_tools/parse_eudic_defs.cjs（解压 zlib 块 + 解析 HTML 词条）→ _tools/ielts_defs.json
 *       _tools/relabel_ielts_metrics.cjs（AWL + web 语料 → 考频/难度）→ _tools/ielts_metrics.json
 * 用法：node _tools/gen_ielts_js.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '_tools/ielts_defs.json');
const metricsFile = path.join(root, '_tools/ielts_metrics.json');
const outDir = path.join(root, 'miniprogram/data/libraries');
const out = path.join(outDir, 'ielts.js');

const defs = JSON.parse(fs.readFileSync(src, 'utf8'));
const metrics = fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, 'utf8')) : null;
if (!metrics) console.warn('⚠ 未找到 ielts_metrics.json，将不输出 f/k（考频/难度）字段');
fs.mkdirSync(outDir, { recursive: true });

let withMetrics = 0;
const entries = Object.keys(defs).map((k) => {
  const e = defs[k];
  const base = { w: e.word, ph: e.ph || '', d: e.def || '' };
  const m = metrics && metrics[String(e.word).toLowerCase()];
  if (m && m.f >= 1 && m.f <= 5 && m.k >= 1 && m.k <= 5) {
    withMetrics += 1;
    return { ...base, f: m.f, k: m.k };
  }
  return base;
});
// 与线上旧版一致：按字母序排列，便于浏览页按首字母取词
entries.sort((a, b) => a.w.toLowerCase().localeCompare(b.w.toLowerCase()));

const body = '// 自动生成，请勿手改。源：IELTS_Basic_Vocabulary.eudic（欧路词典·雅思基础词汇）。\n'
  + '// 管线：_tools/parse_eudic_defs.cjs（解压 zlib 块 + 解析 HTML 词条）→ ielts_defs.json → 本文件。\n'
  + '// 词条以 eudic 真实词头为准，全部带释义；w=单词 ph=音标 d=释义（前 2 个义项，以「；」分隔）。\n'
  + '// f=考频 1-5（真实语料频次 + AWL 学术加权，非「雅思卷面出现次数」，无官方逐词数据）\n'
  + '// k=难度 1-5（音节数/派生后缀/义项数/词长的客观指标，与考频相互独立）\n'
  + `export default ${JSON.stringify(entries)};\n`;

fs.writeFileSync(out, body, 'utf8');
console.log('wrote', entries.length, 'entries ->', out, '| bytes:', fs.statSync(out).size,
  `| 带 f/k 的词条: ${withMetrics}`);
