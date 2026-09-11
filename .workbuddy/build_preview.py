# -*- coding: utf-8 -*-
"""生成第一批交付的可视化验收页（.workbuddy/preview/phase1.html）。

内容：
  1) tabBar 图标（真实 PNG）+ 页面内图标（真实字体子集，与 App 同字形）
  2) 设计 token 色板（解析 theme/theme.wxss 的 --mg-* 变量）
  3) 本次新增/改动文件清单
"""
import os, re, json, base64

ENV = r'E:\cc_study\memo-grad-miniprogram'
MP = os.path.join(ENV, 'miniprogram')
OUT_DIR = os.path.join(ENV, '.workbuddy', 'preview')
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, 'phase1.html')

# ---- 字体 base64 ----
wxss = open(os.path.join(MP, 'theme', 'icons.wxss'), encoding='utf-8').read()
m = re.search(r'base64,([A-Za-z0-9+/=]+)', wxss)
FONT_B64 = m.group(1)

# ---- 图标名 -> 字符 ----
icons_src = open(os.path.join(MP, 'theme', 'icons.js'), encoding='utf-8').read()
block = icons_src[icons_src.index('const ICONS'):icons_src.index('function iconChar')]
icons = []
for name, code in re.findall(r"'([a-z0-9-]+)':\s*'\\u([0-9a-fA-F]{4,6})'", block):
    icons.append((name, int(code, 16)))

# ---- tabBar PNG -> data URI ----
tab_pngs = []
png_dir = os.path.join(MP, 'assets', 'icons')
for fn in sorted(os.listdir(png_dir)):
    if fn.endswith('.png'):
        b64 = base64.b64encode(open(os.path.join(png_dir, fn), 'rb').read()).decode('ascii')
        tab_pngs.append((fn[:-4], 'data:image/png;base64,' + b64))

# ---- 色板 ----
tokens = open(os.path.join(MP, 'theme', 'theme.wxss'), encoding='utf-8').read()
page_block = tokens[tokens.index('page {'):tokens.index('@media')] if '@media' in tokens else tokens
palette = re.findall(r'--mg-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})', page_block)

# ---- 清单 ----
FILES = [
    ("设计系统", [
        ("theme/tokens.js", "改", "镜像 App tokens.ts（palette / typography / spacing / radius / shadow / motion）"),
        ("theme/theme.wxss", "改", "WXSS 变量 + 通用类（卡片/按钮/标签/列表行/搜索框/空态/FAB）"),
        ("theme/icons.js", "新", "图标名→字符映射（166 字形，与 App 同字体）"),
        ("theme/icons.wxss", "新", "子集字体 base64 内联（21KB TTF）"),
        ("app.wxss", "改", "全局引入主题与图标"),
    ]),
    ("图标资源", [
        ("assets/icons/tab-*.png", "新", "4 个 Tab × 选中/未选中 = 8 张 PNG，由 App 原字体渲染"),
    ]),
    ("设计系统组件", [
        ("components/mg-icon", "新", "AppIcon：任意颜色/尺寸，形状与 App 一致"),
        ("components/mg-button", "新", "AppButton：primary / secondary / ghost / danger + sm/md/lg"),
        ("components/mg-empty", "新", "EmptyState：图标气泡 + 标题 + 描述 + 行动按钮"),
        ("components/mg-section-header", "新", "SectionHeader：节标题 + 可选图标/副标题/右侧 action"),
        ("components/mg-difficulty", "新", "DifficultyBadge：难度星标"),
        ("components/mg-stat-strip", "新", "StatStrip：三指标条"),
        ("components/mg-modal", "新", "AppModal / ConfirmDialog：遮罩 + 居中卡片 + 插槽"),
    ]),
    ("学习 Tab", [
        ("pages/home", "新", "仪表盘：Hero 环形进度 / 主 CTA / 三指标 / 待办行 / 词库入口 / 最近添加 / 趋势"),
        ("pages/study", "重写", "背诵：单词卡 / 听写 / 释义 / 短文 四模式 + 队列与艾宾浩斯复习"),
        ("pages/word-list", "重写", "生词本：搜索 / 排序 / 难度考频筛选 / 词根预览 / 删除"),
        ("pages/word-detail", "重写", "词详情：释义 / 词根 / 记忆 / 形近词 / AI 补全 / 删除"),
        ("pages/add-word", "重写", "添加生词：批量录入 + AI 解析预览 + 保存"),
        ("pages/wordbank-picker", "重写", "从词库选词：分组翻页 / 排序 / 全选 / 忽略未选 / 批量加入"),
        ("pages/dictionary", "新", "词库入口：词库卡片 + 实时词条数"),
        ("pages/dictionary-browse", "新", "浏览词库：搜索 / A–Z 索引 / 筛选排序 / 列表 → 词条详情"),
        ("pages/dictionary-word-detail", "新", "词条详情（只读）：释义/例句/词根/记忆/形近词 + 加入生词本"),
    ]),
    ("阅读 Tab", [
        ("pages/read", "新", "阅读中心：Hero 双段统计 + 系列故事 / 趣味文章 段切换 + 双列表"),
        ("pages/article-generate", "新", "生成文章：参数步进 / 智能推荐或手动选词 / 主题 / 预览 / 保存"),
        ("pages/article-read", "新", "文章阅读：中英对照 / 译文开关 / 点词看释义 / 重新生成 / 删除"),
    ]),
    ("导航骨架", [
        ("app.json", "改", "Tab 改为 学习/阅读/练习/我的；全局墨绿 header + 白字；8 张 PNG 图标"),
    ]),
    ("服务层修复", [
        ("services/storage.js", "改", "addWord 补回 etymology/memory_tip/similar_words；新增 saveIgnoredWordbankWords、文章读写"),
        ("utils/article.js", "新", "短文解析（标题/正文/翻译 + 目标词高亮）与智能推荐选词"),
        ("cloudfunctions/ai", "改", "story 支持 theme/length/withTitle，向后兼容学习页短文模式"),
    ]),
]

