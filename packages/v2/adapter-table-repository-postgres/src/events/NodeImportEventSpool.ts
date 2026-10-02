import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import {
  BaseId,
  FieldId,
  FieldOptionsAdded,
  FieldUpdated,
  OccurredAt,
  RecordsBatchCreated,
  TableCreated,
  TableId,
  TableName,
  ViewId,
  domainError,
  type DomainError,
  type IDomainEvent,
  type IImportEventSpool,
  type IImportEventSpoolFactory,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

type EventBody =
  | {
      kind: 'records';
      value: Omit<Parameters<typeof RecordsBatchCreated.create>[0], 'tableId' | 'baseId'>;
    }
  | { kind: 'table'; value: { tableName: string; fieldIds: string[]; viewIds: string[] } }
  | {
      kind: 'field';
      value: Omit<Parameters<typeof FieldUpdated.create>[0], 'tableId' | 'baseId' | 'fieldId'> & {
        fieldId: string;
      };
    }
  | {
      kind: 'options';
      value: Omit<
        Parameters<typeof FieldOptionsAdded.create>[0],
        'tableId' | 'baseId' | 'fieldId' | 'options'
      > & { fieldId: string; options: FieldOptionsAdded['options'] };
    };

type StoredEvent = {
  baseId: string;
  tableId: string;
  occurredAt: Date;
  requestId?: string;
  body: EventBody;
};

// This spool is deliberately limited to the events emitted by tabular imports. Unlike the
// durable projection codec it must preserve every cell, including undefined and long values.
const snapshot = (event: IDomainEvent): Result<StoredEvent, DomainError> => {
  const requestId = event.requestId;
  let body: EventBody;
  if (event instanceof RecordsBatchCreated) {
    body = {
      kind: 'records',
      value: {
        records: event.records,
        source: event.source,
        orchestration: event.orchestration,
        auditSource: event.auditSource,
      },
    };
  } else if (event instanceof TableCreated) {
    body = {
      kind: 'table',
      value: {
        tableName: event.tableName.toString(),
        fieldIds: event.fieldIds.map((id) => id.toString()),
        viewIds: event.viewIds.map((id) => id.toString()),
      },
    };
  } else if (event instanceof FieldUpdated) {
    body = {
      kind: 'field',
      value: {
        fieldId: event.fieldId.toString(),
        updatedProperties: event.updatedProperties,
        changes: event.changes,
        propertySemantics: event.propertySemantics,
        oldVersion: event.oldVersion,
        newVersion: event.newVersion,
      },
    };
  } else if (event instanceof FieldOptionsAdded) {
    body = {
      kind: 'options',
      value: {
        fieldId: event.fieldId.toString(),
        options: event.options,
        oldVersion: event.oldVersion,
        newVersion: event.newVersion,
      },
    };
  } else {
    return err(
      domainError.infrastructure({
        code: 'import.event_snapshot_unsupported',
        message: `Cannot snapshot import event ${event.name.toString()}`,
      })
    );
  }
  return ok({
    baseId: event.baseId.toString(),
    tableId: event.tableId.toString(),
    occurredAt: event.occurredAt.toDate(),
    requestId,
    body,
  });
};

const restore = (stored: StoredEvent): Result<IDomainEvent, DomainError> =>
  safeTry(function* () {
    const baseId = yield* BaseId.create(stored.baseId);
    const tableId = yield* TableId.create(stored.tableId);
    const occurredAt = yield* OccurredAt.create(stored.occurredAt);
    const { body } = stored;
    let event: IDomainEvent;
    switch (body.kind) {
      case 'records':
        event = RecordsBatchCreated.create({ ...body.value, baseId, tableId });
        break;
      case 'table': {
        const fieldIds: FieldId[] = [];
        const viewIds: ViewId[] = [];
        for (const id of body.value.fieldIds) fieldIds.push(yield* FieldId.create(id));
        for (const id of body.value.viewIds) viewIds.push(yield* ViewId.create(id));
        event = TableCreated.create({
          baseId,
          tableId,
          tableName: yield* TableName.create(body.value.tableName),
          fieldIds,
          viewIds,
        });
        break;
      }
      case 'field':
        event = FieldUpdated.create({
          ...body.value,
          baseId,
          tableId,
          fieldId: yield* FieldId.create(body.value.fieldId),
        });
        break;
      case 'options':
        event = FieldOptionsAdded.create({
          ...body.value,
          baseId,
          tableId,
          fieldId: yield* FieldId.create(body.value.fieldId),
        });
        break;
    }
    return ok(Object.assign(event, { occurredAt, requestId: stored.requestId }));
  });

export class NodeImportEventSpoolFactory implements IImportEventSpoolFactory {
  constructor(private readonly rootDirectory = tmpdir()) {}

  async create(): Promise<Result<IImportEventSpool, DomainError>> {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(this.rootDirectory, 'teable-import-events-'));
      const file = await open(join(directory, 'snapshots'), 'wx+', 0o600);
      return ok(new NodeImportEventSpool(directory, file));
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true });
      return err(domainError.fromUnknown(error, { code: 'import.event_spool_create_failed' }));
    }
  }
}

class NodeImportEventSpool implements IImportEventSpool {
  private byteLength = 0;

  constructor(
    private readonly directory: string,
    private readonly file: FileHandle
  ) {}

  async append(events: ReadonlyArray<IDomainEvent>): Promise<Result<void, DomainError>> {
    try {
      const stored: StoredEvent[] = [];
      for (const event of events) {
        const result = snapshot(event);
        if (result.isErr()) return err(result.error);
        stored.push(result.value);
      }
      const bytes = serialize(stored);
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32LE(bytes.length);
      await this.file.writeFile(header);
      await this.file.writeFile(bytes);
      this.byteLength += header.length + bytes.length;
      return ok(undefined);
    } catch (error) {
      return err(domainError.fromUnknown(error, { code: 'import.event_spool_write_failed' }));
    }
  }

  async *read(): AsyncIterable<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    try {
      let position = 0;
      while (position < this.byteLength) {
        const header = Buffer.allocUnsafe(4);
        await this.readExactly(header, position);
        position += header.length;
        const length = header.readUInt32LE();
        if (length > this.byteLength - position) {
          yield err(
            domainError.infrastructure({
              code: 'import.event_spool_truncated',
              message: 'Incomplete import event snapshot',
            })
          );
          return;
        }
        const bytes = Buffer.allocUnsafe(length);
        await this.readExactly(bytes, position);
        position += length;
        const events: IDomainEvent[] = [];
        for (const stored of deserialize(bytes) as StoredEvent[]) {
          const result = restore(stored);
          if (result.isErr()) {
            yield err(result.error);
            return;
          }
          events.push(result.value);
        }
        yield ok(events);
      }
    } catch (error) {
      yield err(domainError.fromUnknown(error, { code: 'import.event_spool_read_failed' }));
    }
  }

  private async readExactly(buffer: Buffer, position: number): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await this.file.read(
        buffer,
        offset,
        buffer.length - offset,
        position + offset
      );
      if (bytesRead === 0) throw new Error('Unexpected end of import event snapshot');
      offset += bytesRead;
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.file.close();
    } finally {
      await rm(this.directory, { recursive: true, force: true });
    }
  }
}
