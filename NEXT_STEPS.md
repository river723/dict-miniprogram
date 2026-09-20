# 下一步行动清单（接手时状态 → 首个体验版）

更新：2026-09-18（新增 3a 节待办） · 2026-09-11 · 对象：[memo-grad-miniprogram](../README.md) 0.1.0 · 云环境 `cloud1-d6gfdnelqf7478e85`

## 0. 体检结论

已完成（代码层面）：

- 14 个页面 + 5 个 service/theme/常量模块 + 4 个云函数 + 2 个数据脚本 + CI 工作流
- 29 个 JS/MJS 全部通过 `node --check`；JSON 全部可解析；无 TODO / 占位 / 未实现标记
- 原 App 36 个 screen → 小程序 14 页，真题多题型 / 文章生成 / 订阅支付 / 后台管理尚未移植

## 1. 已修复（2026-09-11）

| 问题 | 位置 | 处理 |
|---|---|---|
| 云环境没配 | `miniprogram/app.js` + `constants/index.js` | 新增 `CLOUD_ENV = 'cloud1-d6gfdnelqf7478e85'`，`wx.cloud.init` 带上 env；补 `getUpdateManager` 与 `onError`/`onUnhandledRejection` 兜底 |
| 云存储 fileID 缺 bucket | `cloudfunctions/content/index.js` | 改为从 `content_files` 集合按路径查 fileID 再 `downloadFile`（bucket 段无法推导）。配套改了 `scripts/upload-content.mjs`：上传后把返回的 fileID 幂等落库 |
| 离线写入被覆盖丢失 | `miniprogram/services/storage.js` | `pullAll()` 先 `await flushDirty()`，再按 id 合并；仍在脏队列里的文档以本地为准，避免东西没上推就被云端全量冲掉 |
| 词库 1000 条静默截断 | `cloudfunctions/worddict/index.js` + `services/worddict.js` + `pages/wordbook` | `byLetter` 分页取全量（5000 上限保护并返回 `truncated`）；有 keyword 走服务端正则 `search`；UI 给出「结果过多已截断 / 未找到」提示 |
| 词库导入逐条插入太慢 | `scripts/import-worddict.mjs` | 改为每批 `add(docs)` 批量插入，5000+ 词的写入次数从 5000 降到 ~50 |
| WXML 编译报错（`'ABCD'[index]`） | `pages/exam-practice` + `pages/quiz` | 新增 `miniprogram/utils/tools.wxs` 提供 `optionLabel(i)`，两个模板经 `wxs module="tools"` 调用 |
| quiz 模板逻辑错位 | `pages/quiz/quiz.wxml` + `quiz.js` | 原先用 `questions[index].answer` 且 `wx:for` 的 index 与题目下标同名冲突（选中的永远是第 0 项）。改为渲染独立的 `current` 字段 + `wx:for-index="oi"`；顺带修了错题传的是词文本而非 `word_id` |
| 云端读不到词库数据 | `cloudfunctions/seed/index.js` + `scripts/build-seed-data.mjs` | 报 `ENOENT ... scandir '/var/user/data'`：云端包里有 `data/`，运行时目录却没有（子目录未落地）。改为**内联** `seed-data.js`（与 index.js 同级，gzip+base64，1.4MB），加载顺序 内联 → `data/` 分片 → 根目录拍平分片；新增 `{"action":"diag"}` 打印 `__dirname` 与目录实况 |
| 部署首次必失败 | `scripts/deploy-cloudfunctions.mjs` | 首次创建函数后立刻传代码会撞 `FailedOperation.UpdateFunctionCode：当前函数处于Creating状态`。改为自动等 5s 重试（最多 4 次）；另 `--port` 不再硬编码 3799（IDE 服务端口随机），改由 CLI 自动发现 |
| 重复点导入就插重 | `cloudfunctions/seed/index.js` | `importWorddict` 写入前先分页读回云端已有 `word_id` 建 Set 跳过（返回 `skipped`）；新增 `dedupeWorddict` 去重体检/清理（保留最早一条，不在词库中的文档只报不删） |
| 云函数 3 秒超时 | `cloudfunctions/seed/index.js` + `pages/seed` | 报 `-504003 Invoking task timed out after 3 seconds`。导入/去重/清空全改成「时间预算内干一段 → 返回 `done`/`next`/`left` → 页面续跑」；删除并发从 1000 降到 20（高并发反而被限流） |
| 词库整包回传超限 | `cloudfunctions/worddict/index.js` + `services/worddict.js` + `services/autoWord.js` | 自动配词原来 `action:'all'` 把 4801 条（约 1.7~3.4MB）拉回小程序，超过**小程序链路 1MB 响应上限**必失败。改为服务端 `pick`（考频降序 + 日期种子确定性洗牌 + 排除生词本/忽略词），只回传选中的 10 条（约 4KB）；`all` 保留仅作云端测试，超限时明确报错 |

> 教训：WXML 数据绑定不支持方法调用和动态下标，用到一律写 WXS 或在 JS 侧算好字段。

新增约定：**多了一个 `content_files` 集合**（云存储路径 → fileID 映射，权限保持默认，云函数以服务端权限访问）。

