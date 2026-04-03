import type {
  IClearSelectionStreamEvent,
  IDeleteSelectionStreamEvent,
  IDuplicateSelectionStreamEvent,
  IPasteSelectionStreamEvent,
  IRangesRo,
  IPasteRo,
} from '@teable/openapi';
import { IdReturnType, RangeType } from '@teable/openapi';
import type { Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import type { Mocked } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../canary/interceptors/v2-indicator.interceptor';
import type { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import type { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { SelectionController } from './selection.controller';
import type { SelectionService } from './selection.service';

describe('SelectionController', () => {
  let controller: SelectionController;
  let selectionService: Mocked<
    Pick<SelectionService, 'clear' | 'delete' | 'getIdsFromRanges' | 'paste'>
  >;
  let recordOpenApiService: Mocked<Pick<RecordOpenApiService, 'duplicateRecord'>>;
  let recordOpenApiV2Service: Mocked<
    Pick<
      RecordOpenApiV2Service,
      'clearStream' | 'deleteByRangeStream' | 'duplicateByRangeStream' | 'pasteStream'
    >
  >;
  let cls: Mocked<Pick<ClsService<IClsStore>, 'get'>>;

  const rangesRo: IRangesRo = {
    viewId: 'viwTest',
    type: RangeType.Rows,
    ranges: [[0, 1]],
  };
  const pasteRo: IPasteRo = {
    viewId: 'viwTest',
    ranges: [
      [0, 0],
      [0, 1],
    ],
    content: [['A'], ['B']],
  };

  const createMockSseResponse = () =>
    ({
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      flush: vi.fn(),
    }) as unknown as Response & {
      setHeader: ReturnType<typeof vi.fn>;
      flushHeaders: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };

  const collectSseEvents = (response: ReturnType<typeof createMockSseResponse>) => {
    return response.write.mock.calls
      .map(([chunk]) => String(chunk))
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice(6).trim()));
  };

  beforeEach(() => {
    selectionService = {
      clear: vi.fn(),
      delete: vi.fn(),
      getIdsFromRanges: vi.fn(),
      paste: vi.fn(),
    };
    recordOpenApiService = {
      duplicateRecord: vi.fn(),
    };
    recordOpenApiV2Service = {
      clearStream: vi.fn(),
      deleteByRangeStream: vi.fn(),
      duplicateByRangeStream: vi.fn(),
      pasteStream: vi.fn(),
    };
    cls = {
      get: vi.fn(),
    };

    controller = new SelectionController(
      selectionService as unknown as SelectionService,
      recordOpenApiService as unknown as RecordOpenApiService,
      recordOpenApiV2Service as unknown as RecordOpenApiV2Service,
      cls as unknown as ClsService<IClsStore>
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('streams the legacy synchronous delete result when useV2 is false', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? false : undefined));
    selectionService.delete.mockResolvedValue({
      ids: ['recLegacy1', 'recLegacy2'],
    });
    const response = createMockSseResponse();

    await controller.deleteStream('tblLegacy', rangesRo, 'window-1', response as never);
    const events = collectSseEvents(response);

    expect(selectionService.delete).toHaveBeenCalledWith('tblLegacy', rangesRo, {
      windowId: 'window-1',
    });
    expect(recordOpenApiV2Service.deleteByRangeStream).not.toHaveBeenCalled();
    expect(response.flushHeaders).toHaveBeenCalled();
    expect(response.end).toHaveBeenCalled();
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 2,
        deletedCount: 0,
        batchDeletedCount: 0,
      },
      {
        id: 'done',
        totalCount: 2,
        deletedCount: 2,
        data: {
          deletedCount: 2,
          deletedRecordIds: ['recLegacy1', 'recLegacy2'],
        },
      },
    ]);
  });

  it('streams the legacy synchronous clear result when useV2 is false', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? false : undefined));
    selectionService.getIdsFromRanges.mockResolvedValue({
      recordIds: ['recLegacy1', 'recLegacy2'],
    } as never);
    selectionService.clear.mockResolvedValue(null as never);
    const response = createMockSseResponse();

    await controller.clearStream('tblLegacy', rangesRo, 'window-1', response as never);
    const events = collectSseEvents(response);

    expect(selectionService.getIdsFromRanges).toHaveBeenCalledWith('tblLegacy', {
      ...rangesRo,
      returnType: IdReturnType.RecordId,
    });
    expect(selectionService.clear).toHaveBeenCalledWith('tblLegacy', rangesRo, {
      windowId: 'window-1',
    });
    expect(recordOpenApiV2Service.clearStream).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 2,
        processedCount: 0,
        clearedCount: 0,
        batchProcessedCount: 0,
        batchClearedCount: 0,
      },
      {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        clearedCount: 2,
        data: {
          clearedCount: 2,
          clearedRecordIds: [],
        },
      },
    ]);
  });

  it('streams v2 clear events when useV2 is true', async () => {
    cls.get.mockImplementation((key) => {
      const values: Record<string, unknown> = {
        useV2: true,
        v2Reason: 'canary',
        v2Feature: 'clear',
      };
      return typeof key === 'string' ? values[key] : undefined;
    });
    const response = createMockSseResponse();

    async function* createStream(): AsyncIterable<IClearSelectionStreamEvent> {
      yield {
        id: 'progress',
        phase: 'clearing',
        batchIndex: 0,
        totalCount: 2,
        processedCount: 1,
        clearedCount: 1,
        batchProcessedCount: 1,
        batchClearedCount: 1,
      };
      yield {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        clearedCount: 2,
        data: {
          clearedCount: 2,
          clearedRecordIds: ['recV21', 'recV22'],
        },
      };
    }

    recordOpenApiV2Service.clearStream.mockResolvedValue(createStream());

    await controller.clearStream('tblV2', rangesRo, undefined, response as never);
    const events = collectSseEvents(response);

    expect(recordOpenApiV2Service.clearStream).toHaveBeenCalledWith('tblV2', rangesRo);
    expect(selectionService.clear).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_HEADER, 'true');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_REASON_HEADER, 'canary');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_FEATURE_HEADER, 'clear');
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'clearing',
        batchIndex: 0,
        totalCount: 2,
        processedCount: 1,
        clearedCount: 1,
        batchProcessedCount: 1,
        batchClearedCount: 1,
      },
      {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        clearedCount: 2,
        data: {
          clearedCount: 2,
          clearedRecordIds: ['recV21', 'recV22'],
        },
      },
    ]);
  });

  it('streams v2 delete events when useV2 is true', async () => {
    cls.get.mockImplementation((key) => {
      const values: Record<string, unknown> = {
        useV2: true,
        v2Reason: 'canary',
        v2Feature: 'deleteRecord',
      };
      return values[key];
    });
    const response = createMockSseResponse();

    async function* createStream(): AsyncIterable<IDeleteSelectionStreamEvent> {
      yield {
        id: 'progress',
        phase: 'deleting',
        batchIndex: 0,
        totalCount: 2,
        deletedCount: 1,
        batchDeletedCount: 1,
      };
      yield {
        id: 'done',
        totalCount: 2,
        deletedCount: 2,
        data: {
          deletedCount: 2,
          deletedRecordIds: ['recV21', 'recV22'],
        },
      };
    }

    recordOpenApiV2Service.deleteByRangeStream.mockResolvedValue(createStream());

    await controller.deleteStream('tblV2', rangesRo, undefined, response as never);
    const events = collectSseEvents(response);

    expect(recordOpenApiV2Service.deleteByRangeStream).toHaveBeenCalledWith('tblV2', rangesRo);
    expect(selectionService.delete).not.toHaveBeenCalled();
    expect(response.flushHeaders).toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_HEADER, 'true');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_REASON_HEADER, 'canary');
    expect(response.setHeader).toHaveBeenCalledWith(X_TEABLE_V2_FEATURE_HEADER, 'deleteRecord');
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'deleting',
        batchIndex: 0,
        totalCount: 2,
        deletedCount: 1,
        batchDeletedCount: 1,
      },
      {
        id: 'done',
        totalCount: 2,
        deletedCount: 2,
        data: {
          deletedCount: 2,
          deletedRecordIds: ['recV21', 'recV22'],
        },
      },
    ]);
  });

  it('converts stream failures into error events', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? true : undefined));

    async function* createFailingStream(): AsyncIterable<IDeleteSelectionStreamEvent> {
      yield* [];
      throw new Error('stream failed');
    }

    recordOpenApiV2Service.deleteByRangeStream.mockResolvedValue(createFailingStream());
    const response = createMockSseResponse();

    await controller.deleteStream('tblV2', rangesRo, undefined, response as never);
    const events = collectSseEvents(response);

    expect(events).toEqual([
      {
        id: 'error',
        phase: 'deleting',
        batchIndex: -1,
        totalCount: 0,
        deletedCount: 0,
        recordIds: [],
        message: 'stream failed',
      },
    ]);
  });

  it('streams the legacy synchronous duplicate result when useV2 is false', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? false : undefined));
    selectionService.getIdsFromRanges.mockResolvedValue({
      recordIds: ['recSource1', 'recSource2'],
    });
    recordOpenApiService.duplicateRecord
      .mockResolvedValueOnce({ id: 'recCopy1' } as never)
      .mockResolvedValueOnce({ id: 'recCopy2' } as never);
    const response = createMockSseResponse();

    await controller.duplicateStream('tblLegacy', rangesRo, response as never);
    const events = collectSseEvents(response);

    expect(selectionService.getIdsFromRanges).toHaveBeenCalledWith('tblLegacy', {
      ...rangesRo,
      returnType: IdReturnType.RecordId,
    });
    expect(recordOpenApiService.duplicateRecord).toHaveBeenNthCalledWith(
      1,
      'tblLegacy',
      'recSource1',
      {
        viewId: rangesRo.viewId,
        anchorId: 'recSource2',
        position: 'after',
      },
      undefined
    );
    expect(recordOpenApiService.duplicateRecord).toHaveBeenNthCalledWith(
      2,
      'tblLegacy',
      'recSource2',
      {
        viewId: rangesRo.viewId,
        anchorId: 'recCopy1',
        position: 'after',
      },
      undefined
    );
    expect(recordOpenApiV2Service.duplicateByRangeStream).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 2,
        duplicatedCount: 0,
        batchDuplicatedCount: 0,
      },
      {
        id: 'progress',
        phase: 'duplicating',
        batchIndex: 0,
        totalCount: 2,
        duplicatedCount: 1,
        batchDuplicatedCount: 1,
      },
      {
        id: 'progress',
        phase: 'duplicating',
        batchIndex: 1,
        totalCount: 2,
        duplicatedCount: 2,
        batchDuplicatedCount: 1,
      },
      {
        id: 'done',
        totalCount: 2,
        duplicatedCount: 2,
        data: {
          duplicatedCount: 2,
          duplicatedRecordIds: ['recCopy1', 'recCopy2'],
        },
      },
    ]);
  });

  it('streams v2 duplicate events when useV2 is true', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? true : undefined));

    async function* createStream(): AsyncIterable<IDuplicateSelectionStreamEvent> {
      yield {
        id: 'progress',
        phase: 'duplicating',
        batchIndex: 0,
        totalCount: 2,
        duplicatedCount: 1,
        batchDuplicatedCount: 1,
      };
      yield {
        id: 'done',
        totalCount: 2,
        duplicatedCount: 2,
        data: {
          duplicatedCount: 2,
          duplicatedRecordIds: ['recCopy1', 'recCopy2'],
        },
      };
    }

    recordOpenApiV2Service.duplicateByRangeStream.mockResolvedValue(createStream());
    const response = createMockSseResponse();

    await controller.duplicateStream('tblV2', rangesRo, response as never);
    const events = collectSseEvents(response);

    expect(recordOpenApiV2Service.duplicateByRangeStream).toHaveBeenCalledWith('tblV2', rangesRo);
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'duplicating',
        batchIndex: 0,
        totalCount: 2,
        duplicatedCount: 1,
        batchDuplicatedCount: 1,
      },
      {
        id: 'done',
        totalCount: 2,
        duplicatedCount: 2,
        data: {
          duplicatedCount: 2,
          duplicatedRecordIds: ['recCopy1', 'recCopy2'],
        },
      },
    ]);
  });

  it('streams the legacy synchronous paste result when useV2 is false', async () => {
    cls.get.mockImplementation((key) => (key === 'useV2' ? false : undefined));
    selectionService.paste.mockResolvedValue([
      [0, 0],
      [0, 1],
    ]);
    const response = createMockSseResponse();

    await controller.pasteStream('tblLegacy', pasteRo, 'window-2', response as never);
    const events = collectSseEvents(response);

    expect(selectionService.paste).toHaveBeenCalledWith('tblLegacy', pasteRo, {
      windowId: 'window-2',
    });
    expect(recordOpenApiV2Service.pasteStream).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount: 2,
        processedCount: 0,
        updatedCount: 0,
        createdCount: 0,
        batchProcessedCount: 0,
      },
      {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        updatedCount: 0,
        createdCount: 0,
        data: {
          updatedCount: 0,
          createdCount: 0,
          createdRecordIds: [],
          ranges: [
            [0, 0],
            [0, 1],
          ],
        },
      },
    ]);
  });

  it('streams v2 paste events when useV2 is true', async () => {
    cls.get.mockImplementation((key) => {
      const values: Record<string, unknown> = {
        useV2: true,
      };
      return values[key];
    });

    async function* createStream(): AsyncIterable<IPasteSelectionStreamEvent> {
      yield {
        id: 'progress',
        phase: 'pasting',
        batchIndex: 0,
        totalCount: 2,
        processedCount: 1,
        updatedCount: 1,
        createdCount: 0,
        batchProcessedCount: 1,
      };
      yield {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        updatedCount: 1,
        createdCount: 1,
        data: {
          updatedCount: 1,
          createdCount: 1,
          createdRecordIds: ['recPaste1'],
        },
      };
    }

    recordOpenApiV2Service.pasteStream.mockResolvedValue(createStream());
    const response = createMockSseResponse();

    await controller.pasteStream('tblV2', pasteRo, undefined, response as never);
    const events = collectSseEvents(response);

    expect(recordOpenApiV2Service.pasteStream).toHaveBeenCalledWith('tblV2', pasteRo, {
      windowId: undefined,
    });
    expect(events).toEqual([
      {
        id: 'progress',
        phase: 'pasting',
        batchIndex: 0,
        totalCount: 2,
        processedCount: 1,
        updatedCount: 1,
        createdCount: 0,
        batchProcessedCount: 1,
      },
      {
        id: 'done',
        totalCount: 2,
        processedCount: 2,
        updatedCount: 1,
        createdCount: 1,
        data: {
          updatedCount: 1,
          createdCount: 1,
          createdRecordIds: ['recPaste1'],
        },
      },
    ]);
  });
});
