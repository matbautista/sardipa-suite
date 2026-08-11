// Minimal CSV writer (Section 10 phase 16 / Section 5's "CSV export").
// Fields containing a comma, quote, or newline are quoted with internal
// quotes doubled (RFC 4180); everything else is written as-is. No
// external dependency — small, fixed rules, not worth a package for.

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
