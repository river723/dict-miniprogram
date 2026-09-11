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
scripts/              数据导入脚本（数据源 ../memo-grad/src/data/*.json）
```

## 首次部署

1. 微信开发者工具导入本目录，`project.config.json` 中替换 `appid`，开通云开发
2. 云环境 ID 写在 `miniprogram/constants/index.js` 的 `CLOUD_ENV`（当前 `cloud1-d6gfdnelqf7478e85`），换环境改这一处即可
3. 建云数据库集合：`words`、`study_records`、`study_plans`、`wrong_questions`、`user_settings`（仅创建者可读写）；`worddict`（所有用户可读 + `prefix` 索引）；`content_files`（存「云存储路径 → fileID」映射，由 `upload-content` 写入，权限保持默认即可，云函数以服务端权限访问）
4. 部署全部云函数；`ai` 函数配置环境变量 `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_MODEL`）
5. 导入数据（本地执行，凭据为腾讯云 API 密钥）：

```bash
npm install
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=<云环境ID>
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/upload-content.mjs --env=<云环境ID>
```

导入幂等（worddict 按 `word_id` 去重），memo-grad 数据更新后重跑即可。

## CI 自动上传体验版

GitHub Secrets 配置 `MP_APPID`、`MP_PRIVATE_KEY`（小程序代码上传密钥），打 `v*` tag 自动经 miniprogram-ci 上传。
