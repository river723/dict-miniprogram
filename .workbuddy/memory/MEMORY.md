# MEMORY.md — 项目长期笔记

## 项目
考研英语生词 App 的**微信原生小程序版**（由 `E:\cc_study\memo-grad` RN+Expo 移植）。
原生 WXML/WXSS/JS + 微信云开发。Tab：学习/阅读/练习/我的。订阅与 Admin 后台不做。
Git `origin`→`https://github.com/river723/dict-miniprogram`，默认分支 **master**。

## 约定
- 1px(App)=2rpx；token 在 `miniprogram/theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MCI 子集化，码位重映射 **U+E000–U+E0A5**；**只能**用 `mci-subset.ttf` 渲染。
- 云函数：`ai`/`content`/`seed`/`contentseed`/`worddict`/`words`/`setup`/`tts`。
- `ai` 环境变量：`DEEPSEEK_API_KEY`(必填)、`AI_BASE_URL`、`AI_MODEL`(默认 `deepseek-flash`)、
  `AI_THINKING`(默认 disabled)。**换厂商＝改环境变量，不改代码**，改完须重新部署。
- 事件：自定义组件 `bind:tap`，原生 view `bindtap`。

## 主题（受控三档 light/dark/system）
- 深色变量是作用域类 `.mg-theme-dark`，由 `utils/theme.js#applyTheme` 挂到**页面根 view**
  （`class="mg-page {{themeClass}}"`，`onShow` 调 `applyTheme(this)`）。脚本 `.workbuddy/_theme_wire.cjs --apply`。
- **`page` 选择器也要声明变量**（原生弹窗/下拉刷新/越界区取 page 的值）；`.mg-page` 也要自带
  background。两者缺一 → 深色下拉刷新露白。
- ⚠️ **禁用 `@media (prefers-color-scheme: dark)`**：只看系统不看 App 设置 → 真机无条件命中深色，
  而开发者工具不模拟 → "工具正常、真机变深"（`app.json` 不开 darkmode 也中招）。
- tabBar 深色做不到（只能 `darkmode`+`theme.json` 跟随系统）→ 已知瑕疵。

## 假开关（已踩三次）
设置项有 UI、存进去了、**但没有消费者**（`theme`、`autoPlaySound`）。表现永远"已保存、无变化"。
**排查**：取 `DEFAULT_SETTINGS` 全部 key 全项目扫描 → 只出现在 `services/storage.js`
+ `pages/settings/*` 的即疑似（Windows 路径分隔符要先统一，否则过滤失效）。

## 发音（云函数 base64 中转）
- 第三方音频域名过不了小程序合法域名校验 → 走 `cloudfunctions/tts` 代拉 → base64 直返 →
  前端写 `USER_DATA_PATH/tts/` → `InnerAudioContext` 播本地。统一入口 `utils/tts.js#createTtsPlayer`。
- ⚠️ **有道不总是返回 MP3**（abandon=ID3/MP3，communism=RIFF/WAV）→ 云函数按 magic bytes
  嗅探 `ext`，前端按真实格式命名；一律 `.mp3` 会解码失败。
- **空间不是瓶颈，配额才是**：单次 ≈13KB；重度用户 3000 次/月 → **67 人**就把云函数调用
  （20 万/月）打满 → **必须本地文件缓存**（LRU 400 条 ≈5MB，上限 200MB）。
  估算脚本 `.workbuddy/tts_storage_estimate.cjs`。

## 文本渲染
- **切段高亮最终方案：整段单一文本流 + 嵌套 `<text>`**（消除元素边界才能真正保留空白）。
  `markWords` 返回 `[{text,hit}]`，**空格留在片段文本里**；外层 `.sr__en` 用 `display:block`。
  走过的错路：`space="nbsp"` / `pre-wrap` / 独立空格节点 / `inline-block` / `rich-text`(屏蔽事件)。
  **教训：反复修不好时怀疑结构，而不是继续调属性。**
- 外层一律 `<view>`，叶子用 `<text>`，不要 text 包 text；class 不留空串。
- `<text>` 坑：实体需加 **`decode`**；**`user-select` 会变 `inline-block`**；不要设 `display:block`。
- **构建函数返回字段要和 WXML `wx:if` 对齐**（`buildSegments` 漏返回 `en` → 英文永不渲染）。

