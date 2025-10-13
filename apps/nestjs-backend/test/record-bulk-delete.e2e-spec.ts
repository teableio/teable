/* eslint-disable @typescript-eslint/naming-convention */
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import { Colors, FieldKeyType, FieldType, RatingIcon, Relationship } from '@teable/core';
import type { IRecord } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RecordModifyService } from '../src/features/record/record-modify/record-modify.service';
import type { IClsStore } from '../src/types/cls';
import {
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  runWithTestUser,
} from './utils/init-app';

const PERF_PREFIX = '[Record bulk delete]';

describe('Record bulk delete performance (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'deletes 8000 rows from a 10000-row table with all major column types',
    async () => {
      const linkedTable = await measure('create linked table', () =>
        createTable(baseId, {
          name: 'Bulk Delete Linked',
          fields: [
            {
              name: 'Name',
              type: FieldType.SingleLineText,
            },
          ],
          records: Array.from({ length: 10 }, (_, index) => ({
            fields: {
              Name: `Linked ${index + 1}`,
            },
          })),
        })
      );

      let mainTable: ITableFullVo | null = null;

      try {
        const recordModifyService = app.get<RecordModifyService>(RecordModifyService);
        const clsService = app.get<ClsService<IClsStore>>(ClsService);

        mainTable = await measure('create main table', () =>
          createTable(baseId, {
            name: 'Bulk Delete Main',
            records: [],
            fields: [
              {
                name: 'Title',
                type: FieldType.SingleLineText,
              },
              {
                name: 'Description',
                type: FieldType.LongText,
              },
              {
                name: 'Score',
                type: FieldType.Number,
              },
              {
                name: 'Completed',
                type: FieldType.Checkbox,
              },
              {
                name: 'Due Date',
                type: FieldType.Date,
              },
              {
                name: 'Status',
                type: FieldType.SingleSelect,
                options: {
                  choices: [
                    { name: 'Not Started', color: Colors.Gray },
                    { name: 'In Progress', color: Colors.Blue },
                    { name: 'Completed', color: Colors.Green },
                  ],
                },
              },
              {
                name: 'Tags',
                type: FieldType.MultipleSelect,
                options: {
                  choices: [
                    { name: 'Tag 1', color: Colors.Red },
                    { name: 'Tag 2', color: Colors.Orange },
                    { name: 'Tag 3', color: Colors.Yellow },
                    { name: 'Tag 4', color: Colors.Green },
                    { name: 'Tag 5', color: Colors.Blue },
                  ],
                },
              },
              {
                name: 'Member',
                type: FieldType.User,
              },
              {
                name: 'Rating',
                type: FieldType.Rating,
                options: {
                  icon: RatingIcon.Star,
                  color: Colors.YellowBright,
                  max: 5,
                },
              },
              {
                name: 'Linked Item',
                type: FieldType.Link,
                options: {
                  relationship: Relationship.ManyOne,
                  foreignTableId: linkedTable.id,
                },
              },
            ],
          })
        );

        const mainTableRef = mainTable;
        if (!mainTableRef) {
          throw new Error('Main table creation failed');
        }
        const mainTableId = mainTableRef.id;

        const totalRecords = 10_000;
        const deleteCount = 8_000;
        const batchSize = 1_000;
        const statuses = ['Not Started', 'In Progress', 'Completed'];
        const tagOptions = ['Tag 1', 'Tag 2', 'Tag 3', 'Tag 4', 'Tag 5'];
        const linkedRecords = linkedTable.records ?? [];
        const allRecordIds: string[] = [];

        await measure('insert 10k records', async () => {
          for (let offset = 0; offset < totalRecords; offset += batchSize) {
            const chunkSize = Math.min(batchSize, totalRecords - offset);
            const batch = Array.from({ length: chunkSize }, (_, index) => {
              const seq = offset + index;
              const firstTag = tagOptions[seq % tagOptions.length];
              const secondTag = tagOptions[(seq + 1) % tagOptions.length];
              const linkedTarget =
                seq < linkedRecords.length
                  ? { id: linkedRecords[seq % linkedRecords.length].id }
                  : null;
              return {
                fields: {
                  Title: `Record ${seq + 1}`,
                  Description: `Long description for record ${seq + 1}`,
                  Score: seq,
                  Completed: seq % 2 === 0,
                  'Due Date': new Date(Date.UTC(2024, 0, (seq % 28) + 1)).toISOString(),
                  Status: statuses[seq % statuses.length],
                  Tags: firstTag === secondTag ? [firstTag] : [firstTag, secondTag],
                  Member: userId,
                  Rating: (seq % 5) + 1,
                  'Linked Item': linkedTarget,
                },
              };
            });

            const { records } = await createRecords(mainTableId, {
              fieldKeyType: FieldKeyType.Name,
              typecast: true,
              records: batch,
            });

            allRecordIds.push(...records.map((record) => record.id));
          }
        });

        expect(allRecordIds).toHaveLength(totalRecords);
        // eslint-disable-next-line no-console
        console.info(`${PERF_PREFIX} Seeded ${allRecordIds.length} records`);

        const recordsToDelete = allRecordIds.slice(0, deleteCount);

        const deleteResult = await measure('delete 8000 records', () =>
          runWithTestUser(clsService, () =>
            recordModifyService.deleteRecords(mainTableId, recordsToDelete)
          )
        );
        expect(deleteResult.records).toHaveLength(deleteCount);

        const remainingRecords = await measure('fetch remaining records', () =>
          collectAllRecords(mainTableId)
        );
        expect(remainingRecords).toHaveLength(totalRecords - deleteCount);

        const remainingIds = new Set(remainingRecords.map((record) => record.id));
        for (const deletedId of recordsToDelete) {
          expect(remainingIds.has(deletedId)).toBe(false);
        }
      } finally {
        if (mainTable) {
          await measure('cleanup main table', () => permanentDeleteTable(baseId, mainTable!.id));
        }
        await measure('cleanup linked table', () => permanentDeleteTable(baseId, linkedTable.id));
      }
    },
    {
      timeout: 180_000,
    }
  );
});

async function collectAllRecords(tableId: string): Promise<IRecord[]> {
  const take = 1_000;
  let skip = 0;
  const aggregated: IRecord[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await getRecords(tableId, { skip, take });
    aggregated.push(...page.records);
    if (page.records.length < take) {
      break;
    }
    skip += take;
  }

  return aggregated;
}

async function measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - start;
    // eslint-disable-next-line no-console
    console.info(`${PERF_PREFIX} ${label} took ${(durationMs / 1000).toFixed(2)}s`);
  }
}
