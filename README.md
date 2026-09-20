# memo-grad-miniprogram

考研英语生词学习微信小程序（memo-grad 的小程序版）。原生小程序（WXML/WXSS/JS）+ 微信云开发，在线版。

业务逻辑、设计 token、数据资源均来自主仓库 [memo-grad](../memo-grad)，详细约定见其 `DEVELOPMENT_GUIDE.md`「微信小程序版」章节。

## 功能

- 学习：自动配词（考频+日期种子洗牌）、卡片背诵、艾宾浩斯复习（正确率≥0.8 升档 / 回落 1 天）
- 词库：生词本管理、词库查询（按字母前缀）、AI 解析（DeepSeek：翻译/熟词僻义/词根/记忆）
- 练习：AI 出题、错题本（做对 3 次自动移出）、真题套卷、故事阅读
- 我的：统计（近 7 天柱状图、掌握度）、设置、云同步

## 目录

```
miniprogram/          小程序端
  services/           storage(写穿缓存)/studyPlan(艾宾浩斯)/autoWord/worddict/cloud
  theme/              设计 token（镜像自 memo-grad src/theme/tokens.ts）
cloudfunctions/       words(用户数据) / worddict(词库) / ai(DeepSeek 代理) / content(真题故事)
                      setup(建集合+统计) / seed(内置词库数据，一键播种)
scripts/              数据打包/导入脚本（数据源 ../memo-grad/src/data/*.json）
```

## 首次部署

1. 微信开发者工具导入本目录，`project.config.json` 中替换 `appid`，开通云开发
2. 云环境 ID 写在 `miniprogram/constants/index.js` 的 `CLOUD_ENV`（当前 `cloud1-d6gfdnelqf7478e85`），换环境改这一处即可
3. 建集合：**不用手动点**。部署 `setup` 云函数后右键 →「云端测试」，参数 `{"action":"ensureCollections"}` 一键建齐
   7 个集合（`words`、`study_records`、`study_plans`、`wrong_questions`、`user_settings`、`worddict`、`content_files`）；
   再用 `{"action":"stats"}` 看各集合条数。缺点是统一为默认权限（仅创建者可读写），
   因为所有读写都走云函数服务端权限，功能不受影响；想给 `worddict` 配 `prefix` 索引再去控制台加。
4. 部署云函数，两种方式任选：

   **方式一 · 命令行一键部署**（需先在 IDE 里打开「设置 → 安全设置 → 服务端口」，只需一次）

   ```bash
   npm run deploy:cf            # 部署 cloudfunctions/ 下全部云函数
   npm run deploy:cf -- seed    # 只部署某一个
   npm run deploy:cf -- --list  # 看云端已有哪些云函数
   ```

   环境 ID 自动从 `miniprogram/constants/index.js` 的 `CLOUD_ENV` 读取，换环境不用改脚本。
   脚本会自动发现 IDE 的服务端口（**不要**硬写 `--port 3799`，IDE 每次启动端口是随机的）；
   首次部署若报 `当前函数处于Creating状态`，是「刚创建完立刻传代码」的竞态，脚本会自动等待重试。
   报 `FUNCTION_NOT_FOUND / -501000` 一律是「还没部署成功」，不是代码问题。

   **方式二 · IDE 手动部署**：`cloudfunctions/` 下每个目录右键 →「上传并部署：云端安装依赖」，
   8 个都要（`words` `worddict` `content` `contentseed` `ai` `setup` `seed` `tts`）。
   其中 `contentseed` 只在灌真题/故事时需要，`tts` 供单词发音中转（见下）。

   > ⚠️ **云函数默认执行超时只有 3 秒**（IDE/CLI 创建函数时的默认值），超过就报
   > `-504003 Invoking task timed out after 3 seconds`。命令行的 deploy 没有超时参数，
   > 各目录里的 `config.json`（`{"timeout": 60}`）CLI 也不吃 —— **要改只能去云开发控制台**：
   > 云函数 → 选函数 → 配置 → 超时时间（最大 60 秒）。建议值：`ai` 60s（调大模型最慢）、
   > `content` 20s（要下载云存储文件）、`seed` 60s、其余 20s。
   > 不改进代码也能跑：`seed` 的导入/去重/清空全部做成了「时间预算内干一段、返回断点、页面自动续跑」。

   然后给 `ai` 函数配环境变量 `DEEPSEEK_API_KEY`（可选：`AI_MODEL` 模型名，默认
   `deepseek-flash`；`AI_BASE_URL` 换厂商；`AI_THINKING` 思考模式，默认 `disabled`）
