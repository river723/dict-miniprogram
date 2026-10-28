# MEMORY.md — 项目长期笔记（判据 + 坑，≤3000 字符）

> 细则全在 `docs/`：`开发约定.md`（词库/渲染/发音/主题/生命周期/密钥红线）、
> `词库数据管线.md`（eudic/ECDICT/考频重标/雅思富词条/故事）、
> `运维手册.md`（部署/密钥/导入/校验脚本/商业化）、`管理员与鉴权.md`（openid 三层闸门）。
> 本文件只留「判据 + 坑」，细节不要往这里堆。

## 项目
考研英语生词 App 的**微信原生小程序版**（由 `E:\cc_study\memo-grad` RN+Expo 移植）。
原生 WXML/WXSS/JS + 微信云开发。Tab：学习/阅读/练习/我的。订阅与 Admin 不做。
Git `origin`→`https://github.com/river723/dict-miniprogram`，分支 **master**，
云环境 `cloud1-d6gfdnelqf7478e85`。

## 通用约定
- 1px(App)=2rpx；token 在 `theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MCI 子集化，码位重映射 **U+E000–U+E0A5**；只能用 `mci-subset.ttf`。
- `ai` 环境变量：`DEEPSEEK_API_KEY`(必填) + `AI_BASE_URL`/`AI_MODEL`/`AI_THINKING`。
  **换厂商＝改环境变量不改代码**，改完须重部署。
- ⚠ 根 `package.json` 是 `"type":"module"` → 根下 `.js` 被当 ESM，脚本用 `.cjs`；
  **云函数目录下**的 `package.json` 无 `type`（= CommonJS），云函数里的文件必须叫 `.js`。

## ⚠️ 五条通用教训（最高价值，踩过多次）
1. **「云端更全」不能用数量判据**（4801 vs 4491 必误判）→ 服务端回传**实际查的集合名**
   `col`，前端校验身份。`try/catch` 只兜抛错，「成功返回错误数据」（`staleCloud`）
   必须**显式判 + throw**。
2. **加了云端特性就必须同步「旧云函数仍在线」这一路** —— bug 多来自「代码改了、
   云函数没重部署」。
3. **反复修不好时怀疑结构，而不是继续调属性**。
4. **鉴权只能在云函数做**：前端传什么都不可信。身份**已免费具备** ——
   `cloud.getWXContext().OPENID` 由平台注入不可伪造；缺的不是「登录/认证」而是
   **授权/角色**。⚠ 做「登录功能」是过度设计。
5. **`setData` 是异步的** → `this.data` 不能当同步重入锁；用实例标志（`this._saving`）。
6. **给用户的命令示例必须「可直接复制执行」**：别用 `/` 当分隔符（用户会当成
   参数，Git Bash 还会把 `/` 转成绝对路径）→ 用空格/逗号：`npm run deploy:cf -- a b c`。

## ⚠️ 管理员鉴权（→ `docs/管理员与鉴权.md`）
- 三层闸门：云函数入口（**真闸门**）／前端隐藏／seed 页 onShow 兜底。
- 只给能写全局共享集合的 3 个加闸门：`seed`/`contentseed`/`setup`；只读的
  `worddict`/`content`/`tts` **不加**（加了正常用户查不到词）。
- 白名单两源任一命中即管理员：内置 sha256 指纹（零配置，解开「建 admins 集合需要
  管理员」的鸡生蛋）+ `admins` 集合（动态加减，不用重部署）。
- ⚠ `admins` 集合权限必须「所有用户不可读写」；⚠ 空 OPENID 一律拒绝
  （控制台云端测试无上下文 → FORBIDDEN，属预期，请在真机验证）。
- 云函数各自独立打包 → **无法跨目录 require**，admin-guard 要放副本；权威源
  `scripts/lib/admin-guard.cjs`，改完跑 `node .workbuddy/admin_wire.cjs --apply`。
- 查自己 openid：`admin#whoami`。**明文 openid 不入库**（仓库公开 → 只存 sha256 指纹）。

## 词库体系（换/加词库必读 → `docs/开发约定.md` 第一节）
- `all`＝云端考研 4801；`ielts`＝雅思 4491（云端富词条 + 内置 `data/libraries/ielts.js` 兜底）。
- **新增词库只改两处**：`services/libraries.js`（LIBRARIES + getter，小写索引 O(1)）／
  `services/wordEnrich.js`（L1 本地同步 → L2 云端，双 Map 缓存）。
- 音标字段两集合不同名：雅思 `phonetic_uk`，考研无音标字段（发音走 TTS）。
- **浏览页禁半云端半本地混排**：`ensureLocalCloudDecision` 一次性决定数据源。
- **toRow 不许伪造缺省值**：缺值输出空串，筛选前必须先经 `toRow` 归一。
- ⚠ **字段来源必须分离（用户拍板，勿改回整条搬运）**：内容字段可复用考研侧；
  `frequency`/`difficulty`/`phonetic_uk` 必须雅思自己的（两库难度差 ≥2 星的有 28%）。
## 校验脚本与商业化（→ `docs/运维手册.md` 第四、六节）
- ⚠ `check_syntax.cjs` 判错**别用** `spawnSync(...['--check',f])` 的 `status!==0`
  （会 EBUSY 全量误报）；已改 `status===1`。
- **AI 成本极低**：加权 **0.32 分/次**，重度用户 ≈**¥0.3/月**。
- ⚠ **思考模式默认开启**：思维链经 `reasoning_content` **照常计费**，且思考时
  `temperature` 静默失效。
- `definition_questions` 是 `analyze` 的 11 倍 → **限制集中在「AI 批量出题」，
  别按次数一刀切限流**。主推 ¥98 考研全程卡。
- ⚠ **待做：`ai` 云函数无 openid 限流**（8 个云函数里只有 `words` 做了身份识别）
  → 任何人可无限刷 AI 额度。复用 `docs/管理员与鉴权.md` 的 openid 机制即可。
