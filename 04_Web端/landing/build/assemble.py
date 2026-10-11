# -*- coding: utf-8 -*-
"""
把 build/ 下的模板 + tokens + 样式 + 字体 + 真实截图，装配成单文件 index.html。

为什么这么做：
  落地页要「零构建、离线自足、双击就能看」。所以最终产物必须是**一个** HTML：
  没有任何外链、没有外链 CSS、没有外链图片。这样它既能双击打开，
  又能直接扔进 engine/web_dist 由 FastAPI 托管，不引入任何构建步骤。

复用 tools/subset_fonts.py 的字体子集逻辑：先按模板的真实用字重新生成子集，
再把 woff2 转 base64 塞进 @font-face。

产出：landing/index.html（自包含单文件）
"""
from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # landing/build
ROOT = HERE.parent                              # landing

sys.path.insert(0, str(ROOT / "tools"))
from fontTools import ttLib                     # noqa: E402
from fontTools.varLib import instancer          # noqa: E402
from fontTools.subset import Subsetter, Options  # noqa: E402

WIN_FONTS = Path("C:/Windows/Fonts")
VAR_SOURCES = {
    "sans": WIN_FONTS / "NotoSansSC-VF.ttf",
    "serif": WIN_FONTS / "NotoSerifSC-VF.ttf",
}

# 页面实际用到的字重（与 tokens 里的字体栈对应）
FACES = [
    ("serif", 900, "Noto Serif SC", 900),
    ("serif", 700, "Noto Serif SC", 700),
    ("sans", 700, "Noto Sans SC", 700),
    ("sans", 500, "Noto Sans SC", 500),
    ("sans", 400, "Noto Sans SC", 400),
]

# 兜底字符：数字/拉丁/常用标点/符号，避免页面里出现没扫到的字符而回退系统字体
EXTRA = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    " ·—－_/\\|()（）【】《》「」『』、。，；：？！…‘’“”"
    "←→↑↓×✓✗●■□※△▤§°%$#&*+=~^"
)


def collect_text() -> str:
    """模板 + 样式里的全部字符（中文子集化的关键：一个字都不能漏）"""
    chars: set[str] = set(EXTRA)
    for name in ("index.template.html", "landing.css", "tokens.css"):
        p = HERE / name
        if p.exists():
            chars |= set(p.read_text(encoding="utf-8"))
    return "".join(sorted({c for c in chars if c.isprintable() or c == " "}))


def make_instance(src: Path, weight: int):
    font = ttLib.TTFont(str(src))
    if "fvar" not in font:
        return font
    axes = {a.axisTag: a for a in font["fvar"].axes}
    loc = {"wght": weight} if "wght" in axes else {}
    if not loc:
        return font
    return instancer.instantiateVariableFont(font, loc, inplace=False, updateFontNames=False)


TARGET_UPEM = 2048


def scale_upem(font, target: int = TARGET_UPEM) -> None:
    """把 unitsPerEm 等比放大到 target（默认 2048），轮廓与所有度量同步缩放。

    只改 head.unitsPerEm 会让字形尺寸错乱，必须把 glyf 的坐标、
    hmtx/vmtx 的步进、head 的 bbox、hhea/OS-2 的升降部等一起乘同一个系数。
    """
    from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

    cur = font["head"].unitsPerEm
    if cur == target:
        return
    k = target / cur

    glyf = font.get("glyf")
    if glyf is not None:
        for name in font.getGlyphOrder():
            g = glyf[name]
            if g.isComposite():
                # 复合字形要连分量偏移一起缩
                for comp in g.components:
                    if hasattr(comp, "x"):
                        comp.x = int(round(comp.x * k))
                        comp.y = int(round(comp.y * k))
                g.recalcBounds(glyf)
            elif g.numberOfContours > 0:
                coords, endPts, flags = g.getCoordinates(glyf)
                coords = GlyphCoordinates([(int(round(x * k)), int(round(y * k))) for x, y in coords])
                g.coordinates = coords
                g.endPtsOfContours = endPts
                g.flags = flags
                g.recalcBounds(glyf)

    for tag in ("hmtx", "vmtx"):
        if tag in font:
            mt = font[tag].metrics
            for name in list(mt.keys()):
                adv, lsb = mt[name]
                mt[name] = (int(round(adv * k)), int(round(lsb * k)))

    head = font["head"]
    head.unitsPerEm = target
    head.xMin = int(round(head.xMin * k)); head.xMax = int(round(head.xMax * k))
    head.yMin = int(round(head.yMin * k)); head.yMax = int(round(head.yMax * k))

    hhea = font["hhea"]
    for attr in ("ascent", "descent", "lineGap"):
        setattr(hhea, attr, int(round(getattr(hhea, attr) * k)))

    if "OS/2" in font:
        os2 = font["OS/2"]
        for attr in ("sTypoAscender", "sTypoDescender", "sTypoLineGap",
                     "usWinAscent", "usWinDescent", "yStrikeoutSize", "yStrikeoutPosition",
                     "sxHeight", "sCapHeight"):
            if hasattr(os2, attr):
                setattr(os2, attr, int(round(getattr(os2, attr) * k)))

    if "post" in font:
        post = font["post"]
        post.underlinePosition = int(round(post.underlinePosition * k))
        post.underlineThickness = int(round(post.underlineThickness * k))
        post.isFixedPitch = post.isFixedPitch


