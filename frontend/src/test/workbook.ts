/** A small Excel workbook (.xlsx) built for tests: each sheet's rows of cells (strings shared, numbers as they are). */
import { writeXlsx, zip } from '../platform/xlsxWrite';

export { zip };

/** A workbook of sheets, each rows of cells: numbers as numbers, text shared; null for an empty cell. */
export function workbook(sheets: Record<string, (string | number | null)[][]>): Promise<ArrayBuffer> {
  return writeXlsx(Object.entries(sheets).map(([name, rows]) => ({ name, rows })));
}
