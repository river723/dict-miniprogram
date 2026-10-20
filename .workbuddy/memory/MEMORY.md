# MEMORY.md — 项目长期笔记（精简版，控制在 ~9K）

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

## ⚠️ 三条通用教训（最高价值，踩过多次）
1. **「云端更全」不能用数量判据** —— 数量相近必然误判（4801 vs 4491）。要让服务端回传
   **它实际查的集合名**（`col`），前端校验身份。且 `try/catch` 只兜抛错，
   「成功返回错误数据」（`staleCloud`）必须**显式判 + throw**。
2. **加了云端特性就必须同步「旧云函数仍在线」这一路** —— 本项目多次 bug 都来自
   「代码改了、云函数没重部署」。
3. **反复修不好时怀疑结构，而不是继续调属性**。

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
- **浏览页禁半云端半本地混排**：`ensureLocalCloudDecision` 一次性决定数据源；
  云端单次失败只回落**本轮**（`cloudBatch` 必须同步置回 false）。
- **音标字段两集合不同名**：雅思 `phonetic_uk`，考研集合无音标（发音走 TTS）。归一化在 `fromCloudEntry`。
- **集合身份校验（2026-10-20 修）**：`worddict` 云函数所有 return 加 `col: COL`；
  `services/worddict.js` 导出 `CLOUD_COLLECTION` + `staleCloud`；页面校验 `col` 不符即回落本地。
  回归 `.workbuddy/_smoke_find.cjs`（30 项）。
- **toRow 不许伪造缺省值**：`rawDiff||3`+`pad5(0)` 会返回非空串 `☆☆☆☆☆`，让「字段缺失」看起来
  像真实考频。缺值输出空串，WXML 自然不渲染。筛选前必须先经 `toRow` 归一。

**雅思富词条管线**：`npm run gen:ielts-rich`（① 复用考研 2758 词零成本 `--reuse-only`；
② 1733 词调 DeepSeek，约 ¥2.36/11 分钟）→ `import-data/worddict-ielts.jsonl` →
`npm run import:ielts -- --env=<ID>`（幂等，需 TCB 密钥）→ **重部署 worddict** + 建 `prefix` 索引。

**⚠️ 字段来源必须分离（2026-10-20 用户拍板，勿改回整条搬运）**：
- 可复用（考研侧）：`definitions` / `etymology` / `similar_words` / `memory_tip`（实测复用率 100%）
- 必须雅思自己的：`frequency` / `difficulty`（web 语料 + AWL 重标口径）、`phonetic_uk`（雅思自带）
- **为什么**：两库难度差 ≥2 星的有 **773/2753 词（28%）**；整条搬运会覆盖掉真实语料口径。
  实测产物 f/k 与考研不同占 89% —— 这正是"没被污染"的证据，已写成回归断言。
- `gen-ielts-rich.mjs#toDoc` 已改为**只从 rich 取内容字段**，f/k/音标强制走 `ieltsMetrics`/`phOf`；
  AI prompt 也移除了 `frequency`/`difficulty` 两个字段（模型凭记忆拍的数字不可信），
  `validate()` 不再校验它们。新增 `--rebuild` 开关（改口径后必须用它丢弃旧产物）。
- 产物体检：`.workbuddy/_smoke_ielts_rich.cjs`（22 项）——含"f/k 与雅思重标一致""释义复用率 ≥95%"
  "f/k 未被考研覆盖（差异率 >50%）"三条反向断言。

**⚠️ 例句含词校验别写太严**（AI 段产出 0 例外，必须能过）：
只剥 `-s/-ed/-ing` 会误报 **75 条**（accessories/accompanied/allies/amplified…）；
加「词干编辑距离 ≤1」降到 13 条（bind→bound/cling→clung/fling→flung 等不规则动词）；
再补 `IRREGULAR` 显式表 + 前缀构词（overtake→overtook、sculpture→sculpting、weave→wove）才归零。
`ai` 云函数有 `define` action（防幻觉 prompt + example 必含目标词）但**在线按需查词未接入**（属产品决策）。

**.eudic 解析管线（`_tools/`，可复现）**：
- 源 `_tools/_IELTS_src.eudic`；**释义是分块 zlib 压缩**（每块解压后恰 16384 字节，39 块）。
  词条形如 `<b>word</b><div><div>[<font face="Lucida Sans Unicode">音标</font>]<br />义项…`。
