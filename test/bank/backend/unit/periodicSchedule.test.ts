// v37 P3.9: when a standing order collects.
//
// This is the part of a periodic payment that is actually hard, and getting it wrong is not cosmetic: it means
// taking someone's money on a day they did not agree to. Every awkward case is a test, because every one of
// them is a real month: a day February does not have, a weekend, an end date that cuts the series short.
import { describe, it, expect } from 'vitest';
import {
  parseDate, applyDayOfExecution, applyExecutionRule, addPeriod,
  firstExecutionDate, nextExecutionDate, validateSchedule,
} from '../../../../bank/backend/src/modules/pisp/services/periodicSchedule.service';

describe('date parsing refuses what the calendar does not have', () => {
  it('accepts a plain date', () => {
    expect(parseDate('2026-03-15')?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('refuses a day the month does not have, rather than rolling it forward', () => {
    // `Date.UTC(2026, 1, 31)` silently becomes 3 March. A schedule built on that collects in the wrong month.
    expect(parseDate('2026-02-31')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('15/03/2026')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('the requested day of the month, clamped rather than rolled', () => {
  it('applies the day within the month', () => {
    const date = applyDayOfExecution(parseDate('2026-03-01')!, 15);
    expect(date.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('clamps the 31st to the last day a short month has', () => {
    // The standard's reading, and the safer one: collecting on 28 February is early, collecting on 3 March
    // has moved the payment into the next period.
    expect(applyDayOfExecution(parseDate('2026-02-01')!, 31).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(applyDayOfExecution(parseDate('2026-04-01')!, 31).toISOString().slice(0, 10)).toBe('2026-04-30');
    // A leap year is a different last day, which is exactly the kind of thing a clamp gets right for free.
    expect(applyDayOfExecution(parseDate('2028-02-01')!, 31).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('leaves the date alone when no day was requested', () => {
    expect(applyDayOfExecution(parseDate('2026-03-07')!).toISOString().slice(0, 10)).toBe('2026-03-07');
  });
});

describe('the execution rule moves a weekend', () => {
  // 2026-03-14 is a Saturday, 2026-03-15 a Sunday.
  it('following moves forward to Monday', () => {
    expect(applyExecutionRule(parseDate('2026-03-14')!, 'following').toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(applyExecutionRule(parseDate('2026-03-15')!, 'following').toISOString().slice(0, 10)).toBe('2026-03-16');
  });

  it('preceding moves back to Friday', () => {
    expect(applyExecutionRule(parseDate('2026-03-15')!, 'preceding').toISOString().slice(0, 10)).toBe('2026-03-13');
  });

  it('leaves a working day alone, and leaves everything alone with no rule', () => {
    expect(applyExecutionRule(parseDate('2026-03-16')!, 'following').toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(applyExecutionRule(parseDate('2026-03-15')!).toISOString().slice(0, 10)).toBe('2026-03-15');
  });
});

describe('stepping a period does not drift', () => {
  it('steps the day-based frequencies by days', () => {
    expect(addPeriod(parseDate('2026-03-15')!, 'Daily').toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(addPeriod(parseDate('2026-03-15')!, 'Weekly').toISOString().slice(0, 10)).toBe('2026-03-22');
    expect(addPeriod(parseDate('2026-03-15')!, 'EveryTwoWeeks').toISOString().slice(0, 10)).toBe('2026-03-29');
  });

  it('anchors a month-based step to the first, so the day is applied and not overflowed', () => {
    // The drift this prevents: stepping monthly from 31 January by "one month" lands on 3 March in plain
    // date arithmetic, and every later step then compounds it.
    const first = addPeriod(parseDate('2026-01-31')!, 'Monthly');
    expect(first.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(applyDayOfExecution(first, 31).toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('steps the longer frequencies by whole months', () => {
    expect(addPeriod(parseDate('2026-03-10')!, 'Quarterly').toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(addPeriod(parseDate('2026-03-10')!, 'SemiAnnual').toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(addPeriod(parseDate('2026-03-10')!, 'Annual').toISOString().slice(0, 10)).toBe('2027-03-01');
  });
});

describe('the first execution', () => {
  it('is the start date when nothing moves it', () => {
    expect(firstExecutionDate({ startDate: '2026-03-16', frequency: 'Monthly' })).toBe('2026-03-16');
  });

  it('is the requested day when that is later in the starting month', () => {
    expect(firstExecutionDate({ startDate: '2026-03-01', frequency: 'Monthly', dayOfExecution: 15 }))
      .toBe('2026-03-15');
  });

  it('moves to the next period when the requested day has already passed', () => {
    // Asking on the 20th for "monthly on the 15th" means next month, not two days ago.
    expect(firstExecutionDate({ startDate: '2026-03-20', frequency: 'Monthly', dayOfExecution: 15 }))
      .toBe('2026-04-15');
  });

  it('applies the execution rule after the day, not before', () => {
    // The 15th of March 2026 is a Sunday. Ordering matters: applying the rule first and the day second would
    // undo the shift and collect on the weekend.
    expect(firstExecutionDate({
      startDate: '2026-03-01', frequency: 'Monthly', dayOfExecution: 15, executionRule: 'following',
    })).toBe('2026-03-16');
  });

  it('is null when the end date leaves no room for one', () => {
    expect(firstExecutionDate({
      startDate: '2026-03-20', frequency: 'Monthly', dayOfExecution: 15, endDate: '2026-03-31',
    })).toBeNull();
  });
});

describe('the following executions', () => {
  it('walk the schedule, clamping each short month on the way', () => {
    const plan = { startDate: '2026-01-31', frequency: 'Monthly' as const, dayOfExecution: 31 };
    const dates: string[] = [];
    let current = firstExecutionDate(plan);
    while (current && dates.length < 5) {
      dates.push(current);
      current = nextExecutionDate(plan, current);
    }
    // Note the third: the series returns to the 31st rather than staying at February's 28th, which is what
    // anchoring to the first of the month buys.
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('stop at the end date', () => {
    const plan = { startDate: '2026-03-01', frequency: 'Monthly' as const, endDate: '2026-05-15' };
    expect(nextExecutionDate(plan, '2026-04-01')).toBe('2026-05-01');
    expect(nextExecutionDate(plan, '2026-05-01')).toBeNull();
  });

  it('treat an unparseable end date as no execution, not as open-ended', () => {
    // A typo must not become an open-ended authorisation to collect money.
    expect(nextExecutionDate({ startDate: '2026-03-01', frequency: 'Monthly', endDate: 'next year' }, '2026-03-01'))
      .toBeNull();
  });
});

describe('validation refuses rather than normalising', () => {
  it('accepts a workable schedule', () => {
    expect(validateSchedule({ startDate: '2026-03-01', frequency: 'Monthly', dayOfExecution: 15 })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(validateSchedule({ startDate: 'soon', frequency: 'Monthly' })).toBe('start_date_invalid');
    expect(validateSchedule({ startDate: '2026-03-01', endDate: 'later', frequency: 'Monthly' })).toBe('end_date_invalid');
    expect(validateSchedule({ startDate: '2026-03-01', endDate: '2026-02-01', frequency: 'Monthly' })).toBe('end_before_start');
    expect(validateSchedule({ startDate: '2026-03-01', frequency: 'Monthly', dayOfExecution: 0 })).toBe('day_of_execution_invalid');
    expect(validateSchedule({ startDate: '2026-03-01', frequency: 'Monthly', dayOfExecution: 32 })).toBe('day_of_execution_invalid');
  });

  it('refuses a schedule with no execution in its own range', () => {
    expect(validateSchedule({
      startDate: '2026-03-20', frequency: 'Monthly', dayOfExecution: 15, endDate: '2026-03-25',
    })).toBe('no_execution_in_range');
  });
});
