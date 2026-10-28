# MEMORY.md — 项目长期笔记（精简版，控制在 ~6K）

> 长流程细节见 `docs/词库数据管线.md`（eudic/ECDICT/考频重标/故事对齐）。

## 项目
考研英语生词 App 的**微信原生小程序版**（由 `E:\cc_study\memo-grad` RN+Expo 移植）。
原生 WXML/WXSS/JS + 微信云开发。Tab：学习/阅读/练习/我的。订阅与 Admin 不做。
Git `origin`→`https://github.com/river723/dict-miniprogram`，默认分支 **master**。

## 通用约定
- 1px(App)=2rpx；token 在 `theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MCI 子集化，码位重映射 **U+E000–U+E0A5**；只能用 `mci-subset.ttf`。
- 云函数：`ai`/`content`/`seed`/`contentseed`/`worddict`/`words`/`setup`/`tts`。
- `ai` 环境变量：`DEEPSEEK_API_KEY`(必填)、`AI_BASE_URL`、`AI_MODEL`(默认 deepseek-flash)、
  `AI_THINKING`(默认 disabled)。**换厂商＝改环境变量不改代码**，改完须重部署。
- 事件：自定义组件 `bind:tap`，原生 view `bindtap`。

## ⚠️ 五条通用教训（最高价值，踩过多次）
1. **「云端更全」不能用数量判据** —— 数量相近必然误判（4801 vs 4491）。要让服务端回传
   **它实际查的集合名**（`col`），前端校验身份。且 `try/catch` 只兜抛错，
   「成功返回错误数据」（`staleCloud`）必须**显式判 + throw**。
2. **加了云端特性就必须同步「旧云函数仍在线」这一路** —— 本项目多次 bug 都来自
   「代码改了、云函数没重部署」。
3. **反复修不好时怀疑结构，而不是继续调属性**。
4. **鉴权只能在云函数做**：前端传什么都不可信（本地存储可改、可抓包）。
   小程序身份**已免费具备** —— `cloud.getWXContext().OPENID` 由平台自动注入、不可伪造。
   缺的从来不是「登录/认证」，而是**授权/角色**（「这个 OPENID 是不是管理员」）。
   ⚠ 做「登录功能」（手机号/密码/自建账号）是过度设计：session/找回/过审/隐私政策全要。
5. **`setData` 是异步的** → `this.data` 不能当同步重入锁；用实例标志（`this._saving`）。

## ⚠️ 安全：数据初始化必须限管理员（2026-10-28 梳理，尚未修）
- `pages/settings/settings.wxml:172` 「词库初始化」→ `settings.js#goSeed` **零判断**，
  任何用户可见可进 `pages/seed/seed`。
- **`seed`/`contentseed`/`setup` 云函数零鉴权**（无 `getWXContext()`、无角色判断）。
- 操作对象是**全站共享集合** `worddict`(4801)/`worddict_ielts`(4491)/`content_files`。
- ⇒ 任意用户点「清空重导」→ `clearWorddict` → **删光全站词库**；「清空内容」→ 删光故事/真题。
- 对照：设置页「清除所有数据」`clearAll` **是安全的**（只删自己 `_openid` 隔离的数据）。
  问题**只**在「数据初始化」。
- **修法**：①云函数入口取 `OPENID` 比对白名单，不中即 `return {ok:false,error:'FORBIDDEN'}`
  （一行都不执行）；②前端取 `isAdmin` 隐藏入口 + seed 页 `onShow` 兜底校验。
- 白名单 3 选 1：写死常量 / 环境变量 / **`admins` 集合**（最灵活，
  但集合权限须**仅管理员可写**，否则用户能自己把自己加进白名单 ⚠）。
- 顺带发现：**`ai` 云函数无 openid 限流**（谁都能无限刷 AI 额度）；
  `docs/商业化方案.md` 已把「额度按 openid 计」列为待做项。
  盘点：仅 `words` 有身份识别（`getWXContext().OPENID`），其余 7 个云函数全无身份、全部无限流。

## 主题（受控三档 light/dark/system）
- 深色是作用域类 `.mg-theme-dark`，`utils/theme.js#applyTheme` 挂到**页面根 view**
  （`class="mg-page {{themeClass}}"`，`onShow` 调 `applyTheme(this)`）。脚本 `.workbuddy/_theme_wire.cjs --apply`。
