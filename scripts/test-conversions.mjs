import assert from "node:assert/strict";

const PROPERTY_TYPES = { DATE: "Date", DATETIME: "Date & time" };
function pad2(value) { return String(value).padStart(2, "0"); }
function formatDateParts(year, month, day) { return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`; }
function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function isValidTimeParts(hour, minute, second) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59 && Number.isInteger(second) && second >= 0 && second <= 59;
}
function parseIsoLikeDateTime(text) {
  const match = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return { ok: false };
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return { ok: false };
  const date = formatDateParts(year, month, day);
  if (!match[4]) return { ok: true, date, hasTime: false };
  const hour = Number(match[4]), minute = Number(match[5]), second = match[6] === undefined ? 0 : Number(match[6]);
  if (!isValidTimeParts(hour, minute, second)) return { ok: false };
  return { ok: true, date, hasTime: true, datetime: `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}` };
}
function parseDateParts(text, format) {
  if (format === "ymd") {
    const match = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { ok: false };
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    return isValidDateParts(year, month, day) ? { ok: true, year, month, day } : { ok: false };
  }
  const match = String(text || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return { ok: false };
  const first = Number(match[1]), second = Number(match[2]), year = Number(match[3]);
  const month = format === "dmy" ? second : first;
  const day = format === "dmy" ? first : second;
  return isValidDateParts(year, month, day) ? { ok: true, year, month, day } : { ok: false };
}
function isBlankPropertyValue(value) { return value === null || value === undefined || (typeof value === "string" && value.trim() === ""); }
function convertValueToDate(value, options = {}) {
  if (isBlankPropertyValue(value)) return { ok: true, value };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  const isoDateTime = parseIsoLikeDateTime(text);
  if (isoDateTime.ok) return { ok: true, value: isoDateTime.date };
  const sourceFormat = options.dateSourceFormat || "auto";
  for (const fmt of [sourceFormat]) {
    if ((fmt === "auto" || fmt === "ymd") && parseDateParts(text, "ymd").ok) {
      const p = parseDateParts(text, "ymd"); return { ok: true, value: formatDateParts(p.year, p.month, p.day) };
    }
    if (fmt === "dmy" && parseDateParts(text, "dmy").ok) { const p = parseDateParts(text, "dmy"); return { ok: true, value: formatDateParts(p.year, p.month, p.day) }; }
    if (fmt === "mdy" && parseDateParts(text, "mdy").ok) { const p = parseDateParts(text, "mdy"); return { ok: true, value: formatDateParts(p.year, p.month, p.day) }; }
  }
  return { ok: false };
}
function convertValueToDateTime(value, options = {}) {
  if (isBlankPropertyValue(value)) return { ok: true, value };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  const parsedDateTime = parseIsoLikeDateTime(text);
  if (parsedDateTime.ok && parsedDateTime.hasTime) return { ok: true, value: parsedDateTime.datetime };
  if (parseDateParts(text, "ymd").ok) return options.dateOnlyToMidnight ? { ok: true, value: `${text}T00:00:00` } : { ok: false };
  return { ok: false };
}
function convertValueToPropertyType(value, type, options = {}) { return type === PROPERTY_TYPES.DATE ? convertValueToDate(value, options) : convertValueToDateTime(value, options); }

const cases = [
  ["date", "2026-07-15", {}, true, "2026-07-15"],
  ["date", "2026-07-15T13:45:22", {}, true, "2026-07-15"],
  ["date", "2026-07-15 13:45:22", {}, true, "2026-07-15"],
  ["date", "15/07/2026", {}, false],
  ["date", "15/07/2026", { dateSourceFormat: "dmy" }, true, "2026-07-15"],
  ["date", "07/15/2026", { dateSourceFormat: "mdy" }, true, "2026-07-15"],
  ["date", "2026-02-30", {}, false],
  ["date", "", {}, true, ""],
  ["date", "arbitrary text", {}, false],
  ["datetime", "2026-07-15T13:45", {}, true, "2026-07-15T13:45:00"],
  ["datetime", "2026-07-15T13:45:22", {}, true, "2026-07-15T13:45:22"],
  ["datetime", "2026-07-15 13:45:22", {}, true, "2026-07-15T13:45:22"],
  ["datetime", "2026-07-15", {}, false],
  ["datetime", "2026-07-15", { dateOnlyToMidnight: true }, true, "2026-07-15T00:00:00"]
];
for (const [kind, input, options, ok, expected] of cases) {
  const result = convertValueToPropertyType(input, kind === "date" ? PROPERTY_TYPES.DATE : PROPERTY_TYPES.DATETIME, options);
  assert.equal(result.ok, ok, `${kind} ${input} ok`);
  if (ok) assert.equal(result.value, expected, `${kind} ${input} value`);
}
