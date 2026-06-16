import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  AirtableLinkRowSpill,
  type ISpillStorage,
  type ISpilledLinkRow,
} from './airtable-link-spill';

const row = (recordId: string, ids: string[]): ISpilledLinkRow => ({
  teableRecordId: recordId,
  cells: [{ airtableFieldId: 'fldLink', ids }],
});

const createMemoryStorage = () => {
  const objects = new Map<string, Buffer>();
  const storage: ISpillStorage = {
    upload: async (path, data) => {
      objects.set(path, data);
    },
    download: async (path) => Readable.from(objects.get(path) ?? Buffer.alloc(0)),
    cleanup: async (dir) => {
      for (const key of [...objects.keys()]) {
        if (key.startsWith(dir)) objects.delete(key);
      }
    },
  };
  return { storage, objects };
};

describe('AirtableLinkRowSpill', () => {
  it('fails with a clear error past the staging budget', async () => {
    const { storage } = createMemoryStorage();
    const spill = new AirtableLinkRowSpill(storage, 16);
    await expect(
      spill.append('tblA', [row('rec1', ['recX']), row('rec2', ['recY'])])
    ).rejects.toThrow(/TEABLE_IMPORT_SPILL_MAX_BYTES/);
  });

  it('streams appended rows back per table in order and cleans up', async () => {
    const { storage, objects } = createMemoryStorage();
    const spill = new AirtableLinkRowSpill(storage);
    await spill.append('tblA', [row('rec1', ['recX']), row('rec2', ['recY', 'recZ'])]);
    await spill.append('tblA', [row('rec3', ['recX'])]);
    await spill.append('tblB', [row('rec9', ['recQ'])]);

    const readAll = async (tableId: string) => {
      const rows: ISpilledLinkRow[] = [];
      for await (const item of spill.read(tableId)) {
        rows.push(item);
      }
      return rows;
    };

    const tableA = await readAll('tblA');
    expect(tableA.map((item) => item.teableRecordId)).toEqual(['rec1', 'rec2', 'rec3']);
    expect(tableA[1].cells[0].ids).toEqual(['recY', 'recZ']);
    expect(await readAll('tblB')).toHaveLength(1);
    // A table that never buffered anything yields nothing.
    expect(await readAll('tblC')).toHaveLength(0);

    expect(objects.size).toBeGreaterThan(0);
    await spill.cleanup();
    expect(objects.size).toBe(0);
  });
});