- **`page` 选择器也要声明变量**（原生弹窗/下拉刷新/越界区取 page 的值）；`.mg-page` 自带 background。
- ⚠ **禁用 `@media (prefers-color-scheme: dark)`**：真机无条件命中深色而开发者工具不模拟 →
  "工具正常、真机变深"。tabBar 深色做不到 → 已知瑕疵。

## 假开关（已踩三次）
设置项有 UI、存进去了、**但没有消费者**（`theme`、`autoPlaySound`）。
排查：取 `DEFAULT_SETTINGS` 全部 key 全项目扫描，只出现在 `services/storage.js` + `pages/settings/*`
的即疑似（Windows 路径分隔符先统一）。

## 发音（云函数 base64 中转）
- 第三方音频域名过不了合法域名校验 → `cloudfunctions/tts` 代拉 → base64 直返 →
  前端写 `USER_DATA_PATH/tts/` → `InnerAudioContext` 播本地。入口 `utils/tts.js#createTtsPlayer`。
- ⚠ 有道不总返回 MP3（abandon=ID3/MP3，communism=RIFF/WAV）→ 云函数按 magic bytes 嗅探 `ext`。
- **空间不是瓶颈，配额才是**：单次≈13KB；3000 次/月 × 67 人就打满 20 万/月调用 →
  **必须本地 LRU 缓存**（400 条≈5MB）。估算 `.workbuddy/tts_storage_estimate.cjs`。

## 文本渲染
- **切段高亮：整段单一文本流 + 嵌套 `<text>`**（消除元素边界才能保留空白）。
  `markWords` 返回 `[{text,hit}]`，**空格留在片段文本里**；外层 `.sr__en` 用 `display:block`。
  错路：space="nbsp" / pre-wrap / 独立空格节点 / inline-block / rich-text(屏蔽事件)。
- 外层一律 `<view>`，叶子用 `<text>`，不要 text 包 text；class 不留空串。
- `<text>`：实体需 **`decode`**；**`user-select` 会变 inline-block**；不要 `display:block`。
- **构建函数返回字段要和 WXML `wx:if` 对齐**（漏返回字段 → 永不渲染）。

## 白屏 / 生命周期
- `storage.js` 同步异步混着：`get*` **同步**不能 `.then`；写类 **async**。
- **「页面只剩导航栏」＝ `onLoad` 抛异常** → 这类页面 `onLoad` 一律 try/catch 落可见错误态。
- `onShow` 早于首次渲染，里面抛异常会整页空白 → `applyTheme` 已全量 try/catch。

## 词库体系（换词库/加词库必读）
- `all`＝云端考研词库 4801 词；`ielts`＝雅思 4491 词，**两层数据**：
  ① 云端富词条 `worddict_ielts`；② 内置基础词条 `data/libraries/ielts.js`（423KB，主包内，离线兜底）。
- **统一入口（新增词库只改这两处）**：
  - `services/libraries.js`：`LIBRARIES` + `getLibraryWords/getLibraryEntries/getLibraryEntry`（小写索引 O(1)）。
  - `services/wordEnrich.js`：L1 本地(同步) → L2 云端富词条；`enrichSync/enrichCloud/enrichOne/enrichBatch`；
    **双 Map 缓存**（one/cloud 分开，防 L1 简明结果挡住 L2 富结果）。
    详情页标准姿势：`enrichSync` 即时上屏 → `enrichCloud` 到达后无缝升级。
    `fromCloudEntry` 已 export（音标字段两集合不同名：雅思 `phonetic_uk`，考研无音标字段）。
- **浏览页禁半云端半本地混排**：`ensureLocalCloudDecision` 一次性决定数据源；
  云端单次失败只回落**本轮**（`cloudBatch` 必须同步置回 false）。
- **集合身份校验（2026-10-20 修）**：`worddict` 云函数所有 return 加 `col: COL`；
  `services/worddict.js` 导出 `CLOUD_COLLECTION` + `staleCloud`；页面校验 `col` 不符即回落本地。
  回归 `.workbuddy/_smoke_find.cjs`（30 项）。
- **toRow 不许伪造缺省值**：`rawDiff||3`+`pad5(0)` 会返回非空串 `☆☆☆☆☆`，让「字段缺失」看起来
  像真实考频。缺值输出空串，WXML 自然不渲染。筛选前必须先经 `toRow` 归一。
- **云端总数要单独取**：`countWorddict` 返回 `{total, col}`；云端分支曾永远显示 `?`（2026-10-27 修）。

