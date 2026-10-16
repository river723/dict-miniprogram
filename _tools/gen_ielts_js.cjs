const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '_tools/ielts_words.json');
const outDir = path.join(root, 'miniprogram/data/libraries');
const out = path.join(outDir, 'ielts.js');

const words = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const body = '// 自动生成，请勿手改。源数据来自 IELTS_Basic_Vocabulary.eudic（欧路词典雅思基础词汇）。\n'
  + '// 通过 _tools/_seg3.cjs（FMM + LNDS）从 .eudic 明文词头条还原，约 ' + words.length + ' 词。\n'
  + 'export default ' + JSON.stringify(words) + ';\n';

fs.writeFileSync(out, body, 'utf8');
console.log('wrote', words.length, 'words ->', out);
