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

## 词库体系（2026-10-19 重建，换词库/加词库必读）
**两类词库，页面不许各自判断释义来源：**
- `all`＝云端考研词库（4801 词，worddict 云函数，带完整释义/难度/考频）；
- `ielts`＝雅思核心词（4491 词）**两层数据**：
  ① 云端富词条集合 `worddict_ielts`（与考研同构 + `phonetic_uk` 音标）；
  ② 内置基础词条 `[{w,ph,d}]`（`data/libraries/ielts.js`，368KB 进主包，**离线兜底**）。

**统一入口（新增词库只改这两处，页面零改动）：**
- `services/libraries.js`：`LIBRARIES` 注册表 + `getLibraryWords(id)`→string[]（autoWord 候选池用）
  + `getLibraryEntries(id)`→词条数组 + `getLibraryEntry(id,w)`→{w,ph,d}（**小写索引 O(1)**）。
- `services/wordEnrich.js`：分层补全 **L1 本地词条(同步/离线) → L2 云端富词条(lib 选集合)**，
  `enrichSync`(只 L1) / `enrichCloud`(只 L2，富词条) / `enrichOne`(L1 优先) / `enrichBatch`(并发6)
  + **双 Map 缓存**（one/cloud 分开，防 L1 简明结果挡住 L2 富结果）。
  **详情页标准姿势**：`enrichSync` 即时上屏 → `enrichCloud` 到达后无缝升级（见 dictionary-word-detail）。

**雅思富词条管线（`scripts/`，2026-10-19 落地）：**
- `npm run gen:ielts-rich`：两步 —— ① 复用考研库 2758 词（**零成本零幻觉**，`--reuse-only` 可先落这批）
  ② 剩余 1733 词调 DeepSeek `define` 同款 prompt 生成（并发8/重试3退避/断点续跑/字段校验），约 ¥2.4/11 分钟；
  产物 `import-data/worddict-ielts.jsonl`。
- `npm run import:ielts -- --env=<云环境ID>`：幂等导入 `worddict_ielts`（word_id 去重，`--force-update` 可覆盖）；
  需 `TCB_SECRET_ID/TCB_SECRET_KEY`；导入后须**重部署 worddict 云函数** + 建 `prefix` 索引。
- ⚠️ **半成品导入期浏览页降级策略**：`ensureLocalCloudDecision` 按「云端 count ≥ 本地词条数」
  决定雅思浏览整体走云端还是本地，**不许半云端半本地混排**（行样式/筛选会时灵时不灵）；
  云端单次请求失败只回落**本轮**（`cloudBatch` 必须同步置回 false，否则本地词条被当云行渲染）。
- ⚠️ **音标字段两个集合不同名**：雅思 `phonetic_uk`，考研无音标（发音走 TTS）。
  归一化在 `fromCloudEntry`（`ph` 字段统一）；**加入生词本时把 `phonetic_uk` 映射进 `pronunciation_uk`**。

**.eudic 解析管线（`_tools/`，可复现）：**
- 源文件归档在 `_tools/_IELTS_src.eudic`；**释义是分块 zlib 压缩**（每块解压后恰 16384 字节，
  以 `0x78 01/9C/DA` 开头，39 块），不是明文——早年以为"没释义"是因为没解压。
- 词条形如 `<b>word</b><div><div>[<font face="Lucida Sans Unicode">音标</font>]<br />义项1<br />义项2</div></div>`；
  音标外层包一对方括号（**这就是早年 def 开头冒出 `[]` 的原因**）。
- `parse_eudic_defs.cjs` → `ielts_defs.json` → `gen_ielts_js.cjs` → `data/libraries/ielts.js`。
- ⚠️ **必须剥控制字符**：压缩块尾部有 NUL Padding，不剥最后一个词释义带一片 ``。
- ⚠️ 词表**以 eudic 真实词头为准**（4491），别再用早期 FMM+LNDS 纯词串还原（3953，含 245 个幻词）。

**L3 AI 兜底为何没做**：`ai` 云函数现有 7 个 action（含 2026-10-19 新增的 `define`：防幻觉 prompt +
`example` 必须含目标词 + `MAX_TOKENS.define=1500`），但「批量给一个词库补富词条」是**离线管线**而不是
在线兜底（`scripts/gen-ielts-rich.mjs` 直接调 API，不占用户侧配额）。在线按需查词仍未接入——
那需要前端触发 + 计费对账，属产品决策；当前 L1/L2 都未命中时页面渲染干净空态。

## ⚠️「雅思页显示考研词表」的真 bug（2026-10-20 修，判据设计缺陷）

