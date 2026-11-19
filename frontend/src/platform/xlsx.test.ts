import { describe, expect, it } from 'vitest';
import { workbook, zip } from '../test/workbook';
import { excelDate, MAX_INFLATED, readXlsx } from './xlsx';

describe('reading an Excel workbook', () => {
  it('gives each sheet’s rows of cells: shared text, numbers as written, gaps kept', async () => {
    const data = await workbook({
      Trades: [
        ['Transactions', null, null, 'fees'],
        ['Title', 'Quantity', 'Date'],
        ['Acme & Co', 0.5, 44582],
      ],
      Other: [[null, 'B only']],
    });
    const sheets = await readXlsx(data);
    expect(sheets.map((s) => s.name)).toEqual(['Trades', 'Other']);
    expect(sheets[0].rows).toEqual([
      ['Transactions', '', '', 'fees'],
      ['Title', 'Quantity', 'Date'],
      ['Acme & Co', '0.5', '44582'],
    ]);
    expect(sheets[1].rows).toEqual([['', 'B only']]);
  });

  it('turns Excel’s day numbers into dates', () => {
    expect(excelDate('44600')).toBe('2022-02-08');
    expect(excelDate('46078.5')).toBe('2026-02-25');
    expect(excelDate('Buy')).toBeNull();
  });

  it('says when a file isn’t a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('not a zip at all, just text').buffer as ArrayBuffer)).rejects.toThrow(
      "This isn't an Excel workbook (.xlsx).",
    );
  });

  it('stops reading a file that inflates to more than a workbook could be', async () => {
    const bomb = await zip({ 'xl/workbook.xml': ' '.repeat(MAX_INFLATED + 1) });
    // a few kilobytes on disk
    expect(bomb.byteLength).toBeLessThan(200_000);
    await expect(readXlsx(bomb)).rejects.toThrow('The workbook is too big to read.');
  });
});
