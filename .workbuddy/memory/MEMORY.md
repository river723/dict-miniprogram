# MEMORY.md — 项目长期笔记

## 项目
考研英语生词 App 的**微信原生小程序版**，由 `E:\cc_study\memo-grad`（RN + Expo）1:1 移植。
技术栈：原生小程序（WXML/WXSS/JS）+ 微信云开发（`wx.cloud`）。
Tab 结构：学习 / 阅读 / 练习 / 我的；订阅与 Admin 后台按用户决定**不做**。

## 约定
- 尺寸换算：App 的 1px = 小程序 2rpx；设计 token 在 `miniprogram/theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MaterialCommunityIcons 子集化，码位统一重映射到 BMP 私有区 **U+E000–U+E0A5**（4 位转义才合法）。
  渲染这些码位**只能用子集字体**（`mci-subset.ttf`），用源字体渲染会得到空字形。
- 云函数：`ai`（出题/短文/真题解析）、`content`（真题/故事分发）、`seed`（词库播种）、
  `contentseed`（真题/故事播种）、`worddict`、`words`、`setup`。
- `ai` 云函数环境变量：`DEEPSEEK_API_KEY`（必填）、`AI_BASE_URL`（默认 `api.deepseek.com`）、
  `AI_MODEL`（默认 **`deepseek-flash`**）、`AI_THINKING`（默认 `disabled`）；旧 `DEEPSEEK_MODEL` 仍兼容。
  **换厂商＝改这几个环境变量，不用改代码**（各家都是 OpenAI 兼容协议）。
  改完需重新部署云函数才生效。
- 自定义组件事件统一 `bind:tap`，原生 view 用 `bindtap`。
- **文本按关键词切段再拼回**：外层容器一律用 `<view>`，内层叶子用 `<text>`（`wx:for` 挂叶子 text 上），
  **不要 text 包 text**；class 不要留空串，样式写在与 class 同名的基类上（如 `.sr__seg`）。
- **`<text>` 一律不要设 `display:block`**；需要块级效果就外面套 `<view>`。
- **构建函数返回的对象字段要和 WXML 的 `wx:if` 对齐**：`wx:if="{{para.en}}"` 要求构建函数确实产出
  `en` 字段。排查"某块内容不显示"时，**先打印该字段的实际值，再怀疑 CSS/结构**。
  案例：`utils/story.js#buildSegments` 漏返回 `en` → `wx:if` 恒假 → 英文原文永不渲染。
- **文本切段高亮（最终方案：整段单一文本流 + 嵌套 text）**：
  > **核心原理：只要存在「多个并列元素」，元素边界的空白就一定会被折叠。
  > 唯一可靠的解法是消除元素边界 —— 整段用一个外层 `<text>`，
  > 内部用嵌套 `<text>` 做高亮，构成单一文本流。**

  标准写法（`story-read.wxml` / `article-read.wxml` 已采用）：
  ```wxml
  <text wx:if="{{para.en}}" class="sr__en"><block wx:for="{{para.segs}}" wx:key="index"><text wx:if="{{item.hit}}" class="is-hit" data-word="{{item.text}}" bindtap="tapWord">{{item.text}}</text><block wx:else>{{item.text}}</block></block></text>
  ```
  - 数据层 `markWords` 返回 `[{ text, hit }]`，**空格保留在片段文本里**（不剥离）。
  - WXSS：`.sr__en` / `.ar__en` = `display:block`；高亮用后代选择器 `.sr__en .is-hit`。
  - 官方支持 text 嵌套 text；嵌套的 text 可单独绑 `bindtap` 取词。

  走过的错路（**不要再走**）：
  - ~~`space="nbsp"`~~ → 锁断点 → 粘连 + 行填不满。
  - ~~`white-space: pre-wrap`~~ → 渲染 WXML 源码换行 → 向右溢出。
  - ~~独立空格节点（`spaceBefore`/`spaceAfter`）~~ → 微信里空格节点被折叠 / 实体不解析。
  - ~~`display: inline-block`~~ → 行尾空白仍 collapse，且排版变乱。
  - ~~`rich-text`~~ → **屏蔽内部所有节点事件**，无法点击取词。
  - **教训：同一问题反复修不好时，怀疑结构本身，而不是继续调属性。**

