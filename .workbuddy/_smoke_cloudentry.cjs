/**
 * 定向单测：wordEnrich#fromCloudEntry 对两种云文档的归一化。
 *   A. 考研词条（无音标字段，frequency 可能为 0）
 *   B. 雅思词条（phonetic_uk 音标，frequency 1-5）
 * 做法：读真实模块源码 + 末尾追加 export，写临时 .mjs 后 import（不改仓库文件）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-fce-'));

// wordEnrich 只 import 相对模块，单测不需要它们真被加载（fromCloudEntry 不触碰），
// 但 ESM 会解析 import 链 —— 把两个依赖也拷进来并改成 .mjs 平铺。
const deps = [
  'miniprogram/services/libraries.js',
  'miniprogram/data/libraries/ielts.js',
  'miniprogram/services/worddict.js',
  'miniprogram/services/cloud.js',
];
const copy = (rel, extra = '') => {
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  src = src.replace(/from '(\.[^']*)'/g, (m, p) => {
    const abs = path.resolve(path.dirname(path.join(ROOT, rel)), p);
    const base = path.basename(abs).replace(/\.js$/, '');
    const known = deps.some((d) => path.basename(d).replace(/\.js$/, '') === base) || base === 'wordEnrich';
    return known ? `from './${base}.mjs'` : m;
  });
  const dest = path.join(TMP, path.basename(rel).replace(/\.js$/, '.mjs'));
  fs.writeFileSync(dest, src + extra);
};
deps.forEach((d) => copy(d));
copy('miniprogram/services/wordEnrich.js', '\nexport { fromCloudEntry };\n');

const kyoyo = {
  word_id: 'abandon', word: 'abandon', prefix: 'a',
  definitions: [
    { part_of_speech: 'v.', meaning: '抛弃；放弃', example: 'They had to abandon the plan.', is_core: true, is_rare_sense: false },
    { part_of_speech: 'n.', meaning: '放纵', example: 'with reckless abandon', is_core: false, is_rare_sense: true },
  ],
  etymology: 'ab-（离开）+ bandon（控制）',
  similar_words: [{ word: 'abundant', relation: 'spelling', description: '拼写近词义无关' }],
  memory_tip: 'a+b+andon：一再地放任',
  frequency: 0, difficulty: 2,
};
const ieltsDoc = {
  word_id: 'asthma', word: 'asthma', prefix: 'a', phonetic_uk: 'ˈæsmə',
  definitions: [
    { part_of_speech: 'n.', meaning: '哮喘', example: 'Cold air can trigger asthma attacks.', is_core: true, is_rare_sense: false },
  ],
  etymology: '希腊语 asthma（喘息）',
  similar_words: [],
  memory_tip: '谐音「阿什玛」',
  frequency: 2, difficulty: 3,
};

(async () => {
  const { fromCloudEntry } = await import(pathToFileURL(path.join(TMP, 'wordEnrich.mjs')).href);

  const a = fromCloudEntry(kyoyo);
  console.log('A 考研:', JSON.stringify({
    word: a.word, ph: a.ph, src: a.src,
    def: a.def,
    defs: a.definitions.length,
    def0: a.definitions[0],
    etym: !!a.etymology, sim: a.similar_words.length, sim0: a.similar_words[0],
    tip: !!a.memory_tip, freq: a.frequency, diff: a.difficulty,
  }, null, 1));

  const b = fromCloudEntry(ieltsDoc);
  console.log('\nB 雅思:', JSON.stringify({
    word: b.word, ph: b.ph, src: b.src,
    defs: b.definitions.length, sim: b.similar_words.length,
    freq: b.frequency, diff: b.difficulty,
  }, null, 1));

  const checks = [
    ['A ph 为空串（考研无音标）', a.ph === ''],
    ['A def 拼接两义项', a.def === 'v. 抛弃；放弃；n. 放纵'],
    ['A definitions 结构化', a.definitions[1].is_rare_sense === true && a.definitions[0].is_core === true],
    ['A similar_words 归一', a.similar_words[0].relation === 'spelling'],
    ['A frequency 0 透传（不硬抬成 1）', a.frequency === 0],
    ['B ph 取 phonetic_uk', b.ph === 'ˈæsmə'],
    ['B similar 空数组', Array.isArray(b.similar_words) && b.similar_words.length === 0],
    ['B 例句保留', b.definitions[0].example.includes('asthma')],
    ['都带 extra 原文', !!a.extra && !!b.extra],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  checks.forEach(([name, ok]) => console.log(`${ok ? '✓' : '✗'} ${name}`));
  fs.rmSync(TMP, { recursive: true, force: true });
  if (failed.length) { console.error(`\n${failed.length} 项未过`); process.exit(1); }
  console.log('\nfromCloudEntry 单测通过');
})().catch((e) => { console.error('失败：', e); process.exit(1); });
