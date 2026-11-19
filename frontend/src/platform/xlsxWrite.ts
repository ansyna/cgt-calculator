/**
 * Writing an Excel workbook (.xlsx) in the browser, without a library: a zip of XML files. It opens in Google Sheets
 * (upload it to Drive, or File → Import), Excel and Numbers. Each sheet's first row is its header, in bold; numbers
 * are kept as numbers, shown with two decimals.
 */

export type Cell = string | number | null;

export interface SheetData {
  /** Up to 31 characters, without [ ] : * ? / \ */
  name: string;
  rows: Cell[][];
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Response(data).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A zip of the files, deflated. */
export async function zip(files: Record<string, string>): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = new TextEncoder().encode(text);
    const packed = await deflateRaw(data);
    const nameBytes = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc32(data), true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, 8, true);
    entry.setUint32(16, crc32(data), true);
    entry.setUint32(20, packed.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, packed);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A column's letters: 0 is A, 26 is AA. */
export function column(i: number): string {
  let name = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Styles: 0 plain, 1 bold (a header), 2 a number with two decimals, 3 a bold number. */
const STYLES =
  `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * A workbook of the sheets: each sheet's first row bold (its header), and any row whose first cell starts with
 * "Total" bold too.
 */
export function writeXlsx(sheets: SheetData[]): Promise<ArrayBuffer> {
  const strings: string[] = [];
  const shared = new Map<string, number>();
  const files: Record<string, string> = {};
  sheets.forEach((sheet, n) => {
    const widths = new Map<number, number>();
    const rows = sheet.rows
      .map((cells, r) => {
        const bold = r === 0 || (typeof cells[0] === 'string' && cells[0].startsWith('Total'));
        const cs = cells
          .map((value, c) => {
            if (value === null || value === '') return '';
            const ref = `${column(c)}${r + 1}`;
            widths.set(c, Math.max(widths.get(c) ?? 8, Math.min(60, String(typeof value === 'number' ? value.toFixed(2) : value).length + 2)));
            if (typeof value === 'number') return `<c r="${ref}" s="${bold ? 3 : 2}"><v>${value}</v></c>`;
            let at = shared.get(value);
            if (at === undefined) {
              at = strings.push(value) - 1;
              shared.set(value, at);
            }
            return `<c r="${ref}" t="s"${bold ? ' s="1"' : ''}><v>${at}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cs}</row>`;
      })
      .join('');
    const cols = [...widths.entries()]
      .sort(([a], [b]) => a - b)
      .map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
      .join('');
    files[`xl/worksheets/sheet${n + 1}.xml`] =
      `${XML}<worksheet xmlns="${MAIN}">${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
  });
  files['[Content_Types].xml'] =
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, n) =>
          `<Override PartName="/xl/worksheets/sheet${n + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;
  files['_rels/.rels'] =
    `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml'] =
    `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
    sheets
      .map((s, n) => `<sheet name="${escape(s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`)
      .join('') +
    `</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] =
    `${XML}<Relationships xmlns="${PACKAGE_REL}">` +
    sheets.map((_, n) => `<Relationship Id="rId${n + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;
  files['xl/styles.xml'] = STYLES;
  files['xl/sharedStrings.xml'] =
    `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map((t) => `<si><t xml:space="preserve">${escape(t)}</t></si>`).join('') +
    `</sst>`;
  return zip(files);
}

/** Rows as tab-separated text, as a spreadsheet takes them pasted (Google Sheets, Excel). */
export function tabSeparated(rows: Cell[][]): string {
  return rows.map((cells) => cells.map((c) => (c === null ? '' : String(c).replace(/[\t\r\n]+/g, ' '))).join('\t')).join('\n');
}

/** Has the browser save the file under a name. */
export function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Has the browser save text as a CSV file: UTF-8 with its mark first, so Excel reads "Côte d'Ivoire" and "€" as they
 * are (Google Sheets and Numbers do anyway; every reader here takes the mark off).
 */
export function downloadCsv(name: string, text: string): void {
  saveFile(name, new Blob([text.startsWith('\uFEFF') ? text : `\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
}

/** Has the browser save the workbook as a file. */
export async function downloadXlsx(name: string, sheets: SheetData[]): Promise<void> {
  const blob = new Blob([await writeXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveFile(name.endsWith('.xlsx') ? name : `${name}.xlsx`, blob);
}
