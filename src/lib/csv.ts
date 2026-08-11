// Minimal CSV writer (Section 10 phase 16 / Section 5's "CSV export").
// Fields containing a comma, quote, or newline are quoted with internal
// quotes doubled (RFC 4180); everything else is written as-is. No
// external dependency — small, fixed rules, not worth a package for.

// CSV/formula-injection mitigation (found missing in a full-app review):
// exported fields include attacker-influenced free text (Lead.notes/name
// can come from an unparsed inquiry-email body via email-intake.ts), so a
// cell like `=HYPERLINK("http://evil","click")` would otherwise execute
// as a formula when the export is opened in Excel/Sheets instead of being
// treated as inert text. Standard mitigation (OWASP CSV Injection): a
// leading apostrophe forces spreadsheet apps to read the cell as text.
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (str.length > 0 && FORMULA_TRIGGER_CHARS.has(str[0])) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