- **微信 `<text>` 两个必记的坑**：
  - 实体（`&nbsp;` 等）**默认不解析**，必须加 **`decode`** 属性，否则渲染成字面文本。
  - **`user-select` 会把文本节点变成 `inline-block`**，影响折行，非必要不加。

- **渲染问题排查方法论**：
  - 先用 Node 脚本复刻渲染结构生成 HTML，用**无头 Chrome 截图**看结构是否合理
    （`.workbuddy/_render_check.cjs`，可复用）。
  - 但**截图不能替代微信实机验证** —— 微信有自己一套空白/折行规则。

## 数据导入（零密钥路线）
- 云函数内联数据 + 断点续跑，避免依赖 secretId/secretKey。
  - `npm run seed:build` → `seed/seed-data.js`（词库）→ 部署 `seed` → 设置页「①②③」。
  - `npm run content:build` → `contentseed/content-data.js`（真题+故事 56 文件）→ 部署 `contentseed`
    → 设置页「④⑤」。
- **内联数据必须是与 index.js 同级的 .js**（子目录不保证随代码包落地），且该云函数目录要有
  `package.json`（否则被上层 `"type":"module"` 当 ESM，`module.exports` 无效）。
- 云函数默认超时 3 秒：批量操作必须自带 timeBudget + 断点续跑；正式超时在 `config.json` 里，
  且**要靠部署同步**（IDE 右键上传需勾选"同时更新函数配置"）。

## 云函数超时
| 函数 | config.json timeout |
|---|---|
| `ai` | 120 |
| `contentseed` | 60 |
| `content` | 20 |
| `seed` | 60 |

## Git / GitHub
- 远程：`origin` → `https://github.com/river723/dict-miniprogram`（HTTPS）。
- 默认分支：**`master`**（如需改 `main`：`git branch -m master main && git push -u origin main`）。
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；`head/grep/sed/wc/xargs` 缺失。

