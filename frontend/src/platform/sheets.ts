import { fields, readText } from './statement';
import { excelDate, readXlsx } from './xlsx';

/** What every file picker for a list takes: CSV (or text) and Excel, by ending and by type (a phone's picker goes by type). */
export const SPREADSHEET_ACCEPT =
  '.csv,.xlsx,.xls,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

/** A workbook chosen from an email app can come without its name's ending: its type says what it is. */
function named(file: File): File {
  return /spreadsheetml/.test(file.type) && !/\.xlsx$/i.test(file.name) ? new File([file], `${file.name}.xlsx`, { type: file.type }) : file;
}

/**
 * A file chosen to import, as rows of cells: an Excel workbook's sheets, each, or a CSV file's one (its values
 * separated by commas, semicolons or tabs). Old Excel files and PDFs are refused with what to do instead.
 */

/** A sheet's name and rows; a CSV file's one sheet is named after the file. */
export interface FileSheet {
  name: string;
  rows: string[][];
}

const MAX_FILE = 10 * 1024 * 1024;

/** The file's sheets; `what` says what a file of it holds, for the message when it's too big ("a list of expenses"). */
export async function readSheets(chosen: File, what = 'a list'): Promise<FileSheet[]> {
  const file = named(chosen);
  if (file.size > MAX_FILE) throw new Error(`The file is too big (${Math.round(file.size / 1024 / 1024)} MB): ${what} is well under 10 MB.`);
  if (/\.xlsx$/i.test(file.name)) {
    const data =
      typeof file.arrayBuffer === 'function'
        ? await file.arrayBuffer()
        : await new Promise<ArrayBuffer>((resolve, reject) => {
            // a browser (or test) without Blob.arrayBuffer
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error ?? new Error('The file couldn’t be read.'));
            reader.readAsArrayBuffer(file);
          });
    return (await readXlsx(data)).map((s) => ({ name: s.name, rows: s.rows }));
  }
  if (/\.xls$/i.test(file.name)) throw new Error('An old Excel file (.xls): save it as .xlsx or CSV first.');
  if (/\.pdf$/i.test(file.name)) throw new Error('A PDF can’t be read here: copy its table into a spreadsheet and save it as CSV or Excel.');
  const lines = (await readText(file)).replace(/^\uFEFF/, '').split(/\r?\n/);
  // the separator most used in the first lines (a title above the table has none)
  const head = lines
    .filter((l) => l.trim() !== '')
    .slice(0, 10)
    .join('\n');
  const count = (c: string) => head.split(c).length - 1;
  const separator = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  return [{ name: file.name, rows: lines.map((line) => fields(line, separator)) }];
}

/** Excel's day number with its time of day ("46313.5208…") as "2026-10-17 12:30:00"; null when it isn't one (or before 1955). */
function excelDateTime(text: string): string | null {
  const day = excelDate(text);
  if (!day || Number(text) < 20_000) return null;
  const seconds = Math.round((Number(text) % 1) * 86_400);
  if (seconds === 0 || seconds === 86_400) return day;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day} ${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** A column's heading that says it holds days ("Date", "Started Date", "Bought on", "Paid", "Time"). */
const DATED = /date|day|time|when|bought|sold|paid|vest|\bon$/i;

/**
 * A sheet's rows as CSV text, quoted where they need it, for a page that reads CSV: in the columns headed as days
 * (the first row with such a heading, in the first 40), Excel's day numbers (a date cell) as the dates they are, with
 * their time of day.
 */
export function sheetAsCsv(rows: string[][]): string {
  const headerAt = rows.findIndex((r, i) => i < 40 && r.some((c) => DATED.test(c)));
  const dated = headerAt < 0 ? [] : rows[headerAt].flatMap((c, i) => (DATED.test(c) ? [i] : []));
  return rows
    .map((row, r) =>
      row
        .map((c, i) => (r > headerAt && dated.includes(i) ? (excelDateTime(c) ?? c) : c))
        .map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    )
    .join('\n');
}

/** Whether a file chosen is a workbook (or a file to refuse with what to do instead: an old Excel file, a PDF). */
export const isWorkbook = (file: File) => /\.(xlsx|xls|pdf)$/i.test(named(file).name);

/**
 * A file chosen for a page that reads CSV, as CSV text: a CSV or text file as it is; an Excel workbook's sheet as
 * CSV (the first with anything in it, or the first that `fits`). An old Excel file or a PDF is refused (an Error with
 * what to do instead), as is one too big.
 */
export async function readAsCsv(file: File, what = 'a list', fits?: (csv: string) => boolean): Promise<string> {
  if (!isWorkbook(file)) return readText(file);
  const sheets = (await readSheets(file, what)).filter((s) => s.rows.some((r) => r.some((c) => c.trim() !== '')));
  if (sheets.length === 0) return '';
  const csvs = sheets.map((s) => sheetAsCsv(s.rows));
  return (fits && csvs.find(fits)) ?? csvs[0];
}
