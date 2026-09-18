/**
 * 换模型能省多少钱？—— 多厂商单价横向对比（2026-09-18）
 *
 * 数据来源与可信度分级：
 *   【L1 官方定价页，已核实】
 *   · DeepSeek  https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *       deepseek-flash：输入未命中 闲 ¥1 / 高 ¥2，输出 闲 ¥4 / 高 ¥8
 *       deepseek-v4-pro：输入未命中 闲 ¥4.5 / 高 ¥9，输出 闲 ¥13.5 / 高 ¥27
 *       高峰＝工作日 9:00-12:00 / 14:00-18:00（北京时间），其余空闲
 *   · 腾讯云 TokenHub  https://intl.cloud.tencent.com/zh/document/product/1300/78937
 *       （USD/百万 token，按 1:7.0 折算；仅列文本模型）
 *       Hy3          $0.132 / $0.528 / 缓存 $0.033  → ≈ ¥0.92 / ¥3.70
 *       Hy4 preview  $0.834 / $2.501              → ≈ ¥5.84 / ¥17.51
 *       GLM-5.3-Flash $0.15 / $0.50               → ≈ ¥1.05 / ¥3.50
 *       DeepSeek-V4-Flash 0731 正式版【原厂直供】闲 $0.22/$0.66、高 $0.44/$1.32
 *   · 腾讯网报道 Hy3 定价 ¥1 / ¥4（与 TokenHub 美元价一致，互为印证）
 *   【L3 存疑，仅作参考】
 *   · Hunyuan TurboS ¥0.8 / ¥2.0 —— 三个聚合站一致，但 TokenHub 官方表已无此模型，
 *     大概率是旧款/已下线，不计入对比。
 *   · GLM-4.7-Flash 免费 —— 智谱自家（非腾讯云），免费档质量与限流未验证。
 *
 * 用法：node .workbuddy/vendor_compare.cjs
 * 改价只改 VENDORS 表；token 用量取自 cost_estimate.cjs 的实测值。
 */

// ---------- 各 action 实测 token 规模（来自 cost_estimate.cjs，勿手改）----------
// [输入 tok, 输出 tok（典型档）]
const USAGE = {
  analyze: [136, 199],
  quiz: [159, 990],
  definition_questions: [361, 2457],
  cloze_questions: [371, 1744],
  real_exam_explanation: [168, 94],
  story: [119, 403],
};
const LABEL = {
  analyze: 'analyze 单词解析',
  quiz: 'quiz 出 10 题',
  definition_questions: 'definition_questions 释义单选(15词)',
  cloze_questions: 'cloze_questions 完形选词(15词)',
  real_exam_explanation: 'real_exam_explanation 真题解析',
  story: 'story 短文生成',
};

// 使用结构：点词解析占大头，出题/短文为低频主动操作
const MIX = {
  analyze: 0.60, story: 0.15, quiz: 0.10,
  definition_questions: 0.05, cloze_questions: 0.05, real_exam_explanation: 0.05,
};

// 考研学生作息 → 高峰时段占比（早读 6:30-8 / 晚自习 19-23 空闲；上午下午高峰）
const PEAK_SHARE = 0.5;

// ---------- 厂商价目（元/百万 token）----------
// peak：峰谷倍数（高峰 ＝ 闲时 × peak）；无峰谷则 1
const VENDORS = [
  { name: 'DS-flash*,在用', in: 1.0, out: 4.0, peak: 2 },
  { name: '混元 Hy3', in: 1.0, out: 4.0, peak: 1 },
  { name: 'DS-v4-pro', in: 4.5, out: 13.5, peak: 2 },
  { name: '混元 Hy4prev', in: 5.84, out: 17.51, peak: 1 },
  { name: 'GLM-5.3-Flash', in: 1.05, out: 3.5, peak: 1 },
  { name: 'GLM4.7F(免费)', in: 0, out: 0, peak: 1 },
];
const COL = 14;
const per = (t) => t / 1e6;

/** 单次调用成本，peakRatio 为高峰占比（0=全空闲，1=全高峰） */
function cost(v, inTok, outTok, peakRatio = PEAK_SHARE) {
  const k = 1 + (v.peak - 1) * peakRatio;
  return (per(inTok) * v.in + per(outTok) * v.out) * k;
}

