# MEMORY.md — 项目长期笔记

## 项目
考研英语生词 App 的**微信原生小程序版**（由 `E:\cc_study\memo-grad` RN+Expo 1:1 移植）。
原生小程序（WXML/WXSS/JS）+ 微信云开发。Tab：学习/阅读/练习/我的。订阅与 Admin 后台不做。

## 约定
- 1px(App) = 2rpx；设计 token 在 `miniprogram/theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MCI 子集化，码位重映射到 **U+E000–U+E0A5**（4 位转义才合法）；**只能用子集字体**
  `mci-subset.ttf` 渲染，用源字体会得到空字形。
- 云函数：`ai`(出题/短文/真题解析)、`content`、`seed`、`contentseed`、`worddict`、`words`、`setup`。
- `ai` 环境变量：`DEEPSEEK_API_KEY`(必填)、`AI_BASE_URL`(默认 api.deepseek.com)、
  `AI_MODEL`(默认 **`deepseek-flash`**)、`AI_THINKING`(默认 disabled)。
  **换厂商＝改环境变量，不改代码**（各家 OpenAI 兼容）。改完须重新部署。
- 事件：自定义组件 `bind:tap`，原生 view `bindtap`。

## 主题（受控三档 light/dark/system）
- 深色变量是作用域类 **`.mg-theme-dark`**（`theme/theme.wxss`），由 `utils/theme.js#applyTheme`
  按「设置档位 + `getSystemInfoSync().theme`」挂到**页面根 view**（`class="mg-page {{themeClass}}"`，
  `onShow` 调 `applyTheme(this)`）。批量接线脚本 `.workbuddy/_theme_wire.cjs --apply`。
- ⚠️ **禁用 `@media (prefers-color-scheme: dark)`**：它只看系统不看 App 设置 → 真机深色无条件命中
  → "设浅色却显示深色"，而开发者工具不模拟深色 → "工具正常、真机变深"（`app.json` 不开 darkmode 也中招）。
- **根 view 必须自带背景**（`.mg-page`）：深色变量挂在根 view，`page` 元素仍是浅底，没背景会露白。
- tabBar 深色做不到（微信只能 `darkmode`+`theme.json` 跟随系统，会破坏"设置浅色"）→ 已知瑕疵。

## 假开关（已踩三次，务必警惕）
设置项有 UI → `saveSettings` 存进去了 → **但没有消费者**。案例：`theme`(只存不读)、
`autoPlaySound`(`maybeAutoPlay()` 是空函数)。表现永远是"设置已保存、界面无变化"，工具里极难发现。
**排查**：取 `DEFAULT_SETTINGS` 全部 key → 全项目扫描 → **只出现在 `services/storage.js`
+ `pages/settings/*` 的即疑似假开关**（Windows 路径分隔符要先统一，否则过滤失效）。

## 发音（上线阻塞项）
- `study.js`/`word-detail.js`/`dictionary-word-detail.js` 三处走 `https://dict.youdao.com/dictvoice`。
  小程序音频需后台配合法域名，**第三方域名要往对方服务器放校验文件 → 做不到**
  → 开发版能响（工具可勾"不校验"），**体验版/正式版必然哑**。
- 方案：`tts` 云函数拉音频 → 转存云存储（按 word 缓存）→ `wx.cloud.downloadFile` 播本地临时文件。
- **存储占用实测（2026-09-20）**：从词库均匀抽 60 词，60/60 成功 —— 均值 **13.29 KB**、
  中位 10.54、P90 12.98、最大 135KB(communism)。4801 词全量缓存 ≈ **62 MB = 基础版 5GB 的 1.2%**
  （上传 4801 次，占 0.8%）→ **空间完全不是问题**。
