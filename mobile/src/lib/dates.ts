// 날짜 키는 기기 현지 시간 기준 "YYYY-MM-DD". 같은 날 사진을 묶는 단위다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 촬영 시각의 '그 자리' 날짜·시각. offset(UTC 기준 분)이 있으면 촬영지 시간대로,
 * 없으면 기기 시간대로 계산한다. 파리에서 오후 3시에 찍은 사진은 한국에서 봐도 오후 3시다.
 */
function wallClock(iso: string, offset?: number | null) {
  const date = new Date(iso);
  if (offset === null || offset === undefined) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      weekday: date.getDay(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
    };
  }
  const shifted = new Date(date.getTime() + offset * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

export function localDateKey(iso: string, offset?: number | null) {
  const { year, month, day } = wallClock(iso, offset);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function todayKey() {
  return toDateKey(new Date());
}

export function parseDateKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(key: string, days: number) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** 그날 0시 ~ 다음날 0시 (현지 시간) */
export function dayRange(key: string) {
  const start = parseDateKey(key);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function formatDay(key: string) {
  const date = parseDateKey(key);
  const thisYear = new Date().getFullYear();
  const md = `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
  return date.getFullYear() === thisYear ? md : `${date.getFullYear()}년 ${md}`;
}

export function formatFullDate(iso: string, offset?: number | null) {
  const { year, month, day, weekday } = wallClock(iso, offset);
  return `${year}년 ${month + 1}월 ${day}일 (${WEEKDAYS[weekday]})`;
}

/** "15:00". 촬영지 시간대가 지금 기기와 다르면 "15:00 (GMT+1)"처럼 시간대를 붙인다. */
export function formatTime(iso: string, offset?: number | null) {
  const { hours, minutes } = wallClock(iso, offset);
  const time = `${pad(hours)}:${pad(minutes)}`;
  const deviceOffset = -new Date(iso).getTimezoneOffset();
  return offset === null || offset === undefined || offset === deviceOffset
    ? time
    : `${time} (${formatOffset(offset)})`;
}

export function formatOffset(offset: number) {
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const minutes = abs % 60;
  return `GMT${sign}${Math.floor(abs / 60)}${minutes ? `:${pad(minutes)}` : ''}`;
}

export function formatMonth(key: string) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}