- 音标**三种写法**：① 带 font 标签（绝大多数）② 纯文本方括号 `[in5hibit]`（23 词）③ 学科标签
  `[化][计][医]` —— **形似音标，必须用 `SUBJECT_TAGS` 排除**。
- ⚠ **切段顺序不能反**：先 `split(/<br\s*\/?>/)` 再 `stripTags`。反了段落粘连。
- ⚠ 必须剥控制字符（压缩块尾部 NUL Padding）；词表以 eudic 真实词头为准（4491）。
- ⚠ 词形误取校正：`ph` 去非字母 == 单词本身 → 用下一段音标（sphinx）。
- ⚠ **改解析器后必跑「旧产物 vs 新产物」diff，基线取 git 版本**，别拿自己刚跑出的坏产物当基线。

**雅思考频/难度重标（2026-10-19）**：原数据是从考研库整条搬来的 + AI 凭记忆拍数字，都不是雅思考频。
- `fetch_awl.cjs` → `awl_freq.json`：AWL 570 词头/sublist + 3109 词形词频，**内置规格校验**，改版即报错。
- `relabel_ielts_metrics.cjs` → `ielts_metrics.json`：考频 = **web 语料实测 ppm 绝对阈值**（Norvig，
  99.5% 覆盖）+ AWL sublist 加权（只上调不下调，直达星级映射）；难度 = 纯客观（音节数>后缀>义项>词长）。
- 坑：① 两语料 ppm **不可混用**（学术语料抬高 19.4 倍 → 85% 挤 1★）；② 等分位数 ≠ 绝对阈值；
  ③ 阈值须按实测分布校准；④ 词形表要做词形还原（`sublistOfForm`）。
- 分布：考频 1048/1936/880/395/232，难度 1243/2101/723/333/91。
- 回归 `.workbuddy/_smoke_metrics.cjs`（26 项）。
- **数据现状**：雅思本地 4491（**音标 4472+19 已于 2026-10-20 全部补齐，见下节**）；
  云端 jsonl 仅 2758（未上云）；考研云端 4801 **音标 0 条**；
  交集 2758 / 雅思独有 1733 / 考研独有 2043。

## ⚠️ eudic 音标的 KK 字体编码（2026-10-20 修，53 条）
**比"19 词无音标"更隐蔽的问题**：eudic 对 34 个词给的不是 IPA，而是**KK 字体编码**
（`5`=ˈ `E`=eɪ `I`=ɪ `Q`=ʌ `N`=ŋ `F`=ʃ `^`=次重音），页面会显示成 `in5hibit`/`sfiNks`/`tB:`；
另有 8 条带未剥的 `(US)` 地域前缀。上轮"补回 23 词音标"补的是**编码原文**，等于没修。

- **数据源**：`cdict_query` npm 包（`_tools/ecdict_src/package/db/cdict2w.db`，SQLite 56992 词条，
  tarball 4.2MB / 解包 10MB）。GitHub ECDICT 官方源全部拿不到（raw 是 git-lfs 指针、
  release zip 404、API 403 限流），**npm 镜像 `registry.npmmirror.com` 是可行入口**。
  用 Node 22 内置 `node:sqlite` 的 `DatabaseSync` 读，**无需装 sqlite3 依赖**。
- `_tools/fix_phonetics_from_ecdict.cjs`：ECDICT 覆盖 42 条 + `OVERRIDES` 人工补 11 条 = **53/53 全解**。
  默认预览，`--apply` 才写。⚠ 归一化四条坑：
  ① 剥前导尾缀时**不能碰 `:`**，否则 `tar 'tɑ:'` 丢长音号；
  ② ECDICT 重音符位置不可靠（`misgiving 'mis'^iviŋ` → 词中重音 `ˈˌiviŋ`）→ **只留词首第一个**；
  ③ 英式拼写在美式词典里查不到 → `variants()` 试 `-ise→-ize` / 双写辅音还原 / 去连字符；
  ④ **别把「多读音条目」（`ˈkɔːdʒəl, ˈkɔːdiəl`）当坏数据**——曾顺带清尾分号误伤 7 个正常条目。