## 白屏 / 生命周期
- **`storage.js` 同步异步混着**：`get*` **同步**不能 `.then`；`add*/update*/delete*/save*/pullAll/flushDirty` **async**。
- **「页面只剩导航栏」＝ `onLoad` 抛异常**。此类页面 `onLoad` 一律 `try/catch` 落可见错误态。
- `onShow` 早于首次渲染，里面抛异常会整页空白 → `applyTheme` 已全量 try/catch。

## 数据导入（零密钥路线）
- 内联数据 + 断点续跑：`npm run seed:build`→`seed/seed-data.js`→部署→设置页「①②③」；
  `npm run content:build`→`contentseed/content-data.js`→部署→「④⑤」。
- **内联数据必须是与 index.js 同级的 .js**（子目录不保证随包落地），该云函数目录要有 `package.json`。
- 默认超时 3 秒 → 批量须 timeBudget + 断点续跑；正式超时写 `config.json`，**靠部署同步**。
  timeout：`ai`120 / `contentseed`60 / `content`20 / `seed`60。
- 导入幂等：`uploadOne` 同 path 覆盖 + 先删同 path 索引 → **不必先「清空」**。
- 主包体积不受影响（故事只在云函数里，主包 635KB）。

## 系列故事（换故事集必读）
- 数据源 `../memo-grad/src/data/stories.json` → `build-content-data.mjs` → `contentseed/content-data.js`；
  运行时走 `content` 云函数 `storyList`/`storyDetail`。
- 字段：id:number / title,content,translation,theme,summary:string / words:array / word_count:number
  （**`summary` 是字符串不是数组**）。
- ⚠️ **换集必踩**：① `**` 粗体不剥离 → 满屏星号，清洗必须按 `3+连星 → 双星 → 单星` 顺序；
  ② `theme` 整套换，`THEME_LABELS` **散落三处**（`constants/index.js`、`read/read.js`、
  `story-read/story-read.js`）都要补；③ **`words` 可能是 `{w,...}[]`** → `String()` 变
  `"[object Object]"` → **整篇零高亮且不报错**（已在 `article.js#markWords` 加类型防御）。
- **`themeLabel` 三处回落必须一致**：`theme ? (THEME_LABELS[theme] || theme) : ''`。
  曾漏回落 → 中文题材被吞成空串（列表有徽标、详情没有）。**新数据 genre 是中文时透传即可**。
- 🌟 **段落对齐是硬约束**：前端 `buildBilingualPairs` 按 `\n\n` 切段后**按下标 1:1 配对**。
  ⭐ **最优切分规则（已内置 verify）**：英文用**单 `\n`** 分段、中文用 `\n\n`、两侧都过滤 `---`；
  verify 会把英文 `\n` 提升为 `\n\n` 写入输出。对比：都 `\n\n`→13/20，都 `\n+`→14/20，最优→15/20。
  ⚠️ 无法机械修复的一类：中文「每句对话一行」而英文整段合并 → **必须在生成端保证中英同步分段**。
- 工具：⭐`npm run stories:verify <in> [out]`（**总闸门**：自动识别 anthology/chapters → 清洗 →
  结构+渲染体检 → 通过才写出）；`stories:normalize`（洗星号）；`stories:adapt`（anthology→chapters，
  段落数不等即阻断）；`.workbuddy/_render_sim.mjs`（复刻渲染做端到端体检，**不能替代真机**）。
  规范与自检脚本见 `docs/故事数据对齐问题清单.md` —— **下次换故事集先给用户看该清单**。
- 三代基线：`星际漫游者` 0/20 ✓6291 → `南苑九十天` 3/20 ✗7914 → **`烟火故事集` 0/20 ✓5391（现网 2026-10-02）**。
- 当前线上：**《4801 词烟火故事集》**（20 篇独立短篇，中文题材名作 theme）。

## ⚠️「导入成功但界面还是旧内容」两条线分别取证（2026-10-02 / 10-08）
不要把锅只甩给缓存，必须分**写入侧**和**读取侧**：
1. **读取侧：tab 页不走 `onLoad`**。`read.js` 只在 `onLoad` 调 `loadStories()`，从设置页返回
   只触发 `onShow` → 列表永远旧。修：`read.js#onShow` 看标记刷（见下）。
   ⭐ **用户当场自愈办法：在阅读页下拉刷新**（`read.json` 已开 `enablePullDownRefresh`，
   `onPullDownRefresh` 本来就会重拉，不需要重新编译）。