def build_faces_css(text: str) -> tuple[str, int]:
    """按实际用字生成子集，返回内联 @font-face 的 CSS 与总字节数

    ★ unitsPerEm 归一化（关键修复）★
    Windows 自带的 NotoSerifSC-VF / NotoSansSC-VF 用 unitsPerEm=1000，
    且 fvar 的 wght 默认值是 200（ExtraLight）、OS/2.usWeightClass 也是 200。
    实例化到 900 之后交给 Chromium，横向笔画会被光栅化成亚像素宽，
    整行字上会出现极细的横线（把「一」「学」「期」拦腰切一刀）——
    在 1x 和 2x 下都稳定复现，与 desubroutinize / notdef_outline / recalc_bounds /
    avar / 是否内联均无关（这些都逐一排查过）。
    把 unitsPerEm 提到 2048 后横线完全消失。做法是等比放大 head.unitsPerEm
    与所有轮廓/度量，而不是只改一个字段。
    """
    css: list[str] = [
        "/* 本地子集字体 —— 离线自足，不发任何外部请求。",
        "   由 build/assemble.py 从本机 Noto CJK 可变字体生成，勿手改。 */",
    ]
    total = 0
    for key, weight, family, css_weight in FACES:
        src = VAR_SOURCES[key]
        if not src.exists():
            raise SystemExit(f"找不到源字体：{src}")

        font = make_instance(src, weight)

        opts = Options()
        opts.desubroutinize = True
        opts.notdef_outline = False
        opts.recalc_bounds = False
        opts.layout_features = ["*"]
        # gasp 与可变字体残留表一并丢掉：静态子集不需要它们，
        # 留着反而让部分光栅器走 gridfit 分支。
        opts.drop_tables += ["DSIG", "gasp", "HVAR", "VVAR", "STAT", "avar", "fvar", "gvar"]
        subsetter = Subsetter(options=opts)
        subsetter.populate(text=text)
        subsetter.subset(font)

        scale_upem(font)
        font["OS/2"].usWeightClass = weight       # 源字体是 200，改回真实字重
        font["head"].macStyle = 0

        font.flavor = "woff2"
        import io
        buf = io.BytesIO()
        font.save(buf)
        font.close()
        data = buf.getvalue()
        total += len(data)

        b64 = base64.b64encode(data).decode("ascii")
        css.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%d;"
            "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2')}"
            % (family, css_weight, b64)
        )
        print(f"  {family} {css_weight}  {len(data)/1024:.1f} KB")
    return "\n".join(css), total


def data_uri(rel: str) -> str:
    p = ROOT / rel
    if not p.exists():
        raise SystemExit(f"找不到素材：{p}")
    mime = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode("ascii")


def main() -> int:
    tpl = (HERE / "index.template.html").read_text(encoding="utf-8")
    tokens = (HERE / "tokens.css").read_text(encoding="utf-8")
    css = (HERE / "landing.css").read_text(encoding="utf-8")

    print("生成字体子集：")
    text = collect_text()
    print(f"  页面用字 {len(text)} 个")
    faces_css, font_bytes = build_faces_css(text)

    print("内联素材：")
    imgs = {
        "__IMG_02__": "assets/02-handover.jpg",
        "__IMG_03__": "assets/03-split.jpg",
        "__IMG_04__": "assets/04-arrange.jpg",
        "__IMG_05__": "assets/05-output.jpg",
        "__IMG_06__": "assets/06-share.jpg",
        "__IMG_07__": "assets/07-assistant.jpg",
    }
    img_bytes = 0
    for token, rel in imgs.items():
        uri = data_uri(rel)
        img_bytes += len(uri)
        tpl = tpl.replace(token, uri)
        print(f"  {rel}  {len(uri)/1024:.1f} KB (base64)")

    out_html = tpl.replace("__FONTS__", faces_css)
    out_html = out_html.replace("__TOKENS__", tokens)
    out_html = out_html.replace("__LANDING__", css)

    # 断掉「页面里还残留占位符」的可能（放在替换之后才算数）
    left = re.findall(r"__[A-Z_]+__", out_html)
    if left:
        raise SystemExit(f"模板里还有未替换的占位符：{set(left)}")

    out = ROOT / "index.html"
    out.write_text(out_html, encoding="utf-8")

    print()
    print(f"字体 {font_bytes/1024:.1f} KB · 图片 {img_bytes/1024:.1f} KB")
    print(f"产出 {out}  {out.stat().st_size/1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
