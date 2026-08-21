import { PeriodicFrequency, ExecutionRule } from '../models/periodicPayment.model';

// When a standing order collects next.
//
// Pure and date-only, so it is testable without a clock or a database, and every awkward case is decided
// here rather than in the handler: a month that does not have the requested day, a weekend, an end date that
// has passed. Getting this wrong is not a cosmetic bug, it is collecting money on the wrong day.

// Whole months per period, for the frequencies that step in months. The rest step in days.
const MONTHS_PER_PERIOD: Partial<Record<PeriodicFrequency, number>> = {
  Monthly: 1,
  EveryTwoMonths: 2,
  Quarterly: 3,
  SemiAnnual: 6,
  Annual: 12,
};

const DAYS_PER_PERIOD: Partial<Record<PeriodicFrequency, number>> = {
  Daily: 1,
  Weekly: 7,
  EveryTwoWeeks: 14,
};

/** Parses a plain `YYYY-MM-DD`. UTC throughout, so a scheduler in another timezone agrees. */
export function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Rejects a date the calendar does not have (2026-02-31), which `Date.UTC` would otherwise roll forward.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Applies the requested day of the month, clamped to a month that is shorter.
 *
 * A standing order on the 31st is a normal thing to want, and February is not an error: the standard's own
 * reading is that it collects on the last day the month has. Rolling INTO March instead would move the
 * collection into the next period, which is worse than being a day or two early.
 */
export function applyDayOfExecution(date: Date, dayOfExecution?: number): Date {
  if (!dayOfExecution) return date;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = Math.min(dayOfExecution, lastDayOfMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Moves a non-working day per the execution rule. Weekends only: a bank holiday calendar is per country and
 * per year, and inventing one would be worse than not claiming to have it.
 */
export function applyExecutionRule(date: Date, rule?: ExecutionRule): Date {
  if (!rule) return date;
  const shifted = new Date(date.getTime());
  const step = rule === 'preceding' ? -1 : 1;
  while (shifted.getUTCDay() === SATURDAY || shifted.getUTCDay() === SUNDAY) {
    shifted.setUTCDate(shifted.getUTCDate() + step);
  }
  return shifted;
}

export function addPeriod(date: Date, frequency: PeriodicFrequency): Date {
  const days = DAYS_PER_PERIOD[frequency];
  if (days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }
  const months = MONTHS_PER_PERIOD[frequency] ?? 1;
  // Anchored to the FIRST of the target month, so the day is then applied by `applyDayOfExecution` rather
  // than by JavaScript's own overflow. Stepping from the 31st directly would drift a monthly order into
  // March and then keep it there.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export interface SchedulePlan {
  startDate: string;
  endDate?: string;
  frequency: PeriodicFrequency;
  dayOfExecution?: number;
  executionRule?: ExecutionRule;
}

/**
 * The first execution date on or after the start date.
 *
 * Not simply the start date: the day of execution and the execution rule both move it, and a caller asking
 * for "monthly on the 15th from the 1st" means the 15th.
 */
export function firstExecutionDate(plan: SchedulePlan): string | null {
  const start = parseDate(plan.startDate);
  if (!start) return null;
  let candidate = applyDayOfExecution(start, plan.dayOfExecution);
  // The requested day may already have passed within the starting month.
  if (candidate.getTime() < start.getTime()) {
    candidate = applyDayOfExecution(addPeriod(start, plan.frequency), plan.dayOfExecution);
  }
  const adjusted = applyExecutionRule(candidate, plan.executionRule);
  return withinEnd(adjusted, plan.endDate) ? formatDate(adjusted) : null;
}

/** The execution after a given one, or null when the order has run out of end date. */
export function nextExecutionDate(plan: SchedulePlan, afterDate: string): string | null {
  const after = parseDate(afterDate);
  if (!after) return null;
  const stepped = applyDayOfExecution(addPeriod(after, plan.frequency), plan.dayOfExecution);
  const adjusted = applyExecutionRule(stepped, plan.executionRule);
  return withinEnd(adjusted, plan.endDate) ? formatDate(adjusted) : null;
}

function withinEnd(date: Date, endDate?: string): boolean {
  if (!endDate) return true;
  const end = parseDate(endDate);
  // An unparseable end date is not treated as "no end": that would turn a typo into an open-ended
  // authorisation to collect money, which is the wrong way to fail.
  if (!end) return false;
  return date.getTime() <= end.getTime();
}

export type SchedulePlanRefusal =
  | 'start_date_invalid'
  | 'end_date_invalid'
  | 'end_before_start'
  | 'frequency_invalid'
  | 'day_of_execution_invalid'
  | 'no_execution_in_range';

/** Validates a requested schedule. Refuses rather than normalising: a silently adjusted schedule collects
 *  on a day the payer did not agree to. */
export function validateSchedule(plan: SchedulePlan): SchedulePlanRefusal | null {
  const start = parseDate(plan.startDate);
  if (!start) return 'start_date_invalid';
  if (plan.endDate) {
    const end = parseDate(plan.endDate);
    if (!end) return 'end_date_invalid';
    if (end.getTime() < start.getTime()) return 'end_before_start';
  }
  if (plan.dayOfExecution !== undefined && (plan.dayOfExecution < 1 || plan.dayOfExecution > 31)) {
    return 'day_of_execution_invalid';
  }
  if (!firstExecutionDate(plan)) return 'no_execution_in_range';
  return null;
}
