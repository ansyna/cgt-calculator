/**
 * Reading an Excel workbook (.xlsx) in the browser, without a library: it's a zip of XML files. Each sheet comes back
 * as rows of cell texts (numbers as written, dates as Excel's day numbers, formulas as their last value), for the apps
 * that import spreadsheets. Nothing is sent anywhere.
 */

export interface Sheet {
  name: string;
  /** Rows of cells, by column (A is 0); empty cells are ''. */
  rows: string[][];
}

/** The most a workbook's file is inflated to: more than any spreadsheet of trades, less than a zip bomb. */
export const MAX_INFLATED = 50 * 1024 * 1024;

/** A deflated file's bytes, refused once it's bigger than {@link MAX_INFLATED}. */
async function inflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const reader = new Response(raw).body!.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      await reader.cancel();
      throw new Error('The workbook is too big to read.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The zip's files, by name: their bytes, inflated; only the workbook's XML (not its pictures, say). */
async function unzip(data: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  // the end of the central directory: its signature, searched for from the end (a comment may follow it)
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This isn't an Excel workbook (.xlsx).");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('The workbook is damaged.');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (!/^xl\/.*\.(xml|rels)$/.test(name)) continue;
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
  }
  return files;
}

function xml(files: Map<string, Uint8Array>, name: string): Document | null {
  const bytes = files.get(name);
  return bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') : null;
}

/** The elements named so, whatever their namespace. */
const all = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));

/** "C7" → 2 */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** The workbook's sheets, in order. */
export async function readXlsx(data: ArrayBuffer): Promise<Sheet[]> {
  const files = await unzip(data);
  const strings = (() => {
    const doc = xml(files, 'xl/sharedStrings.xml');
    return doc
      ? all(doc, 'si').map((si) =>
          all(si, 't')
            .map((t) => t.textContent ?? '')
            .join(''),
        )
      : [];
  })();
  const workbook = xml(files, 'xl/workbook.xml');
  const rels = xml(files, 'xl/_rels/workbook.xml.rels');
  if (!workbook) throw new Error("This isn't an Excel workbook (.xlsx).");
  const targets = new Map((rels ? all(rels, 'Relationship') : []).map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const sheets: Sheet[] = [];
  for (const [i, sheet] of all(workbook, 'sheet').entries()) {
    const id = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id) ?? `worksheets/sheet${i + 1}.xml`;
    const doc = xml(files, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (!doc) continue;
    const rows: string[][] = [];
    for (const row of all(doc, 'row')) {
      const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
      const cells: string[] = [];
      for (const c of all(row, 'c')) {
        const type = c.getAttribute('t');
        const value = all(c, 'v')[0]?.textContent ?? '';
        const text =
          type === 's'
            ? (strings[Number(value)] ?? '')
            : type === 'inlineStr'
              ? all(c, 't')
                  .map((t) => t.textContent ?? '')
                  .join('')
              : type === 'e'
                ? ''
                : value;
        cells[columnOf(c.getAttribute('r') ?? '')] = text;
      }
      rows[r] = Array.from(cells, (cell) => cell ?? '');
    }
    sheets.push({ name: sheet.getAttribute('name') ?? `Sheet${i + 1}`, rows: Array.from(rows, (row) => row ?? []) });
  }
  return sheets;
}

/** Excel's day number (from 30 December 1899) as a date: "44600" → "2022-02-08"; null when it isn't one. */
export function excelDate(text: string): string | null {
  const days = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text.trim()) || days < 1 || days > 2_958_465) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(days) * 86_400_000).toISOString().slice(0, 10);
}