## 2. 你还要做的（GUI + 凭据）

| # | 动作 | 验证标准 |
|---|---|---|
| 1 | ~~开通云开发、填 appid~~ **已完成**（环境 `cloud1-d6gfdnelqf7478e85` 已写入代码） | — |
| 2 | ~~部署 6 个云函数~~ **已完成**（助手经开发者工具 CLI 部署，`words`/`worddict`/`content`/`ai`/`setup`/`seed` 均 Active）。以后自己部署：`npm run deploy:cf`，前提是 IDE 已开「设置 → 安全设置 → 服务端口」 | 云函数列表 6 项 Active |
| 3 | **一键灌库**（免密钥）：小程序「我的 → 设置 → 数据初始化」→「① 建集合」→「② 一键导入词库」，进度到 100%。若报 `ENOENT /var/user/data`，说明 seed 是旧版本，先 `npm run deploy:cf -- seed` | worddict 4801 条 |
| 3b | 若「云端」条数**多于** 4801（历史重复写入），点「③ 清理重复」：先体检出报告，确认后删掉多余副本，每个词保留一条 | 云端回到 4801 条 |
| 3c | **去云开发控制台把云函数超时改大**（云函数 → 选函数 → 配置 → 超时时间）：`ai` 60s、`content` 20s、`seed` 60s、其余 20s。默认只有 3 秒，`ai` 调大模型必超时 | `ai` 能正常返回；seed 导入从多轮变成一两轮 |
| 4 | `ai` 云函数配环境变量 `DEEPSEEK_API_KEY`（沿用主仓 `.env` 的 key，模型默认 `deepseek-flash`），否则 AI 出题/短文不可用 | AI 页能返回结果 |
| 5 | 跑主链路：自动配词 → 卡片背诵 → 复习 → 统计 | 学习页出词、能打卡、统计有柱 |

> 顺序别颠倒：灌库必须在云函数部署之后。若中途改了 `worddict` / `content` / `seed` 的代码，记得 `npm run deploy:cf` 重新部署一次。

<details><summary>备选：本地脚本灌库（需腾讯云密钥，会比一键导入快些）</summary>

```bash
npm install
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=cloud1-d6gfdnelqf7478e85 --limit=50
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=cloud1-d6gfdnelqf7478e85
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/upload-content.mjs --env=cloud1-d6gfdnelqf7478e85
```

</details>

<details><summary>兜底：控制台一次导入（不需密钥，但需手动操作）</summary>

`npm run export:single` 生成 `import-data/worddict-all.json`（3.59MB，4801 条，JSON Lines，单文件远低于控制台 50MB 上限），
在云开发控制台 `worddict` 集合点一次「导入」，冲突处理选 Insert（重复导入会产生重复数据）。

</details>

## 3. 第二批移植（2026-09-11 已完成）

第二批目标：把原 App 的「练习 Tab + 真题模块 + 我的 Tab」1:1 搬进小程序。共 30 个页面，
全部通过 `.workbuddy/check_syntax.cjs`（JS 语法 / JSON / WXML / WXSS / 页面四件套 /
跳转目标注册 / 图标名 全量校验，报告见 `.workbuddy/_check_report.json`）。

| 原 App Screen | 小程序页面 | 说明 |
|---|---|---|
| PracticeHub | `pages/practice` | Hero（练习次数 / 平均正确率 / 待复习）+ 双 CTA + AI 题库 / 错题本入口 + 最近练习 5 条 |
| ExamSetup | `pages/exam-setup` | 题数步进器 + 题型分段 + 选词模式 + 词云（覆盖徽标 / 换词）+ 草稿恢复弹窗 |
| ExamAnswer | `pages/exam-answer` | 单题作答，答完自动跳结果 |
| ExamResult | `pages/exam-result` | 得分环 + 逐题回顾 + 错题入库 |
| WrongQuestionReview | `pages/wrong-questions` | 单词 / 真题双 Tab，AI 解析，掌握后自动移出 |
| ExamHistory | `pages/exam-history` | 按来源筛选、删除、重做、真题归档回顾 |
| ExamSetBank | `pages/exam-set-bank` | 按 `origin_id` 分组的套题列表 |
| ExamSetDetail | `pages/exam-set-detail` | 套题内逐题，点目标词跳生词详情 |
| RealExamList | `pages/exam-list` | 年份卡懒加载 × 卷别筛选 × 条目状态（上次得分 / 待复习） |
| RealExamReading / Cloze / NewType | `pages/exam-practice` | 三合一答题壳，新题型提交后原地揭晓 |
| RealExamResult | `pages/real-exam-result` | 得分卡 + 原文&译文对照 + 逐题回顾（支持练习历史归档回顾） |
| RealExamTranslation / Writing | `pages/real-exam-read` | 主观题阅览，参考译文 / 范文默认折叠 |
| StatsScreen | `pages/profile` | 掌握度 Hero（进度环）+ 三指标 + 设置预览 |
| StatsDetail | `pages/stats` | 7 天折线图 + 困难词 Top5（sparkline）+ 里程碑 |
| Settings | `pages/settings` | 外观 / 学习 / 文章生成 / 数据管理 / 高级选项 |
| StoryDetail | `pages/story-read` | 中英对照章节，点高亮词查释义（生词本 → 云端词库回落） |

