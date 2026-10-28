/**
 * 提交前密钥扫描（被 .githooks/pre-commit 调用，也可手动跑：node .workbuddy/secret-scan.cjs）。
 *
 * 为什么要它：2026-10-28 推送被 GitHub secret scanning 拒绝 —— 排障时把真实腾讯云
 * SecretId（AKID 开头）写进了 .workbuddy/memory/2026-10-28.md。日志是要入库的
 * （项目记忆靠 git 同步给后续会话），所以「随手把凭证值记进日志」是很自然的事。
 *
 * 只扫**暂存区新增行**，避免历史内容误报。命中即 exit 1 拒绝提交。
 */
const { execSync } = require('child_process');

// 高置信度规则（命中即拦截）
const PATTERNS = [
  { name: '腾讯云 SecretId', re: /AKID[A-Za-z0-9]{20,}/ },
  { name: 'DeepSeek key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub PAT', re: /github_pat_[A-Za-z0-9_]{50,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: '私钥块', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: '微信支付 APIv3 密钥', re: /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/ },
];

function stagedDiff() {
  try {
    return execSync('git diff --cached --no-color -U0', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return '';
  }
}

const diff = stagedDiff();
if (!diff) {
  console.log('[secret-scan] 无暂存改动，放行');
  process.exit(0);
}

const hits = [];
for (const line of diff.split('\n')) {
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const content = line.slice(1);
  for (const p of PATTERNS) {
    const m = content.match(p.re);
    if (m) hits.push({ name: p.name, sample: m[0].slice(0, 8) + '***' });
  }
}

if (hits.length) {
  console.error('\n✗ 提交被拦截：检测到疑似密钥\n');
  const seen = new Set();
  for (const h of hits) {
    const key = h.name + h.sample;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  · ${h.name}  ${h.sample}`);
  }
  console.error('\n密钥一旦推上远端就等于公开泄露（即使只有 SecretId、没有 Key）。');
  console.error('处理方式：');
  console.error('  1. 把该值从文件里删掉/脱敏（只写「已能 echo 出来」这类描述，不写值本身）；');
  console.error('  2. 若已推送过，务必去云控制台轮换该密钥；');
  console.error('  3. 重新 git add 后再提交。');
  console.error('\n（确属误报可临时跳过：git commit --no-verify）\n');
  process.exit(1);
}

console.log('[secret-scan] 暂存区未发现疑似密钥，放行');
process.exit(0);