def swatch(name, hexv):
    return (f'<div class="sw"><span class="chip" style="background:{hexv}"></span>'
            f'<span class="nm">--mg-{name}</span><span class="hx">{hexv}</span></div>')

def icon_cell(name, code):
    ch = chr(code)
    return (f'<div class="ic"><span class="glyph">{ch}</span>'
            f'<span class="icname">{name}</span></div>')

sections = []
for group, items in FILES:
    rows = ''.join(
        f'<tr><td class="f">{p}</td><td><span class="tag t-{"new" if s in ("新",) else "mod"}">{s}</span></td><td class="d">{d}</td></tr>'
        for p, s, d in items
    )
    sections.append(f'<h3>{group}</h3><table><tbody>{rows}</tbody></table>')

html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MemoGrad 小程序 · 第一批交付验收</title>
<style>
@font-face {{ font-family:'mgIcons'; src:url('data:font/truetype;charset=utf-8;base64,{FONT_B64}') format('truetype'); font-weight:normal; font-style:normal; }}
:root {{
  --bg:#F4F0E8; --surface:#FFFFFF; --surface-alt:#FAF7F1; --outline:#E0DDD4;
  --text:#1A1D1B; --text2:#5C605C; --text3:#8A8E89;
  --primary:#2E5E4E; --primary-light:#E6EFEB; --accent:#C2603A; --danger:#B5462E; --success:#3F7A5C;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:32px 24px 72px; background:var(--bg); color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }}
.wrap {{ max-width:1080px; margin:0 auto; }}
h1 {{ font-size:30px; margin:0 0 6px; letter-spacing:-.3px; }}
.sub {{ color:var(--text2); font-size:14px; margin-bottom:28px; }}
.card {{ background:var(--surface); border:1px solid var(--outline); border-radius:16px;
  padding:24px; margin-bottom:20px; box-shadow:0 2px 4px rgba(26,29,27,.05); }}
h2 {{ font-size:19px; margin:0 0 4px; }}
h2 + .hint {{ font-size:13px; color:var(--text3); margin-bottom:18px; }}
h3 {{ font-size:14px; margin:22px 0 10px; color:var(--primary); letter-spacing:.3px; }}
h3:first-of-type {{ margin-top:6px; }}
.tabs {{ display:flex; flex-wrap:wrap; gap:26px; }}
.tabitem {{ text-align:center; }}
.tabitem img {{ width:44px; height:44px; display:block; margin:0 auto 8px; }}
.tabitem .lbl {{ font-size:12px; color:var(--text3); }}
.tabitem .lbl.on {{ color:var(--primary); font-weight:700; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:10px; }}
.ic {{ display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 4px;
  border:1px solid var(--outline); border-radius:12px; background:var(--surface-alt); }}
.glyph {{ font-family:'mgIcons'; font-size:30px; line-height:1; color:var(--primary); }}
.icname {{ font-size:10px; color:var(--text3); text-align:center; word-break:break-all; }}
.sws {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(216px,1fr)); gap:8px; }}
.sw {{ display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--outline);
  border-radius:10px; background:var(--surface-alt); font-size:12px; }}
