/**
 * timesheet-rows.js — Shared read-only rendering helpers used by both
 * admin-review.js and the submitted/approved states of employee.js.
 */

import { roundedHours, fmtHours } from '../calc.js';

const DAY_LABELS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

/**
 * Build HTML for a single read-only entry row.
 */
export function entryRowReadonlyHtml(entry, chargeCodes) {
  const cc  = chargeCodes.find(c => c.id === entry.chargeCodeId);
  const hrs = fmtHours(roundedHours(entry.timeIn, entry.timeOut));
  return `
    <div class="entry-row entry-row--readonly">
      <div class="entry-row__times">
        <span class="readonly-time">${esc(entry.timeIn)}</span>
        <span class="entry-row__sep">–</span>
        <span class="readonly-time">${esc(entry.timeOut)}</span>
        <span class="entry-row__hours">${hrs} h</span>
      </div>
      <div class="entry-row__meta">
        <span class="readonly-cc">${esc(cc?.code ?? '—')}</span>
        ${entry.remark ? `<span class="readonly-remark">${esc(entry.remark)}</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * Build the full read-only timesheet grid HTML (7 day rows).
 * @param {Array} entries
 * @param {Array} chargeCodes
 * @param {string} weekStart  ISO date of Saturday (used to compute day dates)
 * @returns {string} HTML string
 */
export function timesheetGridReadonlyHtml(entries, chargeCodes, weekStart) {
  const satDate = new Date(weekStart + 'T00:00:00');
  let html = '<div class="timesheet-grid">';

  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(satDate);
    dayDate.setDate(satDate.getDate() + d);
    const dayLabel    = DAY_LABELS[d];
    const dateStr     = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayEntries  = entries.filter(e => e.dayOffset === d);

    html += `
      <div class="day-row">
        <div class="day-row__header">
          <span class="day-row__label">${dayLabel}
            <span class="day-row__date">${dateStr}</span>
          </span>
        </div>
        <div class="day-row__entries">
          ${dayEntries.length === 0
            ? '<p class="day-row__empty">No entries</p>'
            : dayEntries.map(e => entryRowReadonlyHtml(e, chargeCodes)).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
