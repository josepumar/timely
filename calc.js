/**
 * calc.js — Pure calculation functions. No imports, no side effects.
 * Mirrors the Excel MROUND logic from the original timesheet.
 */

/**
 * Replicates Excel MROUND: round `value` to the nearest `multiple`.
 *   mround(9.25, 0.5) → 9.5
 *   mround(9.1,  0.5) → 9.0
 *   mround(0.75, 0.5) → 1.0
 */
export function mround(value, multiple) {
  if (multiple === 0) return 0;
  return Math.round(value / multiple) * multiple;
}

/** Parse "HH:MM" into total minutes from midnight. Returns NaN on bad input. */
function parseTime(str) {
  if (!str || typeof str !== 'string') return NaN;
  const [h, m] = str.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}

/**
 * Raw float hours between two "HH:MM" strings.
 * Returns 0 when either string is missing/invalid, or when out ≤ in.
 */
export function hoursFromTimes(timeIn, timeOut) {
  const inMin  = parseTime(timeIn);
  const outMin = parseTime(timeOut);
  if (isNaN(inMin) || isNaN(outMin)) return 0;
  const diff = (outMin - inMin) / 60;
  return diff < 0 ? 0 : diff;
}

/**
 * MROUND to nearest 0.5 hour — the core per-entry calculation.
 *   roundedHours('08:00', '17:15') → 9.5   (9.25 rounds up)
 *   roundedHours('08:00', '17:00') → 9.0
 *   roundedHours('',      '17:00') → 0
 */
export function roundedHours(timeIn, timeOut) {
  return mround(hoursFromTimes(timeIn, timeOut), 0.5);
}

/**
 * Sum rounded hours grouped by charge code ID.
 * @param {Array<{chargeCodeId: string, timeIn: string, timeOut: string}>} entries
 * @returns {{ [chargeCodeId: string]: number }}
 */
export function totalsByChargeCode(entries) {
  return entries.reduce((acc, e) => {
    if (!e.chargeCodeId) return acc;
    const h = roundedHours(e.timeIn, e.timeOut);
    acc[e.chargeCodeId] = (acc[e.chargeCodeId] ?? 0) + h;
    return acc;
  }, {});
}

/**
 * Full weekly summary.
 * @param {Array} entries
 * @param {number} [threshold=40]
 * @returns {{ total: number, regular: number, overtime: number, byCode: object }}
 */
export function weeklyTotals(entries, threshold = 40) {
  const byCode  = totalsByChargeCode(entries);
  const total   = Object.values(byCode).reduce((s, h) => s + h, 0);
  const regular = Math.min(total, threshold);
  const overtime = Math.max(0, total - threshold);
  return { total, regular, overtime, byCode };
}

/**
 * Build a day-labelled remarks string, one line per day that has a remark.
 * @param {Array<{dayOffset: number, remark: string}>} entries  dayOffset 0=Sat … 6=Fri
 * @returns {string}  e.g. "SAT: Fix door\nMON: Planning meeting"
 */
export function remarksRollup(entries) {
  const DAY_LABELS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
  const byDay = {};
  for (const e of entries) {
    const r = e.remark?.trim();
    if (r) {
      byDay[e.dayOffset] = byDay[e.dayOffset]
        ? byDay[e.dayOffset] + '; ' + r
        : r;
    }
  }
  return Object.keys(byDay)
    .sort((a, b) => Number(a) - Number(b))
    .map(d => `${DAY_LABELS[d]}: ${byDay[d]}`)
    .join('\n');
}

/** Format a number to one decimal place, e.g. 9 → "9.0", 9.5 → "9.5" */
export function fmtHours(n) {
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}
