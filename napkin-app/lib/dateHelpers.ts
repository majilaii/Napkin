/** Returns today as YYYY-MM-DD in local time. */
export function getTodayDateStr(): string {
    return localDateStr(new Date());
}

/** Returns yesterday as YYYY-MM-DD in local time. */
export function getYesterdayDateStr(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDateStr(d);
}

/** Convert a Date to YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