**现象**：用户反馈「fusion / enzyme / estuary / cuisine / adept 等雅思独有词，在雅思库里搜不到」。
数据在包里（index 1776 等），前端搜索逻辑实测也能命中 → 说明**界面取的根本不是那份数据**。

**根因（不是数据问题，是判据缺陷）**：
`ensureLocalCloudDecision` 原来只比数量：`use = 云端count >= 本地count`。
而 `worddict` 云函数当时**还没重部署**（那是待办第三步）→ 线上是**不认识 `lib` 的旧版**，
对任何 lib 都恒查考研集合 `worddict`，返回 **4801**。于是：
```
4801 >= 4491  →  判定「云端更全，切云端」
                 ↓
雅思浏览页整个显示成考研 4801 词表（雅思独有词全被顶掉 → 搜不到）
```
**两个数量太接近（4801 vs 4491），数量判据天然分辨不出来**。

**修法：不信数量，信「云端实际查的集合名」**
- `worddict` 云函数所有 return 加 `col: COL`（count/search/byLetter/pick 共 5 处）
- `services/worddict.js` 导出 `CLOUD_COLLECTION = { all: 'worddict', ielts: 'worddict_ielts' }`；
  `countWorddict` 改回 `{total, col}`；`searchWorddict` 返回值加 `staleCloud`（col 与 lib 不符时置 true）
- `ensureLocalCloudDecision`：先校验 `res.col === CLOUD_COLLECTION[lib]`，不符则 `total=0` → 回落本地
- 页面两处消费 `staleCloud`（它**不抛错**，只靠 try/catch 兜不住，会静默显示空列表）→ 主动 throw 进既有兜底分支
  且回落时清 `_localUseCloud=false`，否则本会话后续查询继续走坏的云端
- ⚠ **`countWorddict` 返回值从 number 改成对象** → 调用方 `dictionary.js` 同步改为 `const { total } = group(await countWorddict())`
  （那个 `group` 是千分位格式化函数，命名有歧义，别误删）

**教训（通用）**：
1. **「云端更全」不能用数量判据** —— 两个集合数量相近时必然误判。要让服务端回传**它实际查了什么**，前端校验身份。
2. **前端容错必须处理「返回了但不对」**：`try/catch` 只兜抛错，`staleCloud` 这种「成功返回错误数据」得显式判。
3. **加了云端特性就必须同步「旧云函数仍在线」这一路**：本次 bug 全部来自「代码改了、云函数没重部署」。

回归：`.workbuddy/_smoke_find.cjs`（30 项：三种云端状态判定 + 11 个雅思独有词搜索 + 锁定词表关系）。
## 雅思音标缺失的成因（2026-10-19，已修 23+1 词）

**症状**：4491 词里有的有音标有的没有。查证后是**三类成因，其中一类是我的解析 bug**：

1. **漏解析（23 词，已修）**：eudic 音标有**两种写法**，原脚本只认第 ① 种：
   - ① `[<font face="Lucida Sans Unicode">xxx</font>]` 带字体标签，绝大多数词
   - ② `[5blaindfEuld]` `[in5hibit]` 纯文本方括号，**23 个词用这种**（inhibit/whereas/tar/one…）
   → ② 被当成释义的一部分（`[in5hibit] 抑制,约束…`），页面音标位空着、释义开头挂个方括号。
2. **误取词形（1 词，已修）**：sphinx 的 font 版抓到的是 `[Sphinx]`（**词形本身**），
   真音标 `[sfiNks]` 掉在下一段。校正判据（很硬）：`ph` 去掉非字母后 == 单词本身 → 改用下一段的整体音标段。
3. **源数据真没有（19 词，不修）**：`distil/guideline/odyssey/marvelous/fleeting/well-to-do…`
   在 eudic 里只写了 `[化]` **学科标签**没有音标段；`cosy` 则整条只有释义。
   ⚠ 学科标签 `[化][计][医][法]` 形似音标，解析时**必须排除**（`SUBJECT_TAGS`），否则会误当音标。

**⚠ 改解析器的两条纪律**：
- **切段顺序不能反**：必须先 `split(/<br\s*\/?>/)` 再 `stripTags`。反了会把 `<br/>` 当标签删掉 → 段落粘连。
- 新增识别规则后必跑「旧产物 vs 新产物」diff：词数不变、**丢失音标 = 0**、无释义 = 0、
  释义变化数 == 预期改动数。**基线必须取 git 版本**，别拿自己刚跑出来的产物当基线
  （我这么干过一次，差点把回归当成正常）。

**UI 连带修**：
- 浏览页右侧栏：音标原本挂在 meta 块的 `wx:else` 互斥分支 → 本地词 f/k 补齐后
  `wx:if="{{item.frequency>0}}"` 恒真，**19 个无音标词的音标位永远不渲染**。
  改为音标独立 `wx:if="{{item.ph}}"`，与星标同列并存。
