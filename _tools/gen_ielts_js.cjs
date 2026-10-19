/**
 * 由 _tools/ielts_defs.json 生成 miniprogram/data/libraries/ielts.js。
 *
 * 产物为「词条数组」而非纯字符串数组：
 *   export default [{ w:'abandon', ph:'əˈbændən', d:'vt.放弃,遗弃；n.放任,狂热' }, ...]
 *
 * 设计取舍：
 *   - 词表以 eudic 真实词头为准（4491 个，全部带释义），不再用早期 FMM+LNDS 的纯词串还原
 *     （那版会切出 decreased/dangled 等幻词，且无释义）。
 *   - 字段名压到最短（w/ph/d）：4491 条 × ~70B ≈ 320KB，主包体积敏感，长命名会浪费 ~60KB。
 *   - 消费者：
 *       · services/libraries.js#getLibraryWords → 映射成字符串数组，供 autoWord 候选池使用；
 *       · services/libraries.js#getLibraryEntry → 取 {w,ph,d}，供浏览/详情页显示。
 *
 * 上游：_tools/parse_eudic_defs.cjs（解压 zlib 块 + 解析 HTML 词条）→ _tools/ielts_defs.json
 * 用法：node _tools/gen_ielts_js.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '_tools/ielts_defs.json');
const outDir = path.join(root, 'miniprogram/data/libraries');
const out = path.join(outDir, 'ielts.js');

const defs = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const entries = Object.keys(defs).map((k) => {
  const e = defs[k];
  return { w: e.word, ph: e.ph || '', d: e.def || '' };
});
// 与线上旧版一致：按字母序排列，便于浏览页按首字母取词
entries.sort((a, b) => a.w.toLowerCase().localeCompare(b.w.toLowerCase()));

const body = '// 自动生成，请勿手改。源：IELTS_Basic_Vocabulary.eudic（欧路词典·雅思基础词汇）。\n'
  + '// 管线：_tools/parse_eudic_defs.cjs（解压 zlib 块 + 解析 HTML 词条）→ ielts_defs.json → 本文件。\n'
  + '// 词条以 eudic 真实词头为准，全部带释义；w=单词 ph=音标 d=释义（前 2 个义项，以「；」分隔）。\n'
  + `export default ${JSON.stringify(entries)};\n`;

fs.writeFileSync(out, body, 'utf8');
console.log('wrote', entries.length, 'entries ->', out, '| bytes:', fs.statSync(out).size);