- **判据 `isBadPh`**：空 / 含 `[0-9A-Z^]` / 以 `(US)|(UK)` 开头。三者之外一律不动。
- 校验口径：git 基线 diff → **4491 词数不变、53 处变更全部只动 ph**（d/f/k 逐条比对）、
  KK 残留 0、无音标 0。主包 993KB/2048KB。
- 回归加了 4 项：无音标=0（阈值从 ≤20 收紧到 0）、无 KK 残留、无地域前缀、4 个污染词已归一。
- ⚠ ECDICT 二进制**不入库**（`.gitignore`），需要时重下。

## 数据导入（零密钥路线）
- 内联数据 + 断点续跑：`npm run seed:build`→`seed/seed-data.js`→部署→设置页「①②③」；
  `npm run content:build`→`contentseed/content-data.js`→「④⑤」。
- **内联数据必须是与 index.js 同级的 .js**，该云函数目录要有 `package.json`。
- 默认超时 3 秒 → 批量须 timeBudget + 断点续跑；正式超时写 `config.json`（靠部署同步）。
  timeout：`ai`120 / `contentseed`60 / `content`20 / `seed`20以上、`worddict`20。
- 导入幂等：先删同 path 索引再上传 → **不必先「清空」**。主包体积不受影响。

## 系列故事（换故事集必读）
- 管线：源 `../memo-grad/src/data/stories.json` → `build-content-data.mjs` → `contentseed/content-data.js`
  → 运行时走 `content` 云函数 `storyList`/`storyDetail`。
- 字段：id:number / title,content,translation,theme / **summary 是字符串不是数组** / words:array / word_count。
- ⚠ 换集必踩：① `**` 粗体不剥离（清洗顺序 3+连星→双星→单星）② `theme` 换了要补 `THEME_LABELS`
  **散落三处**（`constants/index.js`、`read/read.js`、`story-read/story-read.js`）
  ③ `words` 可能是 `{w,...}[]` → `String()` 变 `"[object Object]"` → **整篇零高亮且不报错**。
- **`themeLabel` 回落三处必须一致**：`theme ? (THEME_LABELS[theme] || theme) : ''`。
- 🌟 **段落对齐是硬约束**：前端按 `\n\n` 切段后**下标 1:1 配对**。最优切分：英文单 `\n`、中文 `\n\n`、
  两侧过滤 `---`（15/20 对齐；都 `\n\n`→13，都 `\n+`→14）。
- 工具：⭐`npm run stories:verify`（**总闸门**）、`stories:normalize`、`stories:adapt`、
  `.workbuddy/_render_sim.mjs`（复刻渲染体检，**不能替代真机**）。规范见 `docs/故事数据对齐问题清单.md`。
- 当前线上：**《4801 词烟火故事集》**（20 篇短篇）。

## ⚠️「导入成功但界面还是旧内容」两条线分别取证
1. **读取侧：tab 页不走 `onLoad`** → `read.js` 只在 onLoad 加载；修法 = `onShow` 看 dirty 标记刷。
   ⭐ 用户当场自愈：**阅读页下拉刷新**（已开 `enablePullDownRefresh`）。
2. **写入侧：同 cloudPath 上传可能不替换内容**（复用旧对象返回旧 fileID，字节从未变）。
   改为严格幂等：`deleteFile(旧) → remove(旧索引) → uploadFile(同 path) → add(新索引)`。
3. **自证钩子**（排查首选，别让用户数章数）：`contentseed#info()` 返回 `cloudStory` 真实标题/章数。

## 模块级缓存
`utils/story.js` 的 `indexCache`/`chapterCache` 从不失效 → 导出 `clearStoryCache()`；
`seed.js` 导入/清空成功后 `markStoryDirty()`（清缓存 + 写 `mg_story_dirty`）。

## Git / GitHub
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；部分 coreutils 缺失。
- **推送失败先查代理**：git 全局 proxy 已清空让它继承环境变量（`HTTP_PROXY/HTTPS_PROXY`，
  端口会变，实测 4659/7019）。直接 `git push`，偶发 `Recv failure` 重试即通。SSH 不可用。

## 本机环境
- Bash 缺 `ls/mkdir/cat/grep/head/wc/sed/xargs` → 目录/文件操作走 Node `fs`。
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