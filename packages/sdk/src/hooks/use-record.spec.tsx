import type { IFieldVo, IRecord } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { getRecord, getShareViewRecords } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { createFieldInstance } from '../model/field/factory';
import { useConnection } from './use-connection';
import { useFields } from './use-fields';
import { useRecord } from './use-record';

vi.mock('@teable/openapi', async () => {
  const actual = await vi.importActual<typeof OpenApi>('@teable/openapi');
  return {
    ...actual,
    getRecord: vi.fn(),
    getShareViewRecords: vi.fn(),
  };
});
vi.mock('./use-connection', () => ({ useConnection: vi.fn() }));
vi.mock('./use-fields', () => ({ useFields: vi.fn() }));
vi.mock('./use-table-id', () => ({ useTableId: vi.fn(() => 'tblTest') }));

const recordId = 'recTest0000000001';
const visibleFieldId = 'fldVisible0000001';
const hiddenFieldId = 'fldHidden00000001';

const createTextField = (id: string, name: string) =>
  createFieldInstance({
    id,
    name,
    dbFieldName: name,
    type: FieldType.SingleLineText,
    options: {},
    unique: false,
    isPrimary: id === visibleFieldId,
    cellValueType: CellValueType.String,
    dbFieldType: DbFieldType.Text,
  } as IFieldVo);

const visibleField = createTextField(visibleFieldId, 'Visible');

const createRecord = (fields: IRecord['fields']): IRecord =>
  ({
    id: recordId,
    fields,
  }) as IRecord;

const createDoc = (data: IRecord) => {
  const listeners = new Set<() => void>();
  return {
    data,
    fetch: vi.fn((callback: (error?: Error) => void) => callback()),
    subscribe: vi.fn((callback: (error?: Error) => void) => callback()),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'op batch') listeners.add(listener);
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'op batch') listeners.delete(listener);
    }),
    listenerCount: vi.fn(() => listeners.size),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
    emitOp: () => listeners.forEach((listener) => listener()),
  };
};

const shareWrapper = ({ children }: { children: ReactNode }) => (
  <ShareViewContext.Provider value={{ shareId: 'shrTest', tableId: 'tblTest' } as never}>
    {children}
  </ShareViewContext.Provider>
);
shareWrapper.displayName = 'ShareWrapper';

// a linked-record expand keeps the outer share context but anchors a foreign
// table (useTableId is mocked to 'tblTest', the share is bound to another)
const foreignShareWrapper = ({ children }: { children: ReactNode }) => (
  <ShareViewContext.Provider value={{ shareId: 'shrTest', tableId: 'tblShareBound' } as never}>
    {children}
  </ShareViewContext.Provider>
);
foreignShareWrapper.displayName = 'ForeignShareWrapper';

describe('useRecord hidden-field hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // the fieldMap only carries view-visible fields; hidden values pass
    // through the merge by id regardless
    vi.mocked(useFields).mockReturnValue([visibleField]);
  });

  it('hydrates hidden readable values without widening the projected ShareDB document', async () => {
    const projectedRecord = createRecord({ [visibleFieldId]: 'visible value' });
    const doc = createDoc(projectedRecord);
    vi.mocked(useConnection).mockReturnValue({
      connection: { get: vi.fn(() => doc) } as never,
      connected: true,
    });
    vi.mocked(getRecord).mockResolvedValue({
      data: createRecord({
        [visibleFieldId]: 'visible value',
        [hiddenFieldId]: 'hidden value',
      }),
    } as never);

    const { result } = renderHook(() => useRecord(recordId, undefined, { withHidden: true }));

    await waitFor(() => expect(result.current?.getCellValue(hiddenFieldId)).toBe('hidden value'));
    expect(getRecord).toHaveBeenCalledWith('tblTest', recordId, { fieldKeyType: 'id' });
    expect(doc.data.fields).toEqual({ [visibleFieldId]: 'visible value' });
  });

  it('prefers live ShareDB values, including null, over hydrated values', async () => {
    const doc = createDoc(createRecord({ [visibleFieldId]: 'visible value' }));
    vi.mocked(useConnection).mockReturnValue({
      connection: { get: vi.fn(() => doc) } as never,
      connected: true,
    });
    vi.mocked(getRecord).mockResolvedValue({
      data: createRecord({ [hiddenFieldId]: 'hydrated value' }),
    } as never);

    const { result } = renderHook(() => useRecord(recordId, undefined, { withHidden: true }));
    await waitFor(() => expect(result.current?.getCellValue(hiddenFieldId)).toBe('hydrated value'));

    act(() => {
      doc.data.fields[hiddenFieldId] = 'live value';
      doc.emitOp();
    });
    expect(result.current?.getCellValue(hiddenFieldId)).toBe('live value');

    act(() => {
      doc.data.fields[hiddenFieldId] = null;
      doc.emitOp();
    });
    expect(result.current?.getCellValue(hiddenFieldId)).toBeNull();
  });

  it('hydrates through the share endpoint in a share view', async () => {
    const doc = createDoc(createRecord({ [visibleFieldId]: 'visible value' }));
    vi.mocked(useConnection).mockReturnValue({
      connection: { get: vi.fn(() => doc) } as never,
      connected: true,
    });
    vi.mocked(getShareViewRecords).mockResolvedValue({
      data: {
        records: [createRecord({ [hiddenFieldId]: 'shared hidden value' })],
      },
    } as never);

    const { result } = renderHook(() => useRecord(recordId, undefined, { withHidden: true }), {
      wrapper: shareWrapper,
    });

    await waitFor(() =>
      expect(result.current?.getCellValue(hiddenFieldId)).toBe('shared hidden value')
    );
    expect(getShareViewRecords).toHaveBeenCalledWith('shrTest', {
      fieldKeyType: 'id',
      selectedRecordIds: [recordId],
      take: 1,
    });
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('skips hydration for a linked record from a table outside the share scope', async () => {
    const doc = createDoc(createRecord({ [visibleFieldId]: 'visible value' }));
    vi.mocked(useConnection).mockReturnValue({
      connection: { get: vi.fn(() => doc) } as never,
      connected: true,
    });

    const { result } = renderHook(() => useRecord(recordId, undefined, { withHidden: true }), {
      wrapper: foreignShareWrapper,
    });

    await waitFor(() => expect(result.current?.getCellValue(visibleFieldId)).toBe('visible value'));
    expect(getShareViewRecords).not.toHaveBeenCalled();
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('keeps default callers on the visible ShareDB record without an HTTP hydration request', async () => {
    const doc = createDoc(createRecord({ [visibleFieldId]: 'visible value' }));
    vi.mocked(useConnection).mockReturnValue({
      connection: { get: vi.fn(() => doc) } as never,
      connected: true,
    });

    const { result } = renderHook(() => useRecord(recordId));

    await waitFor(() => expect(result.current?.getCellValue(visibleFieldId)).toBe('visible value'));
    expect(getRecord).not.toHaveBeenCalled();
    expect(getShareViewRecords).not.toHaveBeenCalled();
  });
});