## 本机环境
- Bash 工具可用，但缺 `ls/mkdir/cat/grep/head/wc/sed/xargs` → 目录/文件操作走 Node `fs`。
- Python venv：`C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（Pillow、fonttools）。
- Node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
- 开发者工具 CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（须 IDE 在运行）。
  其 `cloud` 子命令只有 `env`/`functions`，**没有 storage/database**。

## 校验脚本（`.workbuddy/`）
- `check_syntax.cjs`：JS 语法 / JSON / WXML `{{}}` / WXSS `{}` / 页面四件套 / 图标码位等。
- `check_deps.cjs`：依赖解析（wxs、import/include、usingComponents、app.json、JS require/import）。
- `rebuild_tabbar.py`：重建 tabBar 8 张 PNG（读 icons.js 码位 + 子集字体 + 补 sRGB 块）。
- 已知待补：把「`export default` 名 ↔ 文件内定义」交叉校验并入 `check_syntax.cjs`。

## 商业化（方案见 `docs/商业化方案.md`）
- **成本仍极低，但单价已变（2026-09-18 复算）**：DeepSeek 于 **2026-09-10 12:00** 调价 ——
  输出由 ¥2 上调到 **¥4/百万 token**，并启用**峰谷计费**（高峰＝工作日 9-12 / 14-18，全部 2 倍）。
  模型 `deepseek-v4-flash` 已被 **V4.1-Flash**（新名 `deepseek-flash`）取代，旧名靠兼容仍可用。
  → 实测加权平均 **0.32 分/次**（含峰谷，按解析 60%/短文 15%/出题 20%/真题 5% 的使用结构），
  重度用户月边际成本 ≈ **¥0.3**（100 次）。**云函数/存储不要算进单用户成本** ——
  ¥19.9 套餐已含 20 万次调用 + 2GB + 10 万 GBs，配额内边际成本为 0（上一版重复计算过）。
  → **精力应花在内容与转化，不是省成本**。
- **⚠️ 思考模式默认开启（2026-09-18 发现，最易被忽略的成本项）**：
  DeepSeek V4.1-Flash **默认开启思考、`effort` 默认 `high`**，思维链经 `reasoning_content` 返回并
  **照常计入输出计费** —— 只看「输入/输出单价」做的估算会**系统性低估**。
  且**思考模式下 `temperature` 不生效**（传了不报错、静默忽略）。
  本项目 6 个 action 全是「给定输入→固定格式输出」，**已显式关闭**
  （`thinking:{type:'disabled'}`，环境变量 `AI_THINKING` 可覆盖）。换厂商/升级模型时必须重查该默认值。
- **输出上限**：已按 action 设 `max_tokens`（analyze 900 / story 1400 / quiz 3000 /
  cloze 5000 / definition 7000 / 真题解析 500，= 实测输出 ×2.6–3.6 余量）+ 截断告警
  （`finish_reason==='length'`）。**不设上限时单次跑满可到 ¥3.07**，是最典型的账单失控口子。
- **不换腾讯混元（2026-09-18 核价）**：混元 Hy3（¥1/¥4）与 DeepSeek flash **闲时完全同价**，
  只差峰谷（混元无峰谷）→ 本项目仅省 33%（0.32 → 0.213 分/次，即重度用户 **¥0.11/月**）。
  **不值得为省钱而换**；保留「随时能换」的能力即可（`AI_BASE_URL`/`AI_MODEL` 已环境变量化）。
  两个反直觉点：①**腾讯云 TokenHub 转售的 DeepSeek 比原厂贵**（闲时 ¥1.54/¥4.62 vs ¥1/¥4）；
  ②聚合站在传的「TurboS ¥0.8/¥2」**在 TokenHub 官方表已无此模型** —— **别用聚合站数字做预算**。
  横向对比脚本：`.workbuddy/vendor_compare.cjs`。
- **成本极度不均衡（设计额度时必须分层）**：`definition_questions`(15 词) ¥0.0153/次
  是 `analyze` ¥0.0014/次 的 **11 倍**；`cloze_questions` ¥0.011、`quiz` ¥0.0062、
  `story` ¥0.0026、`real_exam_explanation` ¥0.0008。
  → **点词解析 + 真题解析应不限量**（成本可忽略、且是核心闭环）；
  额度限制集中在**「AI 批量出题」**上 —— 恰好对应「量」这条轴，省钱与商业逻辑一致。
  **不要统一按次数一刀切限流**（既劝退用户又没省到钱）。
- **切分三轴**：量 / 深度 / 个性化。免费版 = 完整闭环（背词、真题、基础解析**永久免费**），
  付费卖"不限量 + 深度 + 个性化"。主推单一 SKU：**考研全程卡 ¥98**。
- **微信虚拟支付（2026-04-01 起全终端强制）**：iOS/安卓/鸿蒙的虚拟交易必须走虚拟支付，
  禁止普通支付或站外跳转。
- **个人主体已可开虚拟支付（2026-08-31 起，官方文档「虚拟支付：个人」）** —— 这是重要更正，
  此前"必须办个体户"的结论**已作废**。硬条件只有三条：
  1. 主体为个人、持大陆居民身份证
  2. **服务类目含「工具」**（没有工具类目则后台看不到入口）
  3. 已完成认证（个人约 ¥30/年）+ ICP 备案
  限额 **10 万元/月**（全终端合计，≈1020 张 ¥98 全程卡）；安卓 1% / T+3，
  iOS 12%（Apple）/ 45–60 天；个人用**本人储蓄卡**结算（非对公）；
  商品形态官方限定**只做「道具直购」，不引入代币**（所以没有"代币比例不可改"的坑）；
  审核约 **5 分钟**出结果。
  → 本项目形态是**学习工具**，选「工具」类目是如实描述，不必办个体户；
  **规模化（逼近 10 万/月）时再升主体**。
- **官方文档有「Agent 自动接入」三种方式，方式一即"使用微信云开发快速接入"** ——
  本项目正好跑在微信云开发上，是接入成本最低的路线。
  接入坑：两套签名（`paySig` 用 AppKey、`signature` 用 sessionKey）；
  `post_body` 必须与请求体完全一致；发货以**发货推送**为准（前端 success 回调会丢），
  用 `query_order` 定时兜底 + `wx_order_id` 幂等；金额单位是「分」，`env` 固定 0。
- **节奏**：先做免费版攒口碑 → 再用额度限制测转化意愿 → 最后接支付。**不要一上线就收费**。
  （主体门槛消失后，阶段二/三可以更早启动，但顺序不变。）
