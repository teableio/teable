import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const commandDir = dirname(fileURLToPath(import.meta.url));

const recordCommandHandlers = [
  'ApplyRecordOrdersHandler.ts',
  'ArchiveRecordsHandler.ts',
  'ClearHandler.ts',
  'ClickButtonHandler.ts',
  'CreateRecordsHandler.ts',
  'CreateRecordsStreamHandler.ts',
  'DeleteRecordsHandler.ts',
  'DuplicateRecordHandler.ts',
  'ImportCsvHandler.ts',
  'ImportExcelHandler.ts',
  'ImportRecordsHandler.ts',
  'PasteHandler.ts',
  'ReorderRecordsHandler.ts',
  'ResetButtonHandler.ts',
  'RestoreRecordsHandler.ts',
  'SetButtonValueHandler.ts',
  'UpdateRecordHandler.ts',
] as const;
const recordEventProjectionWhitelist = [
  /RealtimeProjection\.ts$/,
  /analytics\//,
  /action-trigger/,
  /collaborator-notification/,
  /automation\//,
  /audit-log\//,
  /task\//,
  /trash\//,
];

const recordProjectionDecorator =
  /@ProjectionHandler\(\s*(RecordCreated|RecordsBatchCreated|RecordUpdated|RecordsBatchUpdated|RecordsDeleted|RecordReordered)\s*\)/;

describe('record command EventBus isolation', () => {
  it.each(recordCommandHandlers)('%s uses DomainWriteTransaction instead of EventBus', (file) => {
    const source = readFileSync(join(commandDir, file), 'utf8');
    expect(source).not.toContain("from '../ports/EventBus'");
    expect(source).not.toContain("from '../ports/memory/EventBusDomainWriteTransaction'");
    expect(source).toContain('domainWriteTransaction');
  });
});

describe('record event ProjectionHandler classification', () => {
  it('does not leave unclassified record ProjectionHandlers outside the memory-bus whitelist', () => {
    const roots = [
      join(commandDir, '../../../../../apps/nestjs-backend/src'),
      join(commandDir, '../../../../../../enterprise/backend-ee/src'),
      join(commandDir, '../application/projections'),
    ];
    const offenders: string[] = [];
    const visit = (dir: string) => {
      let entries: ReturnType<typeof readdirSync>;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
          continue;
        }
        const source = readFileSync(path, 'utf8');
        if (!recordProjectionDecorator.test(source)) {
          continue;
        }
        if (recordEventProjectionWhitelist.some((pattern) => pattern.test(path))) {
          continue;
        }
        if (
          source.includes('@SameTxProjectionHandler') ||
          source.includes('@DurableProjectionHandler')
        ) {
          continue;
        }
        if (source.includes('durable-exempt:')) {
          continue;
        }
        offenders.push(path);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    expect(offenders).toEqual([]);
  });
});
