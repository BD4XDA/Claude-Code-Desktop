#!/usr/bin/env python3
"""从 public/favicon.svg 提取 Claude 星形符号，生成多尺寸图标。

产出（public/ 下）：
  - Claude-Code-White.ico   Windows 快捷方式/任务栏（16-256 多尺寸）
  - icon-192.png / icon-512.png  PWA manifest 图标（Chrome --app 窗口任务栏）
  - favicon.png             浏览器标签兜底
用法：python scripts/generate-icons.py
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

CORAL = (217, 119, 87, 255)          # #D97757 Claude 珊瑚橙
SYMBOL = (255, 250, 247, 255)        # #FFFAF7 当前 SVG 的星形色
RX_RATIO = 9 / 32                    # 圆角半径比例（与 favicon.svg 一致）


def extract_symbol() -> Image.Image:
    """从 favicon.svg 的内嵌 PNG 提取星形 alpha。"""
    svg = (PUBLIC / "favicon.svg").read_text(encoding="utf-8")
    match = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", svg)
    if not match:
        raise SystemExit("favicon.svg 中未找到内嵌 PNG")
    img = Image.open(io.BytesIO(base64.b64decode(match.group(1))))
    return img.convert("RGBA")


def rounded_rect(size: int) -> Image.Image:
    """珊瑚橙圆角方块底。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(1, round(size * RX_RATIO))
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=CORAL)
    return img


def compose(size: int, symbol: Image.Image) -> Image.Image:
    """按 favicon.svg 的布局比例（星形占 20/32）合成一帧。"""
    base = rounded_rect(size)
    margin = round(size * 6 / 32)
    symbol_size = size - margin * 2
    star = symbol.resize((symbol_size, symbol_size), Image.LANCZOS)
    star = star.point(lambda p: 255 if p > 40 else p)  # 清掉 PNG 抗锯齿灰边
    white = Image.new("RGBA", (symbol_size, symbol_size), SYMBOL)
    mask = star.split()[3]
    base.paste(white, (margin, margin), mask)
    return base


def main() -> None:
    symbol = extract_symbol()
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [compose(s, symbol) for s in sizes]

    ico = compose(256, symbol)
    ico.save(PUBLIC / "Claude-Code-White.ico", format="ICO",
             sizes=[(s, s) for s in sizes])

    compose(192, symbol).save(PUBLIC / "icon-192.png")
    compose(512, symbol).save(PUBLIC / "icon-512.png")
    compose(32, symbol).save(PUBLIC / "favicon.png")

    print("已生成: Claude-Code-White.ico / icon-192.png / icon-512.png / favicon.png")


if __name__ == "__main__":
    main()