配套新增：`services/exam.js`、`services/realExam.js`、`utils/story.js`、`utils/wordNav.js`；
`cloudfunctions/ai` 增加 `definition_questions` / `cloze_questions` / `real_exam_explanation` 三个 action。

清理：删除冗余的 `pages/quiz`、`pages/story-list`、`pages/wordbook`（功能已由
`exam-answer` + `exam-practice`、`read`、`word-list` + `dictionary-browse` 覆盖）。

## 3a. 2026-09-18 新增待办（AI 侧改动后必做）

今天改了 `cloudfunctions/ai/index.js` 三件事：① 显式关闭思考模式 ② 按 action 设 `max_tokens`
③ `AI_BASE_URL` / `AI_MODEL` / `AI_THINKING` 环境变量化 + 模型名更新为 `deepseek-flash`。
**改完不重新部署就等于没改。**

| # | 动作 | 验证标准 |
|---|---|---|
| 6 | **重新部署 `ai` 云函数**（IDE 右键 `cloudfunctions/ai` → 上传并部署，或 `npm run deploy:cf -- ai`） | 云函数列表 `ai` 的更新时间变化；AI 出题/短文仍能正常返回 |
| 7 | **真机验收正文渲染**：`pages/story-read` 与 `pages/article-read` 的目标词高亮、词间空格、折行 | 无粘连、无右溢出、无目标词后怪异换行（这是唯一一直没真机确认的改动） |
| 8 | 顺手确认云开发**计费模式**（控制台 → 套餐用量页）：旧「配额模式」20 万次/月 vs 新「资源点模式」≈ 200 万次/月，差 10 倍 | 认清当前用的是哪一套；注意切到资源点模式后**不可切回** |

> 部署后若 AI 变慢或质量下降，可临时把环境变量 `AI_THINKING` 设为 `enabled` 对比
> （但注意思维链会计入输出计费、且此时 `temperature` 不生效）。

## 3b. 仍未处理 / 后续排期

- **支付/订阅**：按约定跳过。2026-08-31 起**个人主体已可开通虚拟支付**（不必办个体户），
  但按商业化方案的节奏建议**排在最后** —— 先免费攒口碑 → 再用额度限制测转化 → 最后接支付。
  真正要动工时需新建 `payment` 云函数 + 商品页，前置条件是**服务类目含「工具」+ 已认证 + ICP 备案**
- **增量同步**：当前全量拉取 + 脏队列，数据量上来后改 `updated_at` 游标
- **深色模式**：✅ 已完成受控三档切换（09-18）。剩余：`tabBar` 深色做不到（微信限制，只能靠
  `darkmode`+`theme.json` 跟随系统，会破坏"设置浅色"→ 不开），深色下 tabBar 白底属已知瑕疵
- 🔴 **发音音频域名（上线阻塞项，务必在提审前解决）**：发音走 `https://dict.youdao.com/dictvoice`，
  属**第三方域名**。小程序后台配置合法域名需要往该域名根目录放校验文件 —— **我们无法操作有道服务器**，
  所以**开发版能响（开发者工具可勾"不校验合法域名"）、体验版/正式版必然失败**。
  推荐方案：新建 `tts` 云函数拉有道音频 → 转存云存储（按 word 缓存）→ 前端用
  `wx.cloud.downloadFile` 取本地临时路径再交给 `InnerAudioContext`（云存储是微信自家域名，
  无需配置合法域名；且本地路径可规避 iOS 直接播网络 URL 的坑）。
  涉及 `study.js` / `word-detail.js` / `dictionary-word-detail.js` 三处播放逻辑。
  **存储/配额已核算（2026-09-20 实测，见 `.workbuddy/tts_storage_estimate.cjs`）**：
  从词库均匀抽 60 词实测有道音频，均值 **13.29 KB**（中位 10.54 / P90 12.98）→ 4801 词全量缓存
  仅 **62 MB = 基础版 5GB 的 1.22%**，上传 4801 次占 0.8% → **空间完全不是问题**。
  ⚠️ **真正的瓶颈是每月配额**：无本地缓存时每次播放 = 1 云函数 + 1 下载 + 13KB CDN，
  而基础版云函数调用仅 **20 万次/月** → 约 **67 个重度用户(3000 次/月)即打满**
  （CDN 5GB/月 约对应 133 人）。
  → **实现时必须带前端本地文件缓存**：`FileSystemManager.saveFile` 持久化 + `word→本地路径`
  存 storage，做到"每个设备每个词只走一次云调用，重复播放 0 调用 0 流量"。
  备选：云函数直返 base64（零存储、零下载配额），代价是每次都真拉有道、延迟更高。
- **云函数超时验收**：`ai` 需 60s、`content` 20s、`seed` 60s（见上表第 3c 项）
- **提审**：类目/ICP、隐私指引、`project.private.config.json` 建议加入 `.gitignore`、`git tag v0.1.0` + CI 传体验版
