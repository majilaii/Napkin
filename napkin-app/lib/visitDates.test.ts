import { compareVisitRecords, knownVisitDate, visitDateLabel, visitOrderDate } from './visitDates';

test('unknown dates stay explicit and never display the epoch or record date', () => {
    expect(knownVisitDate(null)).toBeNull();
    expect(visitDateLabel(null)).toBe('no date');
    expect(visitDateLabel('not-a-date')).toBe('no date');
    expect(visitOrderDate({ visited_at: null, created_at: '2026-09-05' })).toBe('2026-09-05');
});

test('record order remains stable after an old visit date is added', () => {
    const first = { id: 'a', created_at: '2026-09-04', visited_at: '2026-09-04' };
    const second = { id: 'b', created_at: '2026-09-05', visited_at: null as string | null };
    expect([first, second].sort(compareVisitRecords).map((row) => row.id)).toEqual(['b', 'a']);
    second.visited_at = '2019-02-01';
    expect([first, second].sort(compareVisitRecords).map((row) => row.id)).toEqual(['b', 'a']);
});
