import { describe, expect, it } from 'vitest';

import { byUrgency, urgencyOf } from './urgency';

const NOW = new Date('2026-08-16T12:00:00.000Z');

describe('urgencyOf', () => {
  it('describes a task with no deadline without inventing one', () => {
    expect(urgencyOf(null, NOW)).toEqual({ urgency: 'noDeadline', label: 'No deadline' });
  });

  it('marks a past deadline as overdue', () => {
    expect(urgencyOf('2026-08-14T12:00:00.000Z', NOW)).toEqual({
      urgency: 'overdue',
      label: 'Overdue by 2 days',
    });
  });

  it('says overdue today rather than overdue by 0 days', () => {
    // Rounding to whole days would otherwise produce "Overdue by 0 days"
    // for a deadline an hour ago, which reads as though nothing is wrong.
    expect(urgencyOf('2026-08-16T09:00:00.000Z', NOW)).toEqual({
      urgency: 'overdue',
      label: 'Overdue today',
    });
  });

  it('treats the next twenty-four hours as due today', () => {
    expect(urgencyOf('2026-08-17T09:00:00.000Z', NOW).urgency).toBe('dueSoon');
  });

  it('counts remaining days for anything further out', () => {
    expect(urgencyOf('2026-08-20T12:00:00.000Z', NOW)).toEqual({
      urgency: 'onTrack',
      label: 'Due in 4 days',
    });
  });

  it('gives every outcome a text label, never a bare colour', () => {
    // CLAUDE.md §3: status is never conveyed by colour alone, and this is
    // the queue's urgency indicator, which PRD.md §13.2 calls out by name.
    const dueDates = [
      null,
      '2026-08-14T12:00:00.000Z',
      '2026-08-17T09:00:00.000Z',
      '2026-08-30T12:00:00.000Z',
    ];
    for (const dueAt of dueDates) {
      expect(urgencyOf(dueAt, NOW).label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('byUrgency', () => {
  it('puts the earliest deadline first and undated work last', () => {
    const entries = [
      { dueAt: null, createdAt: '2026-08-01T00:00:00.000Z' },
      { dueAt: '2026-08-20T00:00:00.000Z', createdAt: '2026-08-02T00:00:00.000Z' },
      { dueAt: '2026-08-14T00:00:00.000Z', createdAt: '2026-08-03T00:00:00.000Z' },
    ];

    expect(byUrgency(entries).map((entry) => entry.dueAt)).toEqual([
      '2026-08-14T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z',
      null,
    ]);
  });

  it('does not mutate what it is given', () => {
    const entries = [
      { dueAt: '2026-08-20T00:00:00.000Z', createdAt: '2026-08-02T00:00:00.000Z' },
      { dueAt: '2026-08-14T00:00:00.000Z', createdAt: '2026-08-03T00:00:00.000Z' },
    ];
    byUrgency(entries);
    expect(entries[0]!.dueAt).toBe('2026-08-20T00:00:00.000Z');
  });
});