5. 灌词库 —— **推荐方式：零密钥、点在板上**

   `seed` 云函数把 4801 条词库随代码一起带上云端（`seed-data.js` 内联 gzip+base64，约 1.4MB；
   另有 `data/part-*.json.gz` 分片作后备），部署后在小程序里
   **我的 → 设置 → 数据初始化**，依次点「① 建集合」「② 一键导入词库」即可，带进度条和日志。
   内部是「20 并发写入 + 12s 时间预算 + 断点续跑」，撞到云函数超时会自动续下一轮，不用管。
   **导入是幂等的**：写入前先读云端已有的 `word_id` 并跳过，重复点「②」、或中断后重跑都不会插出重复数据。

   如果「云端」条数比数据源多（说明历史上有过重复写入），点「**③ 清理重复**」：先出体检报告
   （总条数 / 去重后条数 / 重复组数 / 多余条数），确认后删掉多余副本，每个 `word_id` 保留最早一条。
   报告里若出现「不在内置词库中」的条数，那些文档不会被删，需要人工判断。

   > ⚠️ 为什么数据要内联成根目录的 `.js`：曾经遇到云端跑起来报
   > `ENOENT: no such file or directory, scandir '/var/user/data'` —— 云端包里明明有 `data/`，
   > 但运行时目录里没有（子目录没随代码包落地）。改成与 `index.js` 同级的模块后就稳了。
   > 加载顺序：`seed-data.js` → `data/` 分片 → 根目录被拍平的分片。
   > 还报错的话跑 `{"action":"diag"}`（云端测试），它会打印 `__dirname` 和实际目录内容。

   > ⚠️ 报 `FUNCTION_NOT_FOUND / -501000` = seed 还没部署上去。用 `npm run deploy:cf -- seed`，
   > 或在开发者工具里右键 `cloudfunctions/seed` **目录** →「上传并部署：云端安装依赖」。

   <details><summary>seed 实在部署不上去时的兜底（控制台一次导入）</summary>

   控制台导入单文件上限 50MB，4801 条才 3.6MB，所以**不用拆 26 个**：

   ```bash
   npm run export:single     # 生成 import-data/worddict-all.json（3.59MB）
   ```

   云开发控制台 → 数据库 → `worddict` → 导入 → 选这个文件 → 冲突处理选 **Insert**。一次搞定。
   </details>

   换数据源时重新打包：

   ```bash
   npm run seed:build     # 重生成 cloudfunctions/seed/seed-data.js + data/，之后重新部署 seed
   ```

   也支持云端直接调用（开发者工具 `seed` 右键 →「云端测试」）：

   ```jsonc
   {"action":"info"}                 // 数据源类型 / 共几条 / 云端已有多少
   {"action":"diag"}                 // 环境自证：__dirname、有无 seed-data.js、目录实况
   {"action":"ensureCollections"}    // 幂等建齐集合
   {"action":"importWorddict","from":0,"timeBudgetMs":2200}  // 返回 done/next，幂等
   {"action":"dedupeWorddict"}                 // 去重体检（不删，只出报告）
   {"action":"dedupeWorddict","confirm":true}  // 真删多余副本
   {"action":"clearWorddict","confirm":true}   // 清空（受时间预算限制，返回 done/left 可续跑）
   ```

<details><summary>备选：本地脚本（需要腾讯云密钥）</summary>

```bash
npm install
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=<云环境ID>
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/upload-content.mjs --env=<云环境ID>
```

导入幂等（worddict 按 `word_id` 去重），memo-grad 数据更新后重跑即可。
页面看不到内容时跑数据体检：`TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx npm run check:data -- --env=<云环境ID>`。

没有密钥时也可 `npm run export:jsonl` 生成 26 个 JSON Lines 文件到 `import-data/`，在控制台逐个点「导入」。
</details>

> 真题+故事（`upload-content`）要写云存储，**只能走脚本那条路**，控制台没法批量传。
>
> 导入完请**重新部署 `worddict` 云函数**并彻底关闭小程序再进一次。

## 两个必须记住的平台约束

| 约束 | 踩坑表现 | 本项目的做法 |
|---|---|---|
| 云函数默认执行超时 **3 秒**（IDE/CLI 创建函数时的默认值） | 批量操作报 `-504003 Invoking task timed out after 3 seconds`；`config.json` 里的 `timeout` CLI 不生效，`cli cloud functions deploy` 也没有超时参数 | 长操作全改成「时间预算内干一段 → 返回 `done`/`next`/`left` → 页面自动续跑」：`importWorddict`、`dedupeWorddict`、`clearWorddict`。想真正提速得去**云开发控制台 → 云函数 → 配置 → 超时时间**调大（`ai` 至少要 20s，否则调大模型必超时） |
| 小程序链路单次响应包体上限 **1MB**（云函数↔数据库侧是 6MB/50MB，但回传给小程序只有 1MB） | `EXCEED_MAX_RESPONSE_SIZE` | 绝不把词库整包回传：`worddict` 的 `all` 仅留作云端测试用（超过 1MB 会直接返回明确错误），自动配词改走**服务端 `pick`**，只回传选中的 10 条（约 4KB） |
| 网络音频/图片的域名必须在后台配「合法域名」，第三方域名要往**对方服务器**放校验文件 | 直接播 `dict.youdao.com` 时**开发版能响、体验版/正式版必然没声音**（开发者工具可勾"不校验合法域名"掩盖了这个问题） | 发音改走 `tts` 云函数代拉 → base64 返回 → 前端写本地文件再播（单文件约 17.7KB，远低于 1MB 上限）；配套本地 LRU 缓存，做到每个设备每个词只调一次云函数 |

## CI 自动上传体验版

GitHub Secrets 配置 `MP_APPID`、`MP_PRIVATE_KEY`（小程序代码上传密钥），打 `v*` tag 自动经 miniprogram-ci 上传。
