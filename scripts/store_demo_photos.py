"""스토어 스크린샷용 데모 사진을 만들어 부팅된 iOS 시뮬레이터 사진첩에 넣는다.

사용법 (저장소 루트에서): make demo-photos SOURCE=~/Desktop
목록: mobile/src/components/store-demo-photos.json (앱의 데모 구성과 같은 파일)

원본(SOURCE 아래 'source' 경로)을 긴 변 2400px로 줄이고, 촬영 시각·시간대·GPS를 EXIF에 넣어
'file' 이름으로 저장한다. 사진첩은 이 EXIF로 촬영 시각과 위치를 정하므로,
앱의 날짜·지도·장소가 목록대로 보인다.
"""

import argparse
import json
import subprocess
import tempfile
from datetime import datetime
from fractions import Fraction
from pathlib import Path

import piexif
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "mobile/src/components/store-demo-photos.json"
MAX_SIDE = 2400


def rational(value: float) -> tuple[int, int]:
    fraction = Fraction(value).limit_denominator(1_000_000)
    return fraction.numerator, fraction.denominator


def gps_ifd(lat: float, lng: float) -> dict:
    def dms(value: float):
        value = abs(value)
        degrees = int(value)
        minutes = int((value - degrees) * 60)
        seconds = (value - degrees - minutes / 60) * 3600
        return [(degrees, 1), (minutes, 1), rational(seconds)]

    return {
        piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
        piexif.GPSIFD.GPSLatitude: dms(lat),
        piexif.GPSIFD.GPSLongitudeRef: b"E" if lng >= 0 else b"W",
        piexif.GPSIFD.GPSLongitude: dms(lng),
    }


def build(photo: dict, source_dir: Path, out_dir: Path) -> Path:
    taken = datetime.fromisoformat(photo["takenAt"])
    offset = taken.strftime("%z")
    exif = {
        "0th": {piexif.ImageIFD.Make: b"Apple", piexif.ImageIFD.Model: b"iPhone"},
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: taken.strftime("%Y:%m:%d %H:%M:%S").encode(),
            piexif.ExifIFD.DateTimeDigitized: taken.strftime("%Y:%m:%d %H:%M:%S").encode(),
            piexif.ExifIFD.OffsetTimeOriginal: f"{offset[:3]}:{offset[3:]}".encode(),
        },
        "GPS": gps_ifd(photo["lat"], photo["lng"]) if "lat" in photo else {},
    }
    with Image.open(source_dir / photo["source"]) as image:
        # 원본 EXIF는 버리므로 회전 정보를 픽셀에 먼저 반영한다.
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((MAX_SIDE, MAX_SIDE))
        target = out_dir / photo["file"]
        image.save(target, "JPEG", quality=90, exif=piexif.dump(exif))
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source", type=Path, required=True, help="목록의 'source' 경로가 시작하는 폴더"
    )
    parser.add_argument(
        "--no-install", action="store_true", help="시뮬레이터에 넣지 않고 파일만 만든다"
    )
    args = parser.parse_args()

    # 매우 큰 원본(약 1억 화소)도 있어 Pillow의 크기 경고를 끈다. 목록에 적은 사진만 연다.
    Image.MAX_IMAGE_PIXELS = None
    photos = json.loads(MANIFEST.read_text())["photos"]
    out_dir = Path(tempfile.mkdtemp(prefix="keepsake-demo-"))
    files = [build(photo, args.source.expanduser(), out_dir) for photo in photos]
    print(f"{len(files)}장 생성: {out_dir}")
    if not args.no_install:
        subprocess.run(["xcrun", "simctl", "addmedia", "booted", *map(str, files)], check=True)
        print("시뮬레이터 사진첩에 추가했습니다.")


if __name__ == "__main__":
    main()
