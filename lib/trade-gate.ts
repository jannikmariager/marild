const ET_TIME_ZONE = 'America/New_York';
const GATE_START_MINUTES = 10 * 60;
const GATE_END_MINUTES = 15 * 60 + 55;

export type TradeGateReason =
  | 'TRADE_ALLOWED'
  | 'MARKET_CLOSED_DAY'
  | 'OPENING_WINDOW_NO_TRADE'
  | 'CLOSE_WINDOW_NO_TRADE';

export interface TradeGateStatus {
  allowed: boolean;
  reason: TradeGateReason;
  gateStartET: string;
  gateEndET: string;
  currentTimeET: string;
  blockedUntilET?: string;
}

interface EtDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
}

export function getTradeGateStatus(now: Date = new Date()): TradeGateStatus {
  const et = getEtDateParts(now);
  const minutes = et.hour * 60 + et.minute;
  const gateStartStr = '10:00';
  const gateEndStr = '15:55';
  const currentStr = formatMinutes(et.hour, et.minute);

  if (!isTradingDayET(et)) {
    return {
      allowed: false,
      reason: 'MARKET_CLOSED_DAY',
      gateStartET: gateStartStr,
      gateEndET: gateEndStr,
      currentTimeET: currentStr,
      blockedUntilET: gateStartStr,
    };
  }

  if (minutes < GATE_START_MINUTES) {
    return {
      allowed: false,
      reason: 'OPENING_WINDOW_NO_TRADE',
      gateStartET: gateStartStr,
      gateEndET: gateEndStr,
      currentTimeET: currentStr,
      blockedUntilET: gateStartStr,
    };
  }

  if (minutes > GATE_END_MINUTES) {
    return {
      allowed: false,
      reason: 'CLOSE_WINDOW_NO_TRADE',
      gateStartET: gateStartStr,
      gateEndET: gateEndStr,
      currentTimeET: currentStr,
      blockedUntilET: 'Next session 10:00 ET',
    };
  }

  return {
    allowed: true,
    reason: 'TRADE_ALLOWED',
    gateStartET: gateStartStr,
    gateEndET: gateEndStr,
    currentTimeET: currentStr,
  };
}

export function isTradingDayET(parts: EtDateParts | Date): boolean {
  const et = parts instanceof Date ? getEtDateParts(parts) : parts;
  if (et.weekday === 0 || et.weekday === 6) return false;
  return !isNyseHoliday(et.year, et.month, et.day);
}

function getEtDateParts(reference: Date): EtDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(reference);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    weekday: mapWeekday(lookup.weekday),
  };
}

function mapWeekday(label?: string): number {
  const key = (label || '').slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[key] ?? 0;
}

function formatMinutes(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isNyseHoliday(year: number, month: number, day: number): boolean {
  const target = new Date(Date.UTC(year, month - 1, day));
  const checks = [
    () => isObservedFixedHoliday(target, 1, 1),
    () => isNthWeekday(year, 1, 1, 3, target), // MLK
    () => isNthWeekday(year, 2, 1, 3, target), // Presidents
    () => isGoodFriday(target),
    () => isLastWeekday(year, 5, 1, target), // Memorial
    () => isObservedFixedHoliday(target, 6, 19), // Juneteenth
    () => isObservedFixedHoliday(target, 7, 4),
    () => isNthWeekday(year, 9, 1, 1, target), // Labor
    () => isNthWeekday(year, 11, 4, 4, target), // Thanksgiving
    () => isObservedFixedHoliday(target, 12, 25),
  ];
  return checks.some((fn) => fn());
}
function isObservedFixedHoliday(date: Date, refMonth: number, refDay: number) {
  const actual = new Date(Date.UTC(date.getUTCFullYear(), refMonth - 1, refDay));
  const weekday = actual.getUTCDay();
  let observed = actual;
  if (weekday === 6) observed = addDays(actual, -1);
  else if (weekday === 0) observed = addDays(actual, 1);
  return sameDate(observed, date);
}

function isNthWeekday(year: number, month: number, weekday: number, occurrence: number, target: Date) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday % 7) - firstWeekday;
  const day = 1 + ((offset + 7) % 7) + (occurrence - 1) * 7;
  if (day > daysInMonth(year, month)) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return sameDate(candidate, target);
}

function isLastWeekday(year: number, month: number, weekday: number, target: Date) {
  const totalDays = daysInMonth(year, month);
  const last = new Date(Date.UTC(year, month - 1, totalDays));
  const offset = (last.getUTCDay() - (weekday % 7) + 7) % 7;
  const candidate = new Date(Date.UTC(year, month - 1, totalDays - offset));
  return sameDate(candidate, target);
}

function isGoodFriday(target: Date) {
  const easter = computeEaster(target.getUTCFullYear());
  const goodFriday = addDays(easter, -2);
  return sameDate(goodFriday, target);
}

function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sameDate(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
