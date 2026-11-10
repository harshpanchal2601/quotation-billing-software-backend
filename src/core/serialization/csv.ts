import { AppError } from '../errors/AppError.js';

export function csvCell(value: string): string {
  let start = 0;
  while (start < value.length && (value[start]!.trim() === '' || value.charCodeAt(start) < 32)) start++;
  const first = value[start];
  const formula = first !== undefined && '=+@-'.includes(first);
  const safe = formula && !/^-?\d+(?:\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export const csvDocument = (rows: readonly (readonly string[])[]) => `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

// Strict CSV with fixed size/row budgets; cells stay strings.
export function parseCsv(text: string, maxRows = 501): string[][] {
  const invalidControl = Array.from(text).some((char) => char.charCodeAt(0) < 32 && !['\t', '\r', '\n'].includes(char));
  if (Buffer.byteLength(text, 'utf8') > 512_000 || invalidControl) throw new AppError('CSV contains invalid data or exceeds 512 KB', 400);
  const input = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const field = () => { row.push(cell); cell = ''; closed = false; if (row.length > 30) throw new AppError('CSV has too many columns', 400); };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > maxRows) throw new AppError('CSV exceeds 500 data rows', 400); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',') field();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      record();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new AppError('Malformed CSV quoting', 400);
      cell += char;
    }
    if (cell.length > 20_000) throw new AppError('CSV cell exceeds its size limit', 400);
  }
  if (quoted) throw new AppError('Unterminated CSV field', 400);
  if (cell !== '' || row.length > 0 || closed) record();
  return rows;
}
