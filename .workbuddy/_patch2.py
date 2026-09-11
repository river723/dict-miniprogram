# -*- coding: utf-8 -*-
"""补丁：让 icons.js / icons.wxs / tabBar PNG / report 全部走 cp_of（BMP 重映射码位）。
幂等：可重复执行。"""
import io

P = r'E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py'
s = io.open(P, encoding='utf-8').read()
log = []


def sub(old, new, label):
    global s
    if old not in s:
        if new in s:
            log.append(label + ': already-ok')
            return
        raise SystemExit('MISSING [' + label + ']: ' + repr(old[:90]))
    s = s.replace(old, new, 1)
    log.append(label + ': patched')


sub(r'''pairs = ',\n  '.join("'%s': '\\u%04x'" % (n, glyphmap[n]) for n in names)''',
    r'''pairs = ',\n  '.join("'%s': '\\u%04x'" % (n, cp_of[n]) for n in names)''',
    'icons.js-pairs')

sub(r'''wxs_pairs = ', '.join("'%s': '%s'" % (n, chr(glyphmap[n])) for n in names)''',
    r'''wxs_pairs = ', '.join("'%s': '%s'" % (n, chr(cp_of[n])) for n in names)''',
    'icons.wxs-pairs')

sub("ImageFont.truetype(TTF, big)", "ImageFont.truetype(ttf_tmp, big)", 'tabbar-font')

sub("    'tabbar_pngs': pngs,",
    "    'codepoint_range': 'U+%04X - U+%04X' % (BASE_CP, BASE_CP + len(names) - 1),\n"
    "    'verify': _verify,\n"
    "    'verify_ok': not (_verify['bad_cmap'] or _verify['render_diff'] or _verify['blank']),\n"
    "    'tabbar_pngs': pngs,",
    'report')

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('\n'.join(log))
