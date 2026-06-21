import { QueryUnderstandingClarificationNeed, QueryUnderstandingTimeRange } from './query-understanding.types';

export interface TimeRangeParseResult {
  timeRanges: QueryUnderstandingTimeRange[];
  clarificationNeeds: QueryUnderstandingClarificationNeed[];
}

export function parseTimeRanges(text: string, now: Date, timezone: string): TimeRangeParseResult {
  const today = toLocalDate(now, timezone);
  const ranges: QueryUnderstandingTimeRange[] = [];

  if (text.includes('今天')) {
    ranges.push(toRange('today', today, today, timezone, '今天'));
  }
  if (text.includes('昨天')) {
    const day = addDays(today, -1);
    ranges.push(toRange('yesterday', day, day, timezone, '昨天'));
  }
  if (text.includes('本週')) {
    const start = addDays(today, -(today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1));
    ranges.push(toRange('this_week', start, addDays(start, 6), timezone, '本週'));
  }
  if (text.includes('上週')) {
    const thisWeekStart = addDays(today, -(today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1));
    const start = addDays(thisWeekStart, -7);
    ranges.push(toRange('last_week', start, addDays(start, 6), timezone, '上週'));
  }
  if (text.includes('本月')) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    ranges.push(toRange('this_month', start, end, timezone, '本月'));
  }
  if (text.includes('近三個月')) {
    ranges.push(toRange('last_three_months', addMonths(today, -3), today, timezone, '近三個月'));
  }

  const clarificationNeeds: QueryUnderstandingClarificationNeed[] = [];
  if (text.includes('最近') && ranges.length === 0) {
    clarificationNeeds.push({
      type: 'time_range',
      reason: 'unsupported_time_range',
      question: '請指定明確時間範圍，例如今天、上週、本月或近三個月。',
      blocking: true
    });
  }

  return { timeRanges: ranges, clarificationNeeds };
}

function toLocalDate(now: Date, timezone: string): Date {
  if (timezone === 'Asia/Taipei') {
    const taipeiOffsetMs = 8 * 60 * 60 * 1000;
    const taipeiDate = new Date(now.getTime() + taipeiOffsetMs);
    return new Date(Date.UTC(taipeiDate.getUTCFullYear(), taipeiDate.getUTCMonth(), taipeiDate.getUTCDate()));
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function toRange(
  label: string,
  start: Date,
  end: Date,
  timezone: string,
  source: string
): QueryUnderstandingTimeRange {
  return {
    label,
    start: toDateOnly(start),
    end: toDateOnly(end),
    timezone,
    source,
    confidence: 0.95
  };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
