import sys, json
res = {}
try:
    import PIL
    from PIL import Image, ImageDraw, ImageFont
    res['pillow'] = PIL.__version__
except Exception as e:
    res['error'] = repr(e)
res['python'] = sys.version
open(r'E:\cc_study\memo-grad-miniprogram\.workbuddy\_pillow2.json', 'w', encoding='utf-8').write(
    json.dumps(res, ensure_ascii=False, indent=1))
