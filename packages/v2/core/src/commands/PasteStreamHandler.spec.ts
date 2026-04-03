import { describe, expect, it } from 'vitest';

import type { IExecutionContext } from '../ports/ExecutionContext';
import { PasteStreamCommand } from './PasteStreamCommand';
import { PasteStreamHandler } from './PasteStreamHandler';
import type { PasteStreamApplicationService, PasteStreamEvent } from './PasteHandler';

describe('PasteStreamHandler', () => {
  const tableId = `tbl${'a'.repeat(16)}`;
  const viewId = `viw${'b'.repeat(16)}`;

  it('delegates to PasteStreamApplicationService.createStream', async () => {
    const stream: AsyncIterable<PasteStreamEvent> = {
      async *[Symbol.asyncIterator]() {
        yield {
          id: 'done',
          totalCount: 0,
          processedCount: 0,
          updatedCount: 0,
          createdCount: 0,
          data: {
            updatedCount: 0,
            createdCount: 0,
            createdRecordIds: [],
          },
        };
      },
    };

    const applicationService = {
      createStream: (_context: IExecutionContext, _command: PasteStreamCommand) => stream,
    } as Pick<PasteStreamApplicationService, 'createStream'> as PasteStreamApplicationService;

    const handler = new PasteStreamHandler(applicationService);
    const command = PasteStreamCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['A']],
    })._unsafeUnwrap();

    const result = await handler.handle({} as IExecutionContext, command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(stream);
  });
});
