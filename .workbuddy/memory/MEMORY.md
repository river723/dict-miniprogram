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
- 自定义组件事件统一 `bind:tap`，原生 view 用 `bindtap`。
- **文本按关键词切段再拼回**：外层容器一律用 `<view>`，内层叶子用 `<text>`（`wx:for` 挂叶子 text 上），
  **不要 text 包 text**；class 不要留空串，样式写在与 class 同名的基类上（如 `.sr__seg`）。
- **`<text>` 一律不要设 `display:block`**；需要块级效果就外面套 `<view>`。
- **构建函数返回的对象字段要和 WXML 的 `wx:if` 对齐**：`wx:if="{{para.en}}"` 要求构建函数确实产出
  `en` 字段。排查"某块内容不显示"时，**先打印该字段的实际值，再怀疑 CSS/结构**。
  案例：`utils/story.js#buildSegments` 漏返回 `en` → `wx:if` 恒假 → 英文原文永不渲染。
- **文本切段再拼回（最终方案：独立空格节点）**：
  > **核心原理：多元素拼文本时，元素边界的空白一定会被渲染层折叠（CSS 规范级）。
  > 唯一可靠的解法是让空格由「独立元素」承载，而不是塞进片段文本的首尾。**

  实现要点：
  - 数据层 `markWords` 返回 `[{ text, hit, spaceBefore, spaceAfter }]` ——
    把片段**首尾空格全部剥离**，只留计数（相邻片段的前后空格合并）。
  - WXML：`<text class="sr__sp"> </text>`（空格节点，内容 nbsp，按 spaceBefore/After 条件渲染）
    + `<text class="sr__seg">{{item.text}}</text>`。空格节点是**独立元素** →
    断行发生在元素边界（不锁死），空格在元素内部（不被折叠）。
  - WXSS：`.sr__sp` / `.sr__seg` 均 `display:inline`；外层 `.sr__en` /
    `.ar__en` 用 `white-space:normal` + `word-break:break-word`。
  - **不用 `space="nbsp"` 属性**（会把空格并入文本、锁住断点）；
    **不用 `white-space:pre-wrap`**（渲染源码换行 → 溢出）；
    **不用 `display:inline-block`**（行尾空白仍 collapse，且排版会乱）。
  - **不用 `rich-text`**：它**屏蔽内部所有节点事件**，无法点击取词。
  - 不要 text 包 text；class 不要留空串。

- **微信渲染层调试方法论**：不要靠推理猜 CSS 行为 ——
  写脚本复刻渲染结构生成 HTML，**用无头 Chrome 截图**做视觉验证
  （`.workbuddy/_render_check.cjs` + `_render_preview.{html,png}` 已可复用），
  一轮就能看清全部症状，比反复改代码让用户试快得多。

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
