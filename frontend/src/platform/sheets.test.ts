import { describe, expect, it } from 'vitest';
import { readSheets } from './sheets';

const file = (text: string, name = 'list.csv') => new File([text], name, { type: 'text/csv' });

describe('a file read into rows', () => {
  it('finds the separator from the first lines, a title above the table aside', async () => {
    const [sheet] = await readSheets(file('﻿My trips\nCountry;Year;Places\nFrance;2024;Paris, Lyon\n'));
    expect(sheet.name).toBe('list.csv');
    expect(sheet.rows.slice(0, 3)).toEqual([['My trips'], ['Country', 'Year', 'Places'], ['France', '2024', 'Paris, Lyon']]);
  });

  it('reads tabs and commas, quoted values whole', async () => {
    expect((await readSheets(file('Country\tYear\nItaly\t2020')))[0].rows).toEqual([
      ['Country', 'Year'],
      ['Italy', '2020'],
    ]);
    expect((await readSheets(file('Country,Places\nSpain,"Madrid, Seville"')))[0].rows[1]).toEqual(['Spain', 'Madrid, Seville']);
  });

  it('refuses what it can’t read, saying what to do', async () => {
    await expect(readSheets(file('x', 'old.xls'))).rejects.toThrow('An old Excel file (.xls): save it as .xlsx or CSV first.');
    await expect(readSheets(file('x', 'scan.pdf'))).rejects.toThrow(/A PDF can’t be read here/);
    const big = { name: 'huge.csv', size: 11 * 1024 * 1024 } as File;
    await expect(readSheets(big, 'a list of trips')).rejects.toThrow('The file is too big (11 MB): a list of trips is well under 10 MB.');
  });
});
