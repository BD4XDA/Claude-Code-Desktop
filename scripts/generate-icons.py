#!/usr/bin/env python3
"""白底 Claude Code 官方星芒多尺寸图标生成器。

直接从 Claude Code 官方 claude.exe 提取的 14 个原始尺寸位图
(scripts/official-icons/official-{size}.png) 重着色：星芒保持官方形状与
渐变色彩，黑色底板变纯白，外缘加浅灰描边。每个尺寸都是官方原始资源，
无放大失真。
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OFFICIAL = Path(__file__).resolve().parent / "official-icons"

SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
BORDER = (218, 221, 225)  # 浅灰描边，与旧版图标一致
BORDER_RATIO = 0.0225  # 描边宽度占图标尺寸的比例
SUPERSAMPLE = 4


def recolor(src: Image.Image) -> Image.Image:
    """黑色底板 → 纯白，星芒保持官方形状与颜色。

    黑底上像素 p = α·星芒 + (1-α)·背景 的混合是亮度线性的，用亮度判据
    α = (L-180)/120 提取星芒覆盖率：星芒本体（L≥300）全饱和，背景渐变
    （L≤156）完全去除，边缘 1px 内平滑过渡。
    """
    w, h = src.size
    sp = src.load()
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = sp[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            alpha = max(0.0, min(1.0, (r + g + b - 180) / 120.0))
            op[x, y] = (
                round(alpha * r + (1 - alpha) * 255),
                round(alpha * g + (1 - alpha) * 255),
                round(alpha * b + (1 - alpha) * 255),
                a,
            )
    return out


def add_border(img: Image.Image, size: int) -> Image.Image:
    """在圆角方形底板外缘内侧画一圈浅灰描边。"""
    width = max(1, round(size * BORDER_RATIO * SUPERSAMPLE))
    big = img.resize((size * SUPERSAMPLE, size * SUPERSAMPLE), Image.LANCZOS)
    alpha = big.getchannel("A")
    eroded = alpha
    for _ in range(width):
        eroded = eroded.filter(ImageFilter.MinFilter(3))
    edge = ImageChops.subtract(alpha, eroded)
    rgba = big.load()
    ep = edge.load()
    w, h = big.size
    for y in range(h):
        for x in range(w):
            if ep[x, y] > 128:
                r, g, b, a = rgba[x, y]
                rgba[x, y] = (BORDER[0], BORDER[1], BORDER[2], a)
    return big.resize((size, size), Image.LANCZOS)


def main() -> None:
    frames = []
    for size in SIZES:
        path = OFFICIAL / f"official-{size}.png"
        if not path.exists():
            raise SystemExit(f"缺少官方位图：{path}（请先运行提取脚本）")
        frames.append(add_border(recolor(Image.open(path).convert("RGBA")), size))

    for filename in ("Claude-Code-White.ico", "Claude-Code-White-Light.ico"):
        frames[-1].save(
            PUBLIC / filename,
            format="ICO",
            sizes=[(size, size) for size in SIZES],
            append_images=frames[:-1],
        )
    frame256 = frames[-1]
    frame256.resize((192, 192), Image.LANCZOS).save(PUBLIC / "icon-192.png", optimize=True)
    frame256.resize((512, 512), Image.LANCZOS).save(PUBLIC / "icon-512.png", optimize=True)
    frames[4].save(PUBLIC / "favicon.png", optimize=True)  # 32 px
    print(f"已生成白底 Claude Code 官方图标：ICO {len(SIZES)} 个原生尺寸 + 32/192/512 PNG")


if __name__ == "__main__":
    main()