- `toRow` 不许伪造缺省值：`rawDiff||3` 配上 `pad5(0)` 返回 `☆☆☆☆☆`/`□□□□□`（非空串），
  会让「云端返回但字段缺失」的行看起来像有真实考频。改为缺值输出空串，WXML 自然不渲染。
- 详情页本地视图无音标时的兜底文案：「来自「X」」→「「X」未收录音标 · 点右侧喇叭听发音」（TTS 兜底）。

回归测试加了 4 项：音标覆盖率 ≤20、释义里无漏出音标、缺值不伪造、无音标词仍有星标。
## 雅思考频/难度重标（2026-10-19，真语料重标）
**问题**：雅思词的 frequency/difficulty 原是**从考研词库整条搬来**的（abandon 两边都 2/3 → 考的是考研不是雅思），
AI 段更是让 DeepSeek 凭记忆拍数字；本地 ielts.js 压根没这两个字段。**都不是雅思考频**。

**新管线**（`_tools/`，全可复现）：
- `fetch_awl.cjs` → `awl_freq.json`：抓 AWL（学术词表 Coxhead）。570 词头/sublist + **3109 词形实测语料词频**。
  内置**规格校验**（570 词头、sublist1-9 各 60 + 10 共 30、词形 2500~3500），上游改版即报错退出，绝不静默出半份表。
- `relabel_ielts_metrics.cjs` → `ielts_metrics.json`：4491 词的 f/k。**双源**：
  - 考频 = **web 语料实测 ppm 绝对阈值**（Norvig Google Web，99.5% 覆盖）为基准 +
    **AWL sublist 学术加权只上调不下调**（sublist 1-2→5★ … 9-10→2★）。实测上调 185 词。
  - 难度 = **纯客观指标**：音节数(主) > 派生后缀 > 义项数 > 词长；与考频轴独立。
  - 每词留审计字段 `src/webPpm/awlSub/syl/senses`，口径可追。
- `gen_ielts_js.cjs` 合入 `{w,ph,d,f,k}`（4491 全带，368KB→423KB）。

⚠ **踩过的坑（别再犯）**：
1. **两语料 ppm 不能混用**：学术语料把学术词抬高 **19.4 倍**（实测比值中位数）。
   「AWL 命中用学术 ppm，否则通用 ppm」→ 651 词霸占高分、其余全挤 1★（实测 85% 都是 1★）。
   必须**单一可比标尺(web) + AWL 只做加权**。
2. **等分位数 ≠ 绝对阈值**：等分会硬把 accessory(配件) 塞进 5★，语义失真 → 改绝对阈值。
3. **阈值必须按实测分布校准**：kScore 实际范围只有 1.0~5.0（不是估的 6.5），原阈值 5.2 导致 **5★ 永远空缺**；
   AWL 加权若绕道 ppm 再分档，上限被压到 3★ → 加权几乎失效（只上调 32 词），必须**直达星级**映射。
   现分布：考频 1048/1936/880/395/232，难度 1243/2101/723/333/91。
4. **sublist 表 570 词头 vs 词形表 3109 词形**：只查 sublist 漏 213 个派生形，须做词形还原（`sublistOfForm`）。
5. **apply() 筛选必须先经 toRow 归一**：原始行两种形态（云端 difficulty/frequency vs 本地 f/k），
   直接读原始行的 difficulty 会让本地行全落空 → 筛选出空列表。

**前端现状**：本地词库已有真实 f/k → 浏览页行内星标（曾按 isLocal 屏蔽）、难度/考频筛选 chip（曾按 cloudBatch 门控）、
详情页本地视图 meta 徽标**全部开放**；`wordEnrich#enrichSync` 把 f/k 透出成 frequency/difficulty 统一字段名。
回归测试 `.workbuddy/_smoke_metrics.cjs`（21 项：一致性 / 字段映射 / toRow 双形态 + 越界防护）。

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
- **推送失败先查代理（已踩多次）**：出网代理端口会变，git 全局 `http.proxy` 写死旧端口会连不上。
  **正确做法**：看环境变量 `HTTP_PROXY/HTTPS_PROXY`（2026-10-16 实测 `127.0.0.1:7019`），
  用它的端口推：`git -c http.proxy=http://127.0.0.1:7019 -c https.proxy=http://127.0.0.1:7019 push origin master`。
  已把 git 全局 `http.proxy/https.proxy` **清空**，让它继承环境变量，今后直接 `git push` 即可。
  偶发 `Recv failure`/`Could not connect` 重试一两次即通。SSH 不可用（`~/.ssh` 无私钥）。

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