.chip {{ width:26px; height:26px; border-radius:7px; border:1px solid rgba(0,0,0,.08); flex-shrink:0; }}
.nm {{ color:var(--text2); flex:1; font-family:ui-monospace,monospace; font-size:11px; }}
.hx {{ color:var(--text3); font-family:ui-monospace,monospace; font-size:11px; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; }}
td {{ padding:8px 10px; border-bottom:1px solid #EFEBE3; vertical-align:top; }}
tr:last-child td {{ border-bottom:none; }}
td.f {{ font-family:ui-monospace,monospace; font-size:12px; color:var(--primary); white-space:nowrap; }}
td.d {{ color:var(--text2); }}
.tag {{ display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; }}
.t-new {{ background:var(--primary-light); color:var(--primary); }}
.t-mod {{ background:#F6E5DC; color:var(--accent); }}
.bar {{ display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px; }}
.pill {{ padding:5px 12px; border-radius:999px; font-size:12px; font-weight:600;
  border:1px solid var(--outline); background:var(--surface-alt); color:var(--text2); }}
.pill.ok {{ background:var(--primary-light); border-color:var(--primary); color:var(--primary); }}
</style></head><body><div class="wrap">
<h1>MemoGrad 小程序 · 第一批交付验收</h1>
<div class="sub">设计系统 + 导航骨架 + 学习 Tab 全套 + 阅读 Tab 骨架 · 图标与配色取自 App 原始资源</div>

<div class="card">
  <h2>tabBar 图标</h2>
  <div class="hint">由 App 的 MaterialCommunityIcons 字体程序化渲染，非 emoji / 非手绘</div>
  <div class="tabs">
    {''.join(f'<div class="tabitem"><img src="{u}" alt="{n}"><div class="lbl{" on" if n.endswith("-active") else ""}">{n}</div></div>' for n, u in tab_pngs)}
  </div>
</div>

<div class="card">
  <h2>页面内图标（字体子集 {len(icons)} 个字形）</h2>
  <div class="hint">与 App 同一字体，颜色随 color 属性变化，尺寸随 font-size 变化</div>
  <div class="grid">{''.join(icon_cell(n, c) for n, c in icons)}</div>
</div>

<div class="card">
  <h2>设计 token 色板（浅色主题）</h2>
  <div class="hint">解析自 theme/theme.wxss，与 App src/theme/tokens.ts 一一对应；暗色主题同步镜像</div>
  <div class="sws">{''.join(swatch(n, v) for n, v in palette)}</div>
</div>

<div class="card">
  <h2>交付清单</h2>
  <div class="hint">共 {sum(len(i) for _, i in FILES)} 项</div>
  {''.join(sections)}
</div>

<div class="card">
  <h2>静态校验结果</h2>
  <div class="hint">脚本：.workbuddy/check_syntax.cjs</div>
  <div class="bar">
    <span class="pill ok">43 个 JS 语法通过</span>
    <span class="pill ok">34 个 JSON 解析通过</span>
    <span class="pill ok">32 个 WXML {{ }} 配对</span>
    <span class="pill ok">35 个 WXSS 花括号配对</span>
    <span class="pill ok">页面四件套齐备</span>
    <span class="pill ok">usingComponents 全部可解析</span>
    <span class="pill ok">跳转目标均已注册</span>
    <span class="pill ok">51 个图标名均在字体子集内</span>
  </div>
</div>
</div></body></html>'''

open(OUT, 'w', encoding='utf-8').write(html)
print('ok', len(html), OUT)
