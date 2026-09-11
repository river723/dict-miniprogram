# MEMORY.md — 项目长期笔记

## 项目
考研英语生词 App 的**微信原生小程序版**，由 `E:\cc_study\memo-grad`（RN + Expo）1:1 移植。
技术栈：原生小程序（WXML/WXSS/JS）+ 微信云开发（`wx.cloud`）。
Tab 结构：学习 / 阅读 / 练习 / 我的；订阅与 Admin 后台按用户决定**不做**。

## 约定
- 尺寸换算：App 的 1px = 小程序 2rpx；设计 token 在 `miniprogram/theme/tokens.js` + `theme.wxss`（`--mg-*`）。
- 图标：MaterialCommunityIcons 子集化，码位统一重映射到 BMP 私有区 **U+E000–U+E0A5**（4 位转义才合法）。
- 云函数：`ai`（出题/短文/真题解析）、`content`（真题）、`seed`（词库）、`worddict` 等。
- 自定义组件事件统一 `bind:tap`，原生 view 用 `bindtap`。

## Git / GitHub
- 远程：`origin` → `https://github.com/river723/dict-miniprogram`（HTTPS）。
- 默认分支：**`master`**（如需改 `main`：`git branch -m master main && git push -u origin main`）。
- 本机 git 偏旧（PortableGit 1.2.0）：不支持 `git rm --stdin`；`head/grep/sed/wc/xargs` 缺失。

## 校验脚本（`.workbuddy/`）
- `check_syntax.cjs`：JS 语法 / JSON / WXML `{{}}` / WXSS `{}` / 页面四件套 / 图标码位等。
- `check_deps.cjs`：依赖解析（wxs、import/include、usingComponents、app.json、JS require/import）。
- 已知待补：把「`export default` 名 ↔ 文件内定义」交叉校验并入 `check_syntax.cjs`。
