# 下一步行动清单（接手时状态 → 首个体验版）

更新：2026-09-11 · 对象：[memo-grad-miniprogram](../README.md) 0.1.0 · 云环境 `cloud1-d6gfdnelqf7478e85`

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

新增约定：**多了一个 `content_files` 集合**（云存储路径 → fileID 映射，权限保持默认，云函数以服务端权限访问）。

## 2. 你还要做的（GUI + 凭据）

| # | 动作 | 验证标准 |
|---|---|---|
| 1 | ~~开通云开发、填 appid~~ **已完成**（环境 `cloud1-d6gfdnelqf7478e85` 已写入代码） | — |
| 2 | 建 **7** 个集合：`words` `study_records` `study_plans` `wrong_questions` `user_settings`（仅创建者可读写）、`worddict`（所有用户可读 + `prefix` 索引）、`content_files`（默认权限即可） | 云控制台 7 个集合就位 |
| 3 | 部署 4 个云函数（右键 → 上传并部署：云端安装依赖）；`ai` 配环境变量 `DEEPSEEK_API_KEY`（沿用主仓 `.env` 的 key，模型 `deepseek-v4-flash`） | 4 项显示已部署 |
| 4 | `npm i` → `import-worddict.mjs --env=cloud1-d6gfdnelqf7478e85`（可先 `--limit=50` 试跑）→ `upload-content.mjs` | worddict 有 ~5000+ 条；`content_files` 有映射记录；存储有 content/exams、content/stories |
| 5 | 跑主链路：自动配词 → 卡片背诵 → 复习 → 统计 | 学习页出词、能打卡、统计有柱 |

```bash
npm install
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=cloud1-d6gfdnelqf7478e85 --limit=50
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/import-worddict.mjs --env=cloud1-d6gfdnelqf7478e85
TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node scripts/upload-content.mjs --env=cloud1-d6gfdnelqf7478e85
```

## 3. 仍未处理 / 后续排期

- **AI 短文能力没人用**：`cloudfunctions/ai/index.js` 有 `story`，前端零调用 → 在「练习」页补入口，或删掉
- **支付/订阅**：新建 `payment` 云函数 + 订阅页（若商业化，提审前必做，注意付费内容规范）
- **真题多题型**：原 App 有完形 / 阅读 / 新题型 / 翻译 / 写作，现只有单个 `exam-practice`
- **错题重练**：现有 `wrong-questions` 只有列表，缺「重做—移出」入口
- **统计详情**：`stats.js` 仅 21 行，缺下钻
- **增量同步**：当前全量拉取 + 脏队列，数据量上来后改 `updated_at` 游标
- **深色模式**：token 已具备，未做主题切换
- **提审**：类目/ICP、隐私指引、`project.private.config.json` 建议加入 `.gitignore`、`git tag v0.1.0` + CI 传体验版