**雅思富词条管线**：`npm run gen:ielts-rich`（① 复用考研 2758 词零成本 `--reuse-only`；
② 1733 词调 DeepSeek，约 ¥2.36/11 分钟）→ `import-data/worddict-ielts.jsonl` →
`npm run import:ielts -- --env=<ID>`（幂等，需 TCB 密钥）→ **重部署 worddict** + 建 `prefix` 索引。
- **⚠️ 字段来源必须分离（2026-10-20 用户拍板，勿改回整条搬运）**：
  - 可复用（考研侧）：`definitions`/`etymology`/`similar_words`/`memory_tip`（实测复用率 100%）
  - 必须雅思自己的：`frequency`/`difficulty`（web 语料 + AWL 重标口径）、`phonetic_uk`
  - **为什么**：两库难度差 ≥2 星的有 **773/2753 词（28%）**；整条搬运会覆盖真实语料口径。
    实测产物 f/k 与考研不同占 89% —— 这正是"没被污染"的证据，已写成回归断言。
  - `gen-ielts-rich.mjs#toDoc` **只从 rich 取内容字段**，f/k/音标强制走 `ieltsMetrics`/`phOf`；
    AI prompt 移除了 `frequency`/`difficulty`（模型凭记忆拍的数字不可信）。
    新增 `--rebuild` 开关（改口径后必须用它丢弃旧产物）。
  - 产物体检：`.workbuddy/_smoke_ielts_rich.cjs`（23 项）——含"f/k 与雅思重标一致""释义复用率 ≥95%"
    "f/k 未被考研覆盖（差异率 >50%）"三条反向断言。
- **⚠️ 例句含词校验别写太严**：只剥 `-s/-ed/-ing` 误报 **75 条**；
  加「词干编辑距离 ≤1」降到 13 条（bind→bound/cling→clung 等不规则动词）；
  再补 `IRREGULAR` 显式表 + 前缀构词（overtake→overtook、sculpture→sculpting、weave→wove）才归零。
  `ai` 云函数有 `define` action 但**在线按需查词未接入**（属产品决策）。
- **⚠️ 自动配词写生词本必须搬 `definitions`**（2026-10-27 修）：`autoWord.js#enrichCandidate`
  只搬 etymology/memory_tip/similar_words/pronunciation → **漏 `definitions`**，
  雅思候选是客户端裸 `{word}` 字符串（考研候选来自云端 `pick` 自带 definitions），
  故只有雅思词进生词本后卡片背面无中文释义。修法：云端富词条取结构化 definitions，
  云端未命中回落本地 `d` 串；再加一次性回填 `enrichWordbookDefinitionsOnce`（flag `wordbookDefsV1`）。
- **数据现状**：雅思本地 4491（音标已全补齐）；云端 jsonl 仅 2758（未上云）；
  考研云端 4801 **音标 0 条**；交集 2758 / 雅思独有 1733 / 考研独有 2043。

## ⚠️ 密钥绝不入库（2026-10-28 踩到，GitHub secret scanning 直接拒绝推送）
- 排障时把真实腾讯云 SecretId 写进了 `.workbuddy/memory/2026-10-27.md`，
  `git push` 被远端拒绝：`repository rule violations` + secret scanning 拦截链接。
- **SecretId（AKID 开头）本身就是敏感凭证**，「只有 ID 没有 Key 危害小」是错觉 →
  一样会被扫描器判定。**写日志只写「已能 echo 出来」，绝不写值本身。**
- 排查手法：`git grep -I -n -E "AKID[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,}" $(git rev-list --all) --`
  一次扫全历史（含远端分支）。已用它确认当时**只有 1 处、且仅在未推送的提交里**
  → 只需脱敏当前文件，**不用重写 git 历史**。
- `.workbuddy/memory/` **是要入库的**（项目记忆靠 git 同步给后续会话），
  不是本地临时目录 → 往里写东西前先想「这段会不会进公库」。

## 数据导入（零密钥路线）
- 内联数据 + 断点续跑：`npm run seed:build`→`seed/seed-data.js`→部署→设置页「①②③」；
  `npm run content:build`→`contentseed/content-data.js`→「④⑤」。
- **内联数据必须是与 index.js 同级的 .js**，该云函数目录要有 `package.json`。
- 默认超时 3 秒 → 批量须 timeBudget + 断点续跑；正式超时写 `config.json`（靠部署同步）。
  timeout：`ai`120 / `contentseed`60 / `content`20 / `seed`20以上、`worddict`20。
