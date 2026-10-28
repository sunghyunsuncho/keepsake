import { reverseGeocode, type GeocodedPlace } from '@modules/photo-meta';

// 주소 이름은 한국어로 받는다. 해외 지명도 한국어 표기가 있으면 그걸 쓴다.
const LOCALE = 'ko-KR';
const TIMEOUT_MS = 8000;

/**
 * 사진 좌표로 장소 이름과 그 지역 시간대를 찾는다. 오프라인이거나 실패하면 null.
 * 같은 장소에서 여러 장을 찍는 경우가 많아 좌표를 약 100m 단위로 묶어 결과를 재사용한다.
 * 시간대 오프셋은 날짜(서머타임)에 따라 달라지므로 날짜도 키에 넣는다.
 */
export async function lookupPlace(lat: number, lng: number, takenAt: string) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${takenAt.slice(0, 10)}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = withTimeout(reverseGeocode(lat, lng, LOCALE, new Date(takenAt).getTime()), TIMEOUT_MS)
      .catch((error: unknown) => {
        if (__DEV__) console.warn('[place] reverse geocode failed', error);
        return null;
      });
    cache.set(key, pending);
    // 실패한 결과는 다음에 다시 시도할 수 있게 지운다.
    pending.then((result) => result === null && cache.delete(key));
  }
  const place = await pending;
  if (!place) return null;
  const name = formatPlace(place);
  return name ? { name, timeZoneOffsetMinutes: place.timeZoneOffsetMinutes ?? null } : null;
}

const cache = new Map<string, Promise<GeocodedPlace | null>>();

/**
 * 국내: "서울숲 · 서울", 랜드마크가 없으면 "서울 성수동" 또는 "서울 서초대로"
 * 해외: "에펠 탑 · 파리, 프랑스", 랜드마크가 없으면 "파리, 프랑스"
 *
 * iOS(Apple)는 국내 주소에 구·동을 주지 않고 locality가 시 이름이다. Android는 동(subLocality)을 준다.
 */
export function formatPlace(place: GeocodedPlace) {
  const domestic = place.isoCountryCode === 'KR';
  const area = domestic
    ? unique([
        shortKoreanRegion(place.administrativeArea),
        shortKoreanRegion(place.subAdministrativeArea ?? place.locality),
      ]).join(' ')
    : unique([place.locality ?? place.administrativeArea, place.country]).join(', ');
  const landmark = place.areaOfInterest;

  if (landmark) {
    // "제주도"처럼 랜드마크가 곧 그 지역이면 지역을 붙이지 않는다 ("서울숲"은 붙인다).
    const regionWord = area.split(/[ ,]/)[0];
    const isRegionItself = landmark.replace(/(도|시)$/, '') === regionWord;
    return !area || isRegionItself ? landmark : `${landmark} · ${area}`;
  }
  if (domestic) {
    const detail = place.subLocality ?? place.thoroughfare;
    return unique([area, detail]).join(' ') || null;
  }
  return area || null;
}

/** "서울특별시" → "서울", "부산광역시" → "부산", "제주특별자치도" → "제주" */
function shortKoreanRegion(name: string | undefined) {
  return name?.replace(/(특별자치시|특별자치도|특별시|광역시)$/, '') || undefined;
}

function unique(parts: (string | undefined)[]) {
  return parts.filter((part, index): part is string => !!part && parts.indexOf(part) === index);
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