- ⚠️ **真正的瓶颈是配额，不是空间**：无本地缓存时每次播放 = 1 次云函数 + 1 次下载 + 13KB CDN。
  基础版配额 CDN 5GB/月、下载 150 万次、**云函数调用 20 万次** → 重度用户(3000 次/月)
  约 **67 人**就把云函数调用打满。
  → **必须做前端本地文件缓存**（`FileSystemManager.saveFile` + word→path 存 storage），
  让每个设备每个词只走一次云调用，重复播放 0 调用 0 流量。
  估算脚本 `.workbuddy/tts_storage_estimate.cjs`（可 `--sample` 重新实测）。

## 文本渲染
- **切段高亮最终方案：整段单一文本流 + 嵌套 `<text>`**。
  > 核心原理：只要存在「多个并列元素」，元素边界空白必被折叠；唯一解法是消除元素边界。

  ```wxml
  <text wx:if="{{para.en}}" class="sr__en"><block wx:for="{{para.segs}}" wx:key="index"><text wx:if="{{item.hit}}" class="is-hit" data-word="{{item.text}}" bindtap="tapWord">{{item.text}}</text><block wx:else>{{item.text}}</block></block></text>
  ```
  `markWords` 返回 `[{text,hit}]`，**空格留在片段文本里**；`.sr__en` 用 `display:block`，
  高亮用后代选择器。已用于 `story-read.wxml`/`article-read.wxml`。
  走过的错路（别再走）：`space="nbsp"`(锁断点) / `white-space:pre-wrap`(渲染源码换行) /
  独立空格节点(微信折叠) / `inline-block`(行尾仍 collapse) / `rich-text`(屏蔽内部事件)。
  **教训：反复修不好时怀疑结构，而不是继续调属性。**
- 外层容器一律 `<view>`，叶子用 `<text>`，**不要 text 包 text**；class 不留空串。
- **`<text>` 不要设 `display:block`**（要块级就外套 `<view>`）。
- `<text>` 两个坑：实体(`&nbsp;`)默认不解析，须加 **`decode`**；**`user-select` 会把节点变
  `inline-block`** 影响折行。
- **构建函数返回字段要和 WXML 的 `wx:if` 对齐**：先打印字段值，再怀疑 CSS。
  案例：`buildSegments` 漏返回 `en` → `wx:if="{{para.en}}"` 恒假 → 英文原文永不渲染。
- 排查法：Node 脚本复刻结构 → 无头 Chrome 截图（`.workbuddy/_render_check.cjs`）；
  但**截图不能替代真机验证**。

## 白屏 / 生命周期
- **`storage.js` 同步异步混着**：`get*`(getWords/getSettings/getExamDraft/…) **同步**，不能 `.then`；
  `add*/update*/delete*/save*/pullAll/flushDirty` **async**。
  踩坑：`exam-answer.js` 写 `getSettings().then(...)` → TypeError 中断 `onLoad` → 整页只剩标题。
- **「页面只剩导航栏」＝ `onLoad` 中途抛异常**（数据为空会走 empty 分支并显示提示）。
  排查：① 找包住全页的 `ready`/`loaded` 开关 ② 顺 `onLoad` 找抛异常点。
  防御：这类页面 `onLoad` 一律 `try/catch` 落到**可见错误态**，绝不白屏。
- `onShow` 早于首次渲染，里面抛异常会整页空白 → `applyTheme` 已全量 try/catch。

## 数据导入（零密钥路线）
- 云函数内联数据 + 断点续跑：`npm run seed:build` → `seed/seed-data.js` → 部署 `seed` → 设置页「①②③」；
  `npm run content:build` → `contentseed/content-data.js` → 部署 → 「④⑤」。
- **内联数据必须是与 index.js 同级的 .js**（子目录不保证随包落地），且该云函数目录要有
  `package.json`（否则被上层 `"type":"module"` 当 ESM）。
- 云函数默认超时 3 秒 → 批量操作须自带 timeBudget + 断点续跑；正式超时写在 `config.json`，
  **靠部署同步**（IDE 右键上传要勾"同时更新函数配置"）。

