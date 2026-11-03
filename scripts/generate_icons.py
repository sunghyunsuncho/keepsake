"""원본 마크 이미지로 앱 아이콘, 스플래시, 앱 내 로고, 스토어 아이콘을 만든다.

사용법 (저장소 루트에서): make icons
원본: mobile/assets/source/keepsake_icon.png (투명 배경 마크)
"""

from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "mobile/assets/source/keepsake_icon.png"
IMAGES = ROOT / "mobile/assets/images"
STORE = ROOT / "mobile/assets/store"

# app.json의 adaptiveIcon backgroundColor와 같은 값을 유지한다.
BACKGROUND = "#FFFFFF"
# 마크로 보는 최소 불투명도. 이보다 옅은 픽셀은 바깥 그림자다.
MARK_ALPHA_THRESHOLD = 32


def load_mark() -> Image.Image:
    src = Image.open(SOURCE).convert("RGBA")
    solid = src.getchannel("A").point(lambda v: 255 if v > MARK_ALPHA_THRESHOLD else 0)
    left, top, right, bottom = solid.getbbox()
    # 그림자가 잘리지 않도록 조금 여유를 둔다.
    pad = round((bottom - top) * 0.04)
    return src.crop((left - pad, top - pad, right + pad, bottom + pad))


def fit(mark: Image.Image, box: int) -> Image.Image:
    """가로·세로 중 긴 쪽이 box가 되도록 비율을 유지해 줄인다 (원본이 가로로 길어도 넘치지 않게)."""
    scale = box / max(mark.width, mark.height)
    return mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)


def place(mark: Image.Image, size: int, mark_box: int, background: str | None) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    m = fit(mark, mark_box)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas


def monochrome(image: Image.Image) -> Image.Image:
    """Android 테마 아이콘용 단색 마크. 시스템이 알파값만 보고 색을 입힌다.

    전체 실루엣만 쓰면 안쪽 디자인이 사라지므로, 어두운 면(판·해·띠)은 진하게,
    밝은 판은 반투명하게 남겨 K 모양과 사진 느낌을 함께 살린다.
    """
    shape = image.getchannel("A").point(lambda v: 255 if v > MARK_ALPHA_THRESHOLD else 0)
    dark = image.convert("L").point(lambda v: 255 if v < 130 else 0)
    alpha = ImageChops.multiply(shape, ImageChops.lighter(dark, Image.new("L", image.size, 90)))
    white = Image.new("RGBA", image.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def save(image: Image.Image, path: Path, opaque: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    (image.convert("RGB") if opaque else image).save(path, optimize=True)
    print(f"{path.relative_to(ROOT)}  {image.width}x{image.height}")


def main() -> None:
    mark = load_mark()

    # iOS 앱 아이콘 + App Store 아이콘: 투명도 불가, 1024 정사각형 (모서리는 iOS가 둥글게 처리)
    icon = place(mark, 1024, 740, BACKGROUND)
    save(icon, IMAGES / "icon.png", opaque=True)
    save(icon, STORE / "app-store-icon-1024.png", opaque=True)
    # Google Play 스토어 아이콘: 512 정사각형
    save(icon.resize((512, 512), Image.LANCZOS), STORE / "play-store-icon-512.png", opaque=True)

    # Android 적응형 아이콘: 기기마다 원·둥근 사각형 등으로 잘리므로
    # 마크를 가운데 안전 영역(지름 66%) 안에 들어가게 작게 둔다.
    foreground = place(mark, 1024, 560, None)
    save(foreground, IMAGES / "android-icon-foreground.png")
    save(Image.new("RGBA", (1024, 1024), BACKGROUND), IMAGES / "android-icon-background.png")
    save(monochrome(foreground), IMAGES / "android-icon-monochrome.png")

    # 스플래시 화면 이미지 (배경색은 app.json에서 지정)
    save(fit(mark, 1024), IMAGES / "splash-icon.png")

    # 앱 화면 안에서 쓰는 로고 (투명 배경, 필요한 크기로 줄여서 표시)
    save(fit(mark, 600), IMAGES / "logo.png")


if __name__ == "__main__":
    main()
