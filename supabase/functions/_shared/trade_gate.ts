const ET_TIME_ZONE = 'America/New_York';
const GATE_START_MINUTES = 10 * 60; // 10:00 ET
const GATE_END_MINUTES = 15 * 60 + 55; // 15:55 ET

// Market hours: 9:30 AM - 4:00 PM ET (regular trading session)
// We block trades before 10:00 AM to avoid opening volatility
// We block trades after 3:55 PM to avoid close volatility
// Extended hours (4:00 PM - 8:00 PM ET) are BLOCKED for all trading

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

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
  second: number;
  weekday: number; // 0 = Sun .. 6 = Sat
}

export function getTradeGateStatus(nowUtc: Date = new Date()): TradeGateStatus {
  const et = getEtDateParts(nowUtc);
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

export function isTradingDayET(et: EtDateParts | Date): boolean {
  const parts = et instanceof Date ? getEtDateParts(et) : et;
  if (parts.weekday === 0 || parts.weekday === 6) {
    return false;
  }
  if (isNysHoliday(parts.year, parts.month, parts.day)) {
    return false;
  }
  return true;
}

function getEtDateParts(reference: Date): EtDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(reference);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  const weekdayKey = get('weekday').toLowerCase().slice(0, 3);

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_MAP[weekdayKey] ?? 0,
  };
}

function formatMinutes(hour: number, minute: number): string {
  const paddedHour = String(hour).padStart(2, '0');
  const paddedMinute = String(minute).padStart(2, '0');
  return `${paddedHour}:${paddedMinute}`;
}

function isNysHoliday(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  const checks = [
    // Fixed-date holidays (observed)
    () => isObservedFixedHoliday(date, 1, 1), // New Year's Day
    () => isNthWeekday(year, 1, 1, 3, date), // MLK (3rd Mon Jan)
    () => isNthWeekday(year, 2, 1, 3, date), // Presidents Day (3rd Mon Feb)
    () => isGoodFriday(date), // Good Friday (Friday before Easter)
    () => isLastWeekday(year, 5, 1, date), // Memorial Day (last Mon May)
    () => isObservedFixedHoliday(date, 6, 19), // Juneteenth
    () => isObservedFixedHoliday(date, 7, 4), // Independence Day
    () => isNthWeekday(year, 9, 1, 1, date), // Labor Day (1st Mon Sep)
    () => isNthWeekday(year, 11, 4, 4, date), // Thanksgiving (4th Thu Nov)
    () => isObservedFixedHoliday(date, 12, 25), // Christmas
  ];

  return checks.some((fn) => fn());
}

function isObservedFixedHoliday(date: Date, month: number, day: number): boolean {
  const actual = new Date(Date.UTC(date.getUTCFullYear(), month - 1, day));
  const weekday = actual.getUTCDay();
  let observed = actual;
  if (weekday === 6) {
    observed = new Date(actual.getTime() - 24 * 60 * 60 * 1000);
  } else if (weekday === 0) {
    observed = new Date(actual.getTime() + 24 * 60 * 60 * 1000);
  }
  return sameUtcDate(date, observed);
}

function isNthWeekday(
  year: number,
  month: number,
  desiredWeekday: number,
  occurrence: number,
  targetDate: Date,
): boolean {
  // desiredWeekday: 1=Mon ... 5=Fri
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const weekdayIndex = desiredWeekday % 7; // convert to JS (0=Sun)
  let day =
    1 +
    ((weekdayIndex - firstWeekday + 7) % 7) +
    (occurrence - 1) * 7;
  if (day > daysInMonth(year, month)) {
    return false;
  }
  const occurrenceDate = new Date(Date.UTC(year, month - 1, day));
  return sameUtcDate(targetDate, occurrenceDate);
}

function isLastWeekday(year: number, month: number, desiredWeekday: number, targetDate: Date): boolean {
  const totalDays = daysInMonth(year, month);
  const lastOfMonth = new Date(Date.UTC(year, month - 1, totalDays));
  const lastWeekday = lastOfMonth.getUTCDay();
  const weekdayIndex = desiredWeekday % 7;
  const offset = (lastWeekday - weekdayIndex + 7) % 7;
  const day = totalDays - offset;
  const matchDate = new Date(Date.UTC(year, month - 1, day));
  return sameUtcDate(targetDate, matchDate);
}

function isGoodFriday(targetDate: Date): boolean {
  const easter = computeEasterSunday(targetDate.getUTCFullYear());
  const goodFriday = new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000);
  return sameUtcDate(targetDate, goodFriday);
}

function computeEasterSunday(year: number): Date {
  // Meeus/Jones/Butcher algorithm
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

function sameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