| 函数 | timeout |
|---|---|
| `ai` | 120 |
| `contentseed` | 60 |
| `content` | 20 |
| `seed` | 60 |

## Git / GitHub
- `origin` → `https://github.com/river723/dict-miniprogram`（HTTPS），默认分支 **`master`**。
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；`head/grep/sed/wc/xargs` 缺失。
- **推送失败先查代理（已踩三次）**：全局配了 `127.0.0.1:7890`，代理没开时 git 仍走它 →
  `TLS connect error`。绕过即可：`git -c http.proxy= -c https.proxy= push origin master`。
  偶发 `Recv failure: Connection was aborted` 是瞬时抖动，**重试一两次就通**，别急着下结论。
  SSH 路线不可用（`~/.ssh` 无私钥）。

## 本机环境
- Bash 缺 `ls/mkdir/cat/grep/head/wc/sed/xargs` → 目录/文件操作走 Node `fs`。
- Python venv：`C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`。
- Node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
- 开发者工具 CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（IDE 须在运行）；
  其 `cloud` 子命令只有 `env`/`functions`，**没有 storage/database**。

## 校验脚本（`.workbuddy/`）
- `check_syntax.cjs`：JS/JSON/WXML/WXSS/页面四件套/图标码位（报告写 `_check_report.json`）。
- `check_deps.cjs`：依赖解析（wxs、import/include、usingComponents、app.json、require）。
- `rebuild_tabbar.py`：重建 tabBar PNG。`vendor_compare.cjs`：多厂商单价对比。
- `tts_storage_estimate.cjs`：发音音频存储/配额估算。`_theme_wire.cjs`：主题批量接线。
- 待补：`export default` 名 ↔ 文件内定义 的交叉校验并入 `check_syntax.cjs`。

## 商业化（完整推导见 `docs/商业化方案.md`，此处只留决策）
- **AI 成本极低**：DS 2026-09-10 调价（输出 ¥4/百万 + 峰谷 2×）。实测加权 **0.32 分/次**，
  重度用户 ≈ **¥0.3/月**。**云函数/存储别算进单用户成本**（套餐已含，边际成本 0）。
- ⚠️ **思考模式默认开启**：V4.1-Flash 默认 `effort=high`，思维链经 `reasoning_content` **照常计费**
  （只看单价会系统性低估）；且**思考时 `temperature` 静默失效**。本项目 6 个 action 已显式关闭。
- **已按 action 设 `max_tokens`** + `finish_reason==='length'` 告警（不设时单次可到 ¥3.07）。
- **不换混元**：Hy3 与 DS flash 闲时同价，只差峰谷 → 仅省 33%（¥0.11/月）。
  ① TokenHub 转售的 DeepSeek 比原厂贵 50%；② 聚合站价格别拿来做预算。
- **成本不均衡**：`definition_questions` 是 `analyze` 的 **11 倍**。
  → **点词/真题解析不限量**，限制集中在「AI 批量出题」；**别按次数一刀切限流**。
- **切分三轴**：量/深度/个性化。免费版 = 完整闭环，付费卖"不限量+深度+个性化"，
  主推单一 SKU **考研全程卡 ¥98**。
- **虚拟支付** 2026-04-01 起全终端强制。**个人主体已可开（2026-08-31 起）**，"必须办个体户"**已作废**。
  条件：个人+大陆身份证 / **服务类目含「工具」**/ 认证(¥30/年)+ICP 备案。限额 **10 万/月**；
  安卓 1% T+3、iOS 12% 45–60 天；本人储蓄卡；**只做道具直购、不引入代币**。逼近限额再升主体。
- **接入坑**：两套签名（`paySig`=AppKey、`signature`=sessionKey）；`post_body` 须与请求体一致；
  发货以**发货推送**为准（前端回调会丢），`query_order` 兜底 + `wx_order_id` 幂等；金额单位「分」。
- **节奏**：先免费攒口碑 → 额度限制测转化 → 最后接支付。**不要一上线就收费**。