function table(peakRatio, title) {
  console.log(`\n=== ${title} ===\n`);
  const keys = Object.keys(USAGE);
  let head = '功能'.padEnd(34);
  for (const v of VENDORS) head += v.name.padStart(COL);
  console.log(head);
  console.log('-'.repeat(34 + COL * VENDORS.length));

  const totals = VENDORS.map(() => 0);
  for (const k of keys) {
    const [i, o] = USAGE[k];
    let line = LABEL[k].padEnd(32);
    VENDORS.forEach((v, idx) => {
      const c = cost(v, i, o, peakRatio);
      totals[idx] += c * MIX[k];
      line += ('¥' + c.toFixed(5)).padStart(COL);
    });
    console.log(line);
  }

  console.log('-'.repeat(34 + COL * VENDORS.length));
  let avg = '加权平均单次'.padEnd(32);
  VENDORS.forEach((_, idx) => { avg += ((totals[idx] * 100).toFixed(3) + '分').padStart(COL); });
  console.log(avg);

  const base = totals[0];
  let ratio = '相对在用模型'.padEnd(32);
  VENDORS.forEach((_, idx) => {
    ratio += (idx === 0 ? '基准' : (base === 0 ? '-' : (totals[idx] / base * 100).toFixed(0) + '%')).padStart(COL);
  });
  console.log(ratio);
  return totals;
}

const mixTotals = table(PEAK_SHARE, `各功能单次成本（元）· 按考研学生 ${PEAK_SHARE * 100}% 高峰占比`);

// ---------- 极端时段看峰谷的影响 ----------
console.log('\n=== 峰谷敏感度（加权平均单次，分）===');
console.log('场景'.padEnd(20) + VENDORS.map((v) => v.name.padStart(COL)).join(''));
console.log('-'.repeat(20 + COL * VENDORS.length));
for (const [label, r] of [['全部空闲时段', 0], ['全部高峰时段', 1], ['混合(本项目估计)', PEAK_SHARE]]) {
  const t = table2(r);
  let line = label.padEnd(18);
  t.forEach((x) => { line += ((x * 100).toFixed(3) + '分').padStart(COL); });
  console.log(line);
}
function table2(peakRatio) {
  const totals = VENDORS.map(() => 0);
  for (const k of Object.keys(USAGE)) {
    const [i, o] = USAGE[k];
    VENDORS.forEach((v, idx) => { totals[idx] += cost(v, i, o, peakRatio) * MIX[k]; });
  }
  return totals;
}

// ---------- 月成本 ----------
console.log('\n=== 重度用户月成本（AI 部分）===');
console.log('使用档位'.padEnd(20) + VENDORS.map((v) => v.name.padStart(COL)).join(''));
console.log('-'.repeat(20 + COL * VENDORS.length));
for (const n of [100, 300, 1000]) {
  let line = `${n} 次/月`.padEnd(18);
  mixTotals.forEach((t) => { line += ('¥' + (t * n).toFixed(2)).padStart(COL); });
  console.log(line);
}

// ---------- 结论 ----------
const base = mixTotals[0];
const hy3 = mixTotals[1];
console.log('\n=== 结论 ===');
console.log(`· 混元 Hy3 与 DeepSeek flash 闲时单价完全相同（均 ¥1/¥4），差别只在峰谷。`);
console.log(`· 混元无峰谷 → 高峰时段省一半；闲时打平。`);
console.log(`  高峰占比 0%：${(table2(0)[1] / table2(0)[0] * 100).toFixed(0)}% | ` +
  `50%：${(hy3 / base * 100).toFixed(0)}% | 100%：${(table2(1)[1] / table2(1)[0] * 100).toFixed(0)}%`);
console.log(`· 本项目加权：单次 ${(base * 100).toFixed(3)} 分 → ${(hy3 * 100).toFixed(3)} 分，省 ${((base - hy3) / base * 100).toFixed(0)}%`);
console.log(`  100 次/月：¥${(base * 100).toFixed(2)} → ¥${(hy3 * 100).toFixed(2)}，省 ¥${((base - hy3) * 100).toFixed(2)}/月`);
console.log(`  1000 用户 × 150 次/月：¥${(base * 150 * 1000).toFixed(0)} → ¥${(hy3 * 150 * 1000).toFixed(0)}，省 ¥${((base - hy3) * 150 * 1000).toFixed(0)}/月`);
console.log('· 绝对金额太小 —— 决策应看接入成本、合规、稳定性，而不是单价。');
console.log('· 反直觉点：经腾讯云 TokenHub 转售的 DeepSeek 反而更贵（原厂直供闲时');
console.log('  $0.22/$0.66 ≈ ¥1.54/¥4.62，vs DeepSeek 原厂 ¥1/¥4）。「用腾讯的」≠「更便宜」。');
