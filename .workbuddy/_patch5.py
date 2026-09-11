# -*- coding: utf-8 -*-
"""补回 icons.wxss 生成段。用严格检测，避免被文件头注释误判。"""
import io

P = r'E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py'
s = io.open(P, encoding='utf-8').read()

MARK = "open(os.path.join(OUT_THEME, 'icons.wxss')"

BLOCK = '''# ---- 1c) 写出内联 base64 字体的 WXSS ----
wxss = """/* 由脚本生成，请勿手改 —— 图标字体（MaterialCommunityIcons 子集）。
 * 形状与 memo-grad App 完全一致；颜色直接由 color 控制，字号由 font-size 控制。 */
@font-face {
  font-family: 'mgIcons';
  src: url('data:font/truetype;charset=utf-8;base64,%s') format('truetype');
  font-weight: normal;
  font-style: normal;
}

.mg-icon {
  font-family: 'mgIcons';
  font-weight: normal;
  font-style: normal;
  display: inline-block;
  line-height: 1;
  text-align: center;
  speak: none;
  -webkit-font-smoothing: antialiased;
}

.mg-icon--disabled { opacity: 0.35; }
""" % b64

'''

anchor = '# ---- 2) name -> 字符 映射 ----'
assert anchor in s

if MARK in s:
    print('wxss block already present; no-op')
else:
    s = s.replace(anchor, BLOCK + anchor, 1)
    io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
    print('wxss block restored')

chk = io.open(P, encoding='utf-8').read()
print('marker:', MARK in chk)
print('order-ok:', chk.index('b64 = base64') < chk.index('# ---- 1b)')
      < chk.index('# ---- 1c)') < chk.index(anchor))
