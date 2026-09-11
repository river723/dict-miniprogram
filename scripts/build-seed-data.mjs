/**
 * 把词库打包成「云函数内置数据」。
 *
 * 存在的理由：手动导入 26 个文件太累，脚本导入又要腾讯云密钥。
 * 词库原始 3.6MB，直接塞云函数代码包容易撞上传限制；gzip 后约 1MB，稳得多。
 * 部署后在小程序端点一次按钮就能全量灌进去，零密钥、零上传。
 *
 * 产物（两套，云函数优先用第一套）：
 *   1. cloudfunctions/seed/seed-data.js   —— 与 index.js 同级的模块，内容是一段
 *      gzip+base64 的全量数据。之所以要这个：曾遇到云端运行时 /var/user/data 不存在
 *      （子目录没随代码包落地），而根目录的 .js 与入口同级，一定在。
 *   2. cloudfunctions/seed/data/part-NN.json.gz —— 分片文件，作为后备。
 *
 * 用法：
 *   npm run seed:build
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = resolve(ROOT, '../memo-grad/src/data/worddict.json');
const SEED_DIR = resolve(ROOT, 'cloudfunctions/seed');
const OUT_DIR = resolve(SEED_DIR, 'data');
const INLINE = resolve(SEED_DIR, 'seed-data.js');
const PER_PART = 800;

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const docs = Object.entries(raw.results).map(([word, v]) => ({
  word_id: word,
  word,
  prefix: /^[a-z]/i.test(word) ? word[0].toLowerCase() : '',
  definitions: v.definitions || [],
  etymology: v.etymology || '',
  similar_words: v.similar_words || [],
  memory_tip: v.memoryTip || '',
  frequency: v.examFrequency ?? 0,
  difficulty: v.suggestedDifficulty ?? 3,
}));

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// ---- 产物 1：根目录内联模块（主用） ----
const wholePlain = Buffer.from(JSON.stringify(docs), 'utf8');
const wholeGz = gzipSync(wholePlain, { level: 9 });
const b64 = wholeGz.toString('base64');
// 拆成定长行，避免出现一行 130 万字符（编辑器/工具链不友好）
const CHUNK = 200;
const lines = [];
for (let i = 0; i < b64.length; i += CHUNK) lines.push(`  '${b64.slice(i, i + CHUNK)}',`);
writeFileSync(
  INLINE,
  `/**
 * 自动生成，请勿手改 —— 由 scripts/build-seed-data.mjs 生成。
 *
 * 词库全量数据：JSON 经 gzip(level=9) 压缩后再 base64，共 ${docs.length} 条。
 * 放在与 index.js 同级的位置（而不是 data/ 子目录），是因为云端曾出现
 * 「子目录没随代码包落地」导致 /var/user/data ENOENT 的情况；
 * 根目录的 .js 模块和入口文件一起走，最不容易出意外。
 *
 * 换数据源后重新生成：npm run seed:build（然后重新部署 seed 云函数）
 */
module.exports = [
${lines.join('\n')}
].join('');
`,
  'utf8',
);

console.log(`seed-data.js        ${docs.length} 条  ${(wholePlain.length / 1024 / 1024).toFixed(2)}MB → gzip ${(wholeGz.length / 1024 / 1024).toFixed(2)}MB → base64 ${(b64.length / 1024 / 1024).toFixed(2)}MB`);

// ---- 产物 2：分片文件（后备） ----
let gzBytes = 0;
for (let i = 0, part = 1; i < docs.length; i += PER_PART, part += 1) {
  const slice = docs.slice(i, i + PER_PART);
  const packed = gzipSync(Buffer.from(JSON.stringify(slice), 'utf8'), { level: 9 });
  writeFileSync(resolve(OUT_DIR, `part-${String(part).padStart(2, '0')}.json.gz`), packed);
  gzBytes += packed.length;
  console.log(`data/part-${String(part).padStart(2, '0')}.json.gz  ${slice.length} 条  ${(packed.length / 1024).toFixed(0)}KB`);
}

console.log(`\n共 ${docs.length} 条；分片合计 ${(gzBytes / 1024 / 1024).toFixed(2)}MB`);
console.log('已写入 cloudfunctions/seed/ —— 部署 seed 云函数后即可在小程序里一键导入');
