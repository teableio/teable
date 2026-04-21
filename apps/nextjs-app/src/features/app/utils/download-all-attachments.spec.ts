import {
  getRecords,
  getRowCount,
  getShareViewRecords,
  getShareViewRowCount,
} from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAttachmentPreview } from './download-all-attachments';

vi.mock('@teable/openapi', () => ({
  getRecords: vi.fn(),
  getRowCount: vi.fn(),
  getShareViewRecords: vi.fn(),
  getShareViewRowCount: vi.fn(),
}));

const mockedGetRecords = vi.mocked(getRecords);
const mockedGetRowCount = vi.mocked(getRowCount);
const mockedGetShareViewRecords = vi.mocked(getShareViewRecords);
const mockedGetShareViewRowCount = vi.mocked(getShareViewRowCount);

const TABLE_ID = 'tblTest';
const FIELD_ID = 'fldAttachment';
const VIEW_ID = 'viwTest';
const SEARCH: [string, string, boolean] = ['keyword', 'all_fields', true];

describe('loadAllAttachments — search propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetRowCount.mockResolvedValue({ data: { rowCount: 1 } } as never);
    mockedGetRecords.mockResolvedValue({ data: { records: [] } } as never);
    mockedGetShareViewRowCount.mockResolvedValue({ data: { rowCount: 1 } } as never);
    mockedGetShareViewRecords.mockResolvedValue({ data: { records: [] } } as never);
  });

  it('forwards search to getRowCount and getRecords for a normal view', async () => {
    await getAttachmentPreview(TABLE_ID, FIELD_ID, VIEW_ID, undefined, { search: SEARCH });

    expect(mockedGetRowCount).toHaveBeenCalledWith(
      TABLE_ID,
      expect.objectContaining({ search: SEARCH })
    );
    expect(mockedGetRecords).toHaveBeenCalledWith(
      TABLE_ID,
      expect.objectContaining({ search: SEARCH })
    );
  });

  it('forwards search to getShareViewRowCount and getShareViewRecords for a share view', async () => {
    await getAttachmentPreview(TABLE_ID, FIELD_ID, VIEW_ID, 'shrTest', { search: SEARCH });

    expect(mockedGetShareViewRowCount).toHaveBeenCalledWith(
      'shrTest',
      expect.objectContaining({ search: SEARCH })
    );
    expect(mockedGetShareViewRecords).toHaveBeenCalledWith(
      'shrTest',
      expect.objectContaining({ search: SEARCH })
    );
  });

  it('omits search from the records query when none is provided', async () => {
    await getAttachmentPreview(TABLE_ID, FIELD_ID, VIEW_ID);

    expect(mockedGetRowCount).toHaveBeenCalledWith(
      TABLE_ID,
      expect.objectContaining({ search: undefined })
    );
    const recordsCallQuery = mockedGetRecords.mock.calls[0][1];
    expect(recordsCallQuery).not.toHaveProperty('search');
  });
});