2. **写入侧：同 cloudPath 上传很可能不替换内容**。`uploadOne` 若依赖「同 path 自动覆盖」，
   平台可能复用旧对象返回旧 fileID → **字节从未变**，日志却一切正常。
   已改为严格幂等：`deleteFile(旧 fileID) → remove(旧索引) → uploadFile(同 path) → add(新索引)`。
3. **自证钩子**（排查首选，别让用户数章数）：`contentseed#info()` 返回 `cloudStory`
   （云端真实 `series_title`/`total_chapters`/`first_title`）；`doImport()` 最后一轮也回读一次
   打进日志；`verify()` 返回 `label`。设置页显示「云端当前故事集」。

## 模块级缓存（读取侧长效修法）
`utils/story.js` 的 `indexCache`/`chapterCache` 从不失效 → 导入完旧的正文体还在。
修复：导出 `clearStoryCache()`；`seed.js` 导入/清空成功后 `markStoryDirty()`（清缓存 +
写 `mg_story_dirty`）；`read.js#onShow` 见标记则 `loadStories()`；
`read.js#onPullDownRefresh` 也 `clearStoryCache()`（否则详情页仍吃旧缓存）。

## Git / GitHub
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；`head/grep/sed/wc/xargs` 缺失。
- **推送失败先查代理（已踩三次）**：全局 `127.0.0.1:7890` 没开时仍走它 → `TLS connect error`。
  绕过：`git -c http.proxy= -c https.proxy= push origin master`。偶发 `Recv failure` 重试一两次即通。
  SSH 不可用（`~/.ssh` 无私钥）。

## 本机环境
- Bash 缺 `ls/mkdir/cat/grep/head/wc/sed/xargs` → 目录/文件操作走 Node `fs`。
- Python venv：`C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`。
- Node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
- 开发者工具 CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（IDE 须在运行）；
  其 `cloud` 子命令只有 `env`/`functions`，**没有 storage/database**。

## 校验脚本（`.workbuddy/`）
- `check_syntax.cjs`：JS/JSON/WXML/WXSS/页面四件套/图标码位（报告 `_check_report.json`）。
  ⚠️ **别用 `spawnSync(process.execPath,['--check',f])` 的 `status!==0` 判错**：本机 spawn 运行中
  node.exe 会 `EBUSY` → `status=null` → 全量误报。已改为 `checkSyntax()`：`status===1` 才取 stderr。
- `check_deps.cjs`（依赖解析）、`rebuild_tabbar.py`、`vendor_compare.cjs`、
  `tts_storage_estimate.cjs`、`_theme_wire.cjs`。
- 待补：`export default` 名 ↔ 文件内定义 的交叉校验并入 `check_syntax.cjs`。

## 商业化（完整推导见 `docs/商业化方案.md`）
- **AI 成本极低**：DS 2026-09-10 调价，实测加权 **0.32 分/次**，重度用户 ≈**¥0.3/月**。
  **云函数/存储别算进单用户成本**（套餐已含）。
- ⚠️ **思考模式默认开启**：思维链经 `reasoning_content` **照常计费**（只看单价会系统性低估），
  且**思考时 `temperature` 静默失效**。本项目 6 个 action 已显式关闭。
- **已按 action 设 `max_tokens`** + `finish_reason==='length'` 告警（不设时单次可到 ¥3.07）。
- **不换混元**（只省 33%）。TokenHub 转售比原厂贵 50%；聚合站价格别拿来做预算。
- **成本不均衡**：`definition_questions` 是 `analyze` 的 11 倍 → **点词/真题解析不限量**，
  限制集中在「AI 批量出题」，**别按次数一刀切限流**。
- **切分三轴**：量/深度/个性化。免费版＝完整闭环，付费卖"不限量+深度+个性化"，
  主推单一 SKU **考研全程卡 ¥98**。
- **虚拟支付** 2026-04-01 起全终端强制。**个人主体已可开（2026-08-31 起）**，"必须办个体户"**已作废**。
  条件：个人+大陆身份证 / 服务类目含「工具」/ 认证(¥30/年)+ICP 备案。限额 **10 万/月**；
  安卓 1% T+3、iOS 12% 45–60 天；本人储蓄卡；**只做道具直购、不引入代币**。逼近限额再升主体。
- **接入坑**：两套签名（`paySig`=AppKey、`signature`=sessionKey）；`post_body` 须与请求体一致；
  发货以**发货推送**为准（前端回调会丢），`query_order` 兜底 + `wx_order_id` 幂等；金额单位「分」。
- **节奏**：先免费攒口碑 → 额度限制测转化 → 最后接支付。**不要一上线就收费**。