- 导入幂等：先删同 path 索引再上传 → **不必先「清空」**。主包体积不受影响。
- **⚠️ TCB 密钥路线在本项目从未跑通**（cloud1- 不认普通 CAM 密钥 → INVALID_CREDENTIALS）；
  控制台导入要求「**`.json` 扩展名 + JSON Lines 内容**」（纯数组会被拒）；
  `prefix` 是首字母、必须建**非唯一**索引；控制台导入是**追加**模式（重复导 → 13473 条 = 4491×3）。
- ✅ **13473 重复已解决**（2026-10-28）：删集合 + 用带 `_id` 的
  `import-data/worddict-ielts-console.json` 重导（4491 行、每条 `_id`=word_id、唯一无重复）
  → upsert 语义，再点几次也不会插重。
  ⚠ **删集合会连带删掉 prefix 索引并重置读权限** → 必须重建**非唯一** prefix 索引 +
  重设「所有用户可读」。`worddict` 云函数不需重部署（只按 `lib` 查集合名，不依赖索引）。
- ⚠ **`seed`/`contentseed` 云函数完全不涉及 `worddict_ielts`**（只管考研 `worddict` + `content_files`）
  → 雅思集合的导入/去重只能走控制台或 `scripts/import-worddict-ielts.mjs`。

## 防重入与去重（2026-10-27 修）
- `storage.js#addArticle`：入参「标题+正文+目标词」一致 → 直接返回已有条目（不新增）。
- `storage.js#getArticles`：读取时按同签名去重**自愈**（仅在确有重复时才写回），
  修复前的历史重复下次进入自动合并。

## 模块级缓存
`utils/story.js` 的 `indexCache`/`chapterCache` 从不失效 → 导出 `clearStoryCache()`；
`seed.js` 导入/清空成功后 `markStoryDirty()`（清缓存 + 写 `mg_story_dirty`）。

## Git / GitHub
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；部分 coreutils 缺失。
- **推送失败先查代理**：git 全局 proxy 已清空让它继承环境变量（`HTTP_PROXY/HTTPS_PROXY`，
  端口会变，实测 4659/7019）。直接 `git push`，偶发 `Recv failure` 重试即通。SSH 不可用。

## 本机环境
- Bash 缺 `ls/mkdir/cat/grep/head/wc/sed/xargs` → 目录/文件操作走 Node `fs`。
- ⚠ **Bash 里嵌 node -e 含反引号/`$` 会炸**（转义地狱）→ 复杂脚本写成 `.cjs` 文件再跑。
- Python venv：`C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe`。
- Node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
- 开发者工具 CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`（IDE 须运行）；
  其 `cloud` 子命令只有 `env`/`functions`，**没有 storage/database**。

## 校验脚本（`.workbuddy/`）
- `check_syntax.cjs`：JS/JSON/WXML/WXSS/页面四件套/图标码位（报告 `_check_report.json`）。
  ⚠ **别用 `spawnSync(process.execPath,['--check',f])` 的 `status!==0` 判错**（会 EBUSY 全量误报）；
  已改 `status===1` 才取 stderr。
- `check_deps.cjs`、`rebuild_tabbar.py`、`vendor_compare.cjs`、`tts_storage_estimate.cjs`、`_theme_wire.cjs`。
- ESM 冒烟脚本坑：拷贝依赖到临时目录时补 `.mjs` 扩展名 + `pathToFileURL`，否则 ERR_MODULE_NOT_FOUND。

## 商业化（完整推导见 `docs/商业化方案.md`）
- **AI 成本极低**：DS 2026-09-10 调价后实测加权 **0.32 分/次**，重度用户 ≈**¥0.3/月**。
  云函数/存储别算进单用户成本（套餐已含）。
- ⚠ **思考模式默认开启**：思维链经 `reasoning_content` **照常计费**，且思考时 `temperature` 静默失效。
- 已按 action 设 `max_tokens` + `finish_reason==='length'` 告警。`definition_questions` 是 `analyze` 的 11 倍
  → **限制集中在「AI 批量出题」，别按次数一刀切限流**。
- 切分三轴：量/深度/个性化。主推单一 SKU **考研全程卡 ¥98**。
- **虚拟支付** 2026-04-01 起全终端强制；个人主体已可开（2026-08-31 起）。限额 **10 万/月**；
  只做道具直购、不引入代币。接入坑：两套签名（`paySig`=AppKey、`signature`=sessionKey）；
  发货以**发货推送**为准（前端回调会丢），`query_order` 兜底 + `wx_order_id` 幂等；金额单位「分」。
