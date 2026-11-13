import type { INestApplication } from '@nestjs/common';
import {
  CellFormat,
  FieldKeyType,
  FieldType,
  HttpErrorCode,
  NumberFormattingType,
  Relationship,
  type ILinkFieldOptions,
} from '@teable/core';
import type { IPasteRo, IPasteVo, ITableFullVo } from '@teable/openapi';
import {
  PASTE_STREAM_URL,
  PASTE_URL,
  X_CANARY_HEADER,
  axios,
  getFields,
  getRecords,
  urlBuilder,
} from '@teable/openapi';
import { DEFAULT_TABLE_DATA_SAFETY_LIMITS } from '@teable/v2-core';
import * as fieldFactory from '../src/features/field/model/factory';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const fieldNamed = (table: ITableFullVo, name: string) =>
  table.fields.find((field) => field.name === name)!;

describe('ordinary native paste preparation retirement (real HTTP)', () => {
  let app: INestApplication;
  let cookie: string;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const context = await initApp();
    app = context.app;
    cookie = context.cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  const streamEvents = async (tableId: string, paste: IPasteRo) => {
    const response = await fetch(axios.getUri({ url: urlBuilder(PASTE_STREAM_URL, { tableId }) }), {
      method: 'PATCH',
      headers: {
        Accept: 'text/event-stream',
        ['Content-Type']: 'application/json',
        Cookie: cookie,
        [X_CANARY_HEADER]: 'true',
      },
      body: JSON.stringify(paste),
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    return (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((data) => data && data !== '[DONE]')
      .map((data) => JSON.parse(data));
  };

  it.each(['sync', 'stream'] as const)(
    'updates and creates with source headers after field factories retire (%s)',
    async (mode) => {
      const source = await createTable(baseId, {
        name: 'Ordinary clipboard source',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Percent',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Percent, precision: 1 } },
          },
          {
            name: 'When',
            type: FieldType.Date,
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Tokyo' },
            },
          },
          {
            name: 'Tags',
            type: FieldType.MultipleSelect,
            options: { choices: [{ name: 'Alpha, Beta' }, { name: 'Gamma' }] },
          },
          { name: 'Ignored', type: FieldType.SingleLineText },
        ],
        records: [],
      });
      let target: ITableFullVo | undefined;
      try {
        target = await createTable(baseId, {
          name: 'Ordinary paste destination',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText, notNull: true },
            { name: 'Percent text', type: FieldType.SingleLineText },
            { name: 'When text', type: FieldType.SingleLineText },
            {
              name: 'Tags',
              type: FieldType.MultipleSelect,
              options: { choices: [{ name: 'Existing' }] },
            },
            {
              name: 'Default status',
              type: FieldType.SingleLineText,
              options: { defaultValue: 'Default status' },
            },
          ],
          records: [{ fields: { Title: 'before', ['Default status']: 'Existing status' } }],
        });
        const title = fieldNamed(target, 'Title');
        const percent = fieldNamed(target, 'Percent text');
        const when = fieldNamed(target, 'When text');
        const tags = fieldNamed(target, 'Tags');
        const defaultStatus = fieldNamed(target, 'Default status');
        const computed = await createField(target.id, {
          name: 'Title length',
          type: FieldType.Formula,
          options: { expression: `LEN({${title.id}})` },
        });
        const paste: IPasteRo = {
          viewId: target.views[0]!.id,
          projection: [title.id, percent.id, when.id, tags.id, computed.id],
          ranges: [
            [0, 0],
            [4, 1],
          ],
          header: ['Title', 'Percent', 'When', 'Tags', 'Ignored'].map((name) =>
            fieldNamed(source, name)
          ),
          content: [
            ['updated', 0.25, '2026-02-01T23:45:00.000Z', ['Alpha, Beta', 'Gamma'], '999'],
            ['created-item', '0.25', '2026-02-02 08:45', ['Delta'], '999'],
          ],
        };
        let streamCreatedRecordIds: string[] | undefined;
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: target.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual([
              [0, 0],
              [4, 1],
            ]);
          } else {
            const events = await streamEvents(target.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(
              events.some((event) => event.id === 'progress' && event.processedCount > 0)
            ).toBe(true);
            const done = events.find((event) => event.id === 'done');
            expect(done).toMatchObject({ processedCount: 2, updatedCount: 1, createdCount: 1 });
            expect(done.data.createdRecordIds).toHaveLength(1);
            streamCreatedRecordIds = done.data.createdRecordIds;
            expect(done.data).toMatchObject({ updatedCount: 1, createdCount: 1 });
            expect(Object.keys(done.data).sort()).toEqual([
              'createdCount',
              'createdRecordIds',
              'updatedCount',
            ]);
          }
        } finally {
          retiredFactory.mockRestore();
        }
        const records = (await getRecords(target.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({
          id: target.records[0]!.id,
          fields: {
            [title.id]: 'updated',
            [percent.id]: '25.0%',
            [when.id]: '2026-02-02 08:45',
            [tags.id]: ['Alpha, Beta', 'Gamma'],
            [computed.id]: 7,
            [defaultStatus.id]: 'Existing status',
          },
        });
        expect(records[1]?.fields).toMatchObject({
          [title.id]: 'created-item',
          [percent.id]: '25.0%',
          [when.id]: '2026-02-02 08:45',
          [tags.id]: ['Delta'],
          [computed.id]: 12,
          [defaultStatus.id]: 'Default status',
        });
        if (mode === 'stream') {
          expect(streamCreatedRecordIds).toEqual([records[1]!.id]);
          expect(records[1]!.id).not.toBe(target.records[0]!.id);
        }
        const savedTags = (await getFields(target.id)).data.find((field) => field.id === tags.id)!;
        expect(savedTags.options).toMatchObject({
          choices: expect.arrayContaining([
            expect.objectContaining({ name: 'Existing' }),
            expect.objectContaining({ name: 'Alpha, Beta' }),
            expect.objectContaining({ name: 'Gamma' }),
            expect.objectContaining({ name: 'Delta' }),
          ]),
        });
      } finally {
        if (target) await permanentDeleteTable(baseId, target.id);
        await permanentDeleteTable(baseId, source.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'interprets rendered Date lookup headers in the source timezone after factories retire (%s)',
    async (mode) => {
      const dateFormats = [
        { name: 'DST', date: 'YYYY-MM-DD' },
        { name: 'Month-day dash', date: 'MM-DD' },
        { name: 'Month-day slash', date: 'MM/DD' },
        { name: 'Day', date: 'DD' },
      ];
      const foreign = await createTable(baseId, {
        name: 'Ordinary source date values',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          ...dateFormats.map(({ name, date }) => ({
            name,
            type: FieldType.Date as const,
            options: {
              formatting: { date, time: 'HH:mm' as const, timeZone: 'America/New_York' },
            },
          })),
        ],
        records: [
          {
            fields: {
              Title: 'first',
              DST: '2024-03-10T07:30:00.000Z',
              ['Month-day dash']: '2024-01-15T08:30:00.000Z',
              ['Month-day slash']: '2024-01-15T08:30:00.000Z',
              Day: '2024-01-15T08:30:00.000Z',
            },
          },
          {
            fields: {
              Title: 'second',
              DST: '2024-03-11T07:30:00.000Z',
              ['Month-day dash']: '2024-01-16T08:30:00.000Z',
              ['Month-day slash']: '2024-01-16T08:30:00.000Z',
              Day: '2024-01-16T08:30:00.000Z',
            },
          },
        ],
      });
      let source: ITableFullVo | undefined;
      let target: ITableFullVo | undefined;
      try {
        source = await createTable(baseId, {
          name: 'Ordinary date lookup clipboard',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'clipboard' } }],
        });
        const link = await createField(source.id, {
          name: 'Dates',
          type: FieldType.Link,
          options: { relationship: Relationship.OneMany, foreignTableId: foreign.id },
        });
        for (const { name, date } of dateFormats) {
          await createField(source.id, {
            name,
            type: FieldType.Date,
            isLookup: true,
            options: {
              formatting: { date, time: 'HH:mm', timeZone: 'America/New_York' },
            },
            lookupOptions: {
              foreignTableId: foreign.id,
              linkFieldId: link.id,
              lookupFieldId: fieldNamed(foreign, name).id,
            },
          });
        }
        await updateRecordByApi(
          source.id,
          source.records[0]!.id,
          link.id,
          foreign.records.map(({ id }) => ({ id }))
        );
        const sourceFields = (await getFields(source.id)).data;
        const headers = dateFormats.map(({ name }) =>
          sourceFields.find((field) => field.name === name)!
        );
        for (const [index, header] of headers.entries()) {
          expect(header).toMatchObject({
            type: FieldType.Date,
            isLookup: true,
            isMultipleCellValue: true,
            options: {
              formatting: {
                date: dateFormats[index]!.date,
                time: 'HH:mm',
                timeZone: 'America/New_York',
              },
            },
            lookupOptions: {
              foreignTableId: foreign.id,
              linkFieldId: link.id,
              lookupFieldId: fieldNamed(foreign, dateFormats[index]!.name).id,
            },
          });
        }
        const rawSource = (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).data
          .records[0]!;
        expect(rawSource.fields[headers[0]!.id]).toEqual([
          '2024-03-10T07:30:00.000Z',
          '2024-03-11T07:30:00.000Z',
        ]);
        const renderedSource = (
          await getRecords(source.id, {
            fieldKeyType: FieldKeyType.Id,
            cellFormat: CellFormat.Text,
          })
        ).data.records[0]!;
        const content = headers.map(({ id }) => renderedSource.fields[id]);
        expect(content).toEqual([
          '2024-03-10 03:30, 2024-03-11 03:30',
          '01-15 03:30, 01-16 03:30',
          '01/15 03:30, 01/16 03:30',
          '15 03:30, 16 03:30',
        ]);
        target = await createTable(baseId, {
          name: 'Ordinary date destination',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            ...dateFormats.map(({ name }) => ({
              name,
              type: FieldType.Date as const,
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'HH:mm' as const, timeZone: 'Asia/Tokyo' },
              },
            })),
          ],
          records: [{ fields: { Title: 'before' } }],
        });
        const targets = dateFormats.map(({ name }) => fieldNamed(target!, name));
        const paste: IPasteRo = {
          viewId: target.views[0]!.id,
          projection: targets.map(({ id }) => id),
          ranges: [
            [0, 0],
            [3, 0],
          ],
          header: headers,
          content: [content],
        };
        // Freeze only Date, at real now: backdating expires the harness's Keyv sessions.
        // Real timers keep HTTP/cache work live; omitted year/month share one clock.
        const clock = new Date();
        const year = clock.getFullYear();
        const month = clock.getMonth() + 1;
        const monthText = String(month).padStart(2, '0');
        const newYorkHourOnThe15th = month >= 3 && month <= 10 ? '07' : '08';
        vi.useFakeTimers({ toFake: ['Date'], now: clock });
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: target.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual(paste.ranges);
          } else {
            const events = await streamEvents(target.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(events.find((event) => event.id === 'done')).toMatchObject({
              totalCount: 1,
              processedCount: 1,
              updatedCount: 1,
              createdCount: 0,
              data: { updatedCount: 1, createdCount: 0, createdRecordIds: [] },
            });
          }
        } finally {
          retiredFactory.mockRestore();
          vi.useRealTimers();
        }
        const persisted = (await getRecords(target.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toMatchObject({
          id: target.records[0]!.id,
          fields: {
            [fieldNamed(target, 'Title').id]: 'before',
            [targets[0]!.id]: '2024-03-10T07:30:00.000Z',
            [targets[1]!.id]: `${year}-01-15T08:30:00.000Z`,
            [targets[2]!.id]: `${year}-01-15T08:30:00.000Z`,
            [targets[3]!.id]: `${year}-${monthText}-15T${newYorkHourOnThe15th}:30:00.000Z`,
          },
        });
        expect(persisted[0]!.fields[targets[0]!.id]).not.toBe('2024-03-10T08:30:00.000Z');
      } finally {
        if (target) await permanentDeleteTable(baseId, target.id);
        if (source) await permanentDeleteTable(baseId, source.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'expands a copied self-link with fresh physical metadata without changing source links (%s)',
    async (mode) => {
      const source = await createTable(baseId, {
        name: 'Ordinary copied self-link source',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: { Title: 'Alpha' } }, { fields: { Title: 'Beta' } }],
      });
      let target: ITableFullVo | undefined;
      try {
        const selfLink = await createField(source.id, {
          name: 'Related source rows',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: source.id,
            lookupFieldId: source.fields[0]!.id,
            isOneWay: false,
          },
        });
        await updateRecordByApi(source.id, source.records[0]!.id, selfLink.id, [
          { id: source.records[1]!.id },
        ]);
        const sourceFields = (await getFields(source.id)).data;
        const copiedLink = sourceFields.find((field) => field.id === selfLink.id)!;
        const oldOptions = copiedLink.options as ILinkFieldOptions;
        const physicalKeys = [
          'fkHostTableName',
          'selfKeyName',
          'foreignKeyName',
          'symmetricFieldId',
        ] as const;
        expect(oldOptions).toMatchObject({
          relationship: Relationship.ManyMany,
          foreignTableId: source.id,
          isOneWay: false,
        });
        for (const key of physicalKeys) {
          expect(oldOptions[key]).toEqual(expect.any(String));
          expect(oldOptions[key]).not.toBe('');
        }
        const oldSymmetric = sourceFields.find(
          (field) => field.id === oldOptions.symmetricFieldId
        )!;
        expect(oldSymmetric.options).toMatchObject({
          foreignTableId: source.id,
          symmetricFieldId: copiedLink.id,
        });
        const sourceBefore = (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        const copiedCell = sourceBefore.find((record) => record.id === source.records[0]!.id)!
          .fields[copiedLink.id];
        expect(copiedCell).toEqual([{ id: source.records[1]!.id, title: 'Beta' }]);
        expect(
          sourceBefore.find((record) => record.id === source.records[1]!.id)!.fields[
            oldSymmetric.id
          ]
        ).toEqual([{ id: source.records[0]!.id, title: 'Alpha' }]);
        target = await createTable(baseId, {
          name: 'Ordinary copied self-link destination',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'Destination' } }],
        });
        const paste: IPasteRo = {
          viewId: target.views[0]!.id,
          ranges: [
            [1, 0],
            [1, 0],
          ],
          header: [copiedLink],
          content: [[copiedCell]],
        };
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: target.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.status).toBe(200);
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual(paste.ranges);
          } else {
            const events = await streamEvents(target.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(events.find((event) => event.id === 'done')).toMatchObject({
              totalCount: 1,
              processedCount: 1,
              updatedCount: 1,
              createdCount: 0,
              data: { updatedCount: 1, createdCount: 0, createdRecordIds: [] },
            });
          }
        } finally {
          retiredFactory.mockRestore();
        }
        const targetFields = (await getFields(target.id)).data;
        expect(targetFields).toHaveLength(2);
        const targetLink = targetFields.find((field) => field.type === FieldType.Link)!;
        expect(targetLink.id).not.toBe(copiedLink.id);
        const newOptions = targetLink.options as ILinkFieldOptions;
        expect(newOptions).toMatchObject({
          relationship: Relationship.ManyMany,
          foreignTableId: source.id,
          lookupFieldId: source.fields[0]!.id,
          isOneWay: false,
        });
        for (const key of physicalKeys) {
          expect(newOptions[key]).toEqual(expect.any(String));
          expect(newOptions[key]).not.toBe(oldOptions[key]);
        }
        const targetRecords = (await getRecords(target.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(targetRecords).toHaveLength(1);
        expect(targetRecords[0]).toMatchObject({
          id: target.records[0]!.id,
          fields: {
            [target.fields[0]!.id]: 'Destination',
            [targetLink.id]: [{ id: source.records[1]!.id, title: 'Beta' }],
          },
        });
        const sourceAfter = (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(sourceAfter.map(({ id }) => id)).toEqual(sourceBefore.map(({ id }) => id));
        for (const before of sourceBefore) {
          const after = sourceAfter.find(({ id }) => id === before.id)!;
          expect(after.fields[copiedLink.id]).toEqual(before.fields[copiedLink.id]);
          expect(after.fields[oldSymmetric.id]).toEqual(before.fields[oldSymmetric.id]);
        }
        const sourceAfterFields = (await getFields(source.id)).data;
        expect(sourceAfterFields.find(({ id }) => id === copiedLink.id)!.options).toEqual(
          copiedLink.options
        );
        expect(sourceAfterFields.find(({ id }) => id === oldSymmetric.id)!.options).toEqual(
          oldSymmetric.options
        );
        const newMirror = sourceAfterFields.find(({ id }) => id === newOptions.symmetricFieldId)!;
        expect(newMirror.options).toMatchObject({
          foreignTableId: target.id,
          symmetricFieldId: targetLink.id,
        });
        const projectedSource = (
          await getRecords(source.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [copiedLink.id, oldSymmetric.id, newMirror.id],
          })
        ).data.records;
        for (const before of sourceBefore) {
          const after = projectedSource.find(({ id }) => id === before.id)!;
          expect(after.fields[copiedLink.id]).toEqual(before.fields[copiedLink.id]);
          expect(after.fields[oldSymmetric.id]).toEqual(before.fields[oldSymmetric.id]);
        }
        expect(
          projectedSource.find(({ id }) => id === source.records[1]!.id)!.fields[newMirror.id]
        ).toEqual([{ id: target.records[0]!.id, title: 'Destination' }]);
      } finally {
        if (target) await permanentDeleteTable(baseId, target.id);
        await permanentDeleteTable(baseId, source.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'expands a copied lookup-of-Link with fresh ownership and preserves source links (%s)',
    async (mode) => {
      const source = await createTable(baseId, {
        name: 'Ordinary lookup-of-Link values',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: { Title: 'Alpha' } }, { fields: { Title: 'Beta' } }],
      });
      let lookupSource: ITableFullVo | undefined;
      let target: ITableFullVo | undefined;
      try {
        const selfLink = await createField(source.id, {
          name: 'Parent source row',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: source.id,
            lookupFieldId: source.fields[0]!.id,
            isOneWay: false,
          },
        });
        await updateRecordByApi(source.id, source.records[0]!.id, selfLink.id, {
          id: source.records[1]!.id,
        });
        const originalFields = (await getFields(source.id)).data;
        const originalLink = originalFields.find(({ id }) => id === selfLink.id)!;
        const oldOptions = originalLink.options as ILinkFieldOptions;
        const oldInverse = originalFields.find(({ id }) => id === oldOptions.symmetricFieldId)!;
        const originalProjection = [originalLink.id, oldInverse.id];
        const sourceBefore = (
          await getRecords(source.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: originalProjection,
          })
        ).data.records;
        expect(
          sourceBefore.find(({ id }) => id === source.records[0]!.id)!.fields[selfLink.id]
        ).toEqual({ id: source.records[1]!.id, title: 'Beta' });
        expect(
          sourceBefore.find(({ id }) => id === source.records[1]!.id)!.fields[oldInverse.id]
        ).toEqual([{ id: source.records[0]!.id, title: 'Alpha' }]);
        lookupSource = await createTable(baseId, {
          name: 'Ordinary lookup-of-Link clipboard',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'Clipboard' } }],
        });
        const lookupSourceLink = await createField(lookupSource.id, {
          name: 'Source rows',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: source.id },
        });
        await updateRecordByApi(lookupSource.id, lookupSource.records[0]!.id, lookupSourceLink.id, [
          { id: source.records[0]!.id },
        ]);
        const lookup = await createField(lookupSource.id, {
          name: 'Copied parent lookup',
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: source.id,
            linkFieldId: lookupSourceLink.id,
            lookupFieldId: selfLink.id,
          },
        });
        const copiedHeader = (await getFields(lookupSource.id)).data.find(
          ({ id }) => id === lookup.id
        )!;
        expect(copiedHeader).toMatchObject({
          type: FieldType.Link,
          isLookup: true,
          isComputed: true,
          isMultipleCellValue: true,
          lookupOptions: {
            foreignTableId: source.id,
            linkFieldId: lookupSourceLink.id,
            lookupFieldId: selfLink.id,
          },
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: source.id,
            fkHostTableName: oldOptions.fkHostTableName,
            selfKeyName: oldOptions.selfKeyName,
            foreignKeyName: oldOptions.foreignKeyName,
            symmetricFieldId: oldOptions.symmetricFieldId,
          },
        });
        for (const key of [
          'fkHostTableName',
          'selfKeyName',
          'foreignKeyName',
          'symmetricFieldId',
        ] as const) {
          expect((copiedHeader.options as ILinkFieldOptions)[key]).toEqual(expect.any(String));
        }
        const lookupBefore = (
          await getRecords(lookupSource.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [lookupSourceLink.id, copiedHeader.id],
          })
        ).data.records[0]!;
        const copiedCell = lookupBefore.fields[copiedHeader.id];
        expect(copiedCell).toEqual([{ id: source.records[1]!.id, title: 'Beta' }]);
        target = await createTable(baseId, {
          name: 'Ordinary lookup-of-Link destination',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'Destination' } }],
        });
        const paste: IPasteRo = {
          viewId: target.views[0]!.id,
          ranges: [
            [1, 0],
            [1, 0],
          ],
          header: [copiedHeader],
          content: [[copiedCell]],
        };
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: target.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.status).toBe(200);
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual(paste.ranges);
          } else {
            const events = await streamEvents(target.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(events.find((event) => event.id === 'done')).toMatchObject({
              totalCount: 1,
              processedCount: 1,
              updatedCount: 1,
              createdCount: 0,
              data: { updatedCount: 1, createdCount: 0, createdRecordIds: [] },
            });
          }
        } finally {
          retiredFactory.mockRestore();
        }
        const targetFields = (await getFields(target.id)).data;
        expect(targetFields).toHaveLength(2);
        const targetLink = targetFields.find(({ type }) => type === FieldType.Link)!;
        expect(targetLink.isComputed).toBeUndefined();
        expect(targetLink.isLookup).toBeUndefined();
        expect(targetLink.id).not.toBe(copiedHeader.id);
        const newOptions = targetLink.options as ILinkFieldOptions;
        expect(newOptions).toMatchObject({
          relationship: Relationship.ManyOne,
          foreignTableId: source.id,
          lookupFieldId: source.fields[0]!.id,
          isOneWay: false,
          fkHostTableName: target.dbTableName,
          selfKeyName: '__id',
          foreignKeyName: `__fk_${targetLink.id}`,
        });
        expect(newOptions.fkHostTableName).not.toBe(oldOptions.fkHostTableName);
        expect(newOptions.foreignKeyName).not.toBe(oldOptions.foreignKeyName);
        expect(newOptions.symmetricFieldId).toEqual(expect.any(String));
        expect(newOptions.symmetricFieldId).not.toBe(oldOptions.symmetricFieldId);
        const targetRecords = (await getRecords(target.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(targetRecords).toHaveLength(1);
        expect(targetRecords[0]).toMatchObject({
          id: target.records[0]!.id,
          fields: {
            [target.fields[0]!.id]: 'Destination',
            [targetLink.id]: { id: source.records[1]!.id, title: 'Beta' },
          },
        });
        const sourceAfterFields = (await getFields(source.id)).data;
        expect(sourceAfterFields.find(({ id }) => id === originalLink.id)!.options).toEqual(
          originalLink.options
        );
        expect(sourceAfterFields.find(({ id }) => id === oldInverse.id)!.options).toEqual(
          oldInverse.options
        );
        const newInverse = sourceAfterFields.find(({ id }) => id === newOptions.symmetricFieldId)!;
        expect(newInverse.options).toMatchObject({
          relationship: Relationship.OneMany,
          foreignTableId: target.id,
          symmetricFieldId: targetLink.id,
          fkHostTableName: target.dbTableName,
        });
        const sourceAfter = (
          await getRecords(source.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [...originalProjection, newInverse.id],
          })
        ).data.records;
        expect(sourceAfter.map(({ id }) => id)).toEqual(sourceBefore.map(({ id }) => id));
        for (const before of sourceBefore) {
          const after = sourceAfter.find(({ id }) => id === before.id)!;
          expect(after.fields[originalLink.id]).toEqual(before.fields[originalLink.id]);
          expect(after.fields[oldInverse.id]).toEqual(before.fields[oldInverse.id]);
        }
        expect(
          sourceAfter.find(({ id }) => id === source.records[1]!.id)!.fields[newInverse.id]
        ).toEqual([{ id: target.records[0]!.id, title: 'Destination' }]);
        const lookupAfter = (
          await getRecords(lookupSource.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [lookupSourceLink.id, copiedHeader.id],
          })
        ).data.records;
        expect(lookupAfter).toHaveLength(1);
        expect(lookupAfter[0]!.fields).toEqual(lookupBefore.fields);
      } finally {
        if (target) await permanentDeleteTable(baseId, target.id);
        if (lookupSource) await permanentDeleteTable(baseId, lookupSource.id);
        await permanentDeleteTable(baseId, source.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'expands a one-way self-link on its own source table without creating a reciprocal (%s)',
    async (mode) => {
      const table = await createTable(baseId, {
        name: 'Ordinary one-way self-link clipboard',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: { Title: 'Alpha' } }, { fields: { Title: 'Beta' } }],
      });
      try {
        const selfLink = await createField(table.id, {
          name: 'One-way related rows',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table.id,
            lookupFieldId: table.fields[0]!.id,
            isOneWay: true,
          },
        });
        await updateRecordByApi(table.id, table.records[0]!.id, selfLink.id, [
          { id: table.records[1]!.id },
        ]);
        const fieldsBefore = (await getFields(table.id)).data;
        expect(fieldsBefore).toHaveLength(2);
        const copiedHeader = fieldsBefore.find(({ id }) => id === selfLink.id)!;
        const oldOptions = copiedHeader.options as ILinkFieldOptions;
        expect(oldOptions).toMatchObject({
          relationship: Relationship.ManyMany,
          foreignTableId: table.id,
          isOneWay: true,
          fkHostTableName: expect.any(String),
          selfKeyName: expect.any(String),
          foreignKeyName: expect.any(String),
        });
        expect(oldOptions.symmetricFieldId).toBeUndefined();
        const recordsBefore = (
          await getRecords(table.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [table.fields[0]!.id, copiedHeader.id],
          })
        ).data.records;
        const copiedCell = recordsBefore.find(({ id }) => id === table.records[0]!.id)!.fields[
          copiedHeader.id
        ];
        expect(copiedCell).toEqual([{ id: table.records[1]!.id, title: 'Beta' }]);
        const paste: IPasteRo = {
          viewId: table.views[0]!.id,
          ranges: [
            [2, 0],
            [2, 0],
          ],
          header: [copiedHeader],
          content: [[copiedCell]],
        };
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: table.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.status).toBe(200);
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual(paste.ranges);
          } else {
            const events = await streamEvents(table.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(events.find((event) => event.id === 'done')).toMatchObject({
              totalCount: 1,
              processedCount: 1,
              updatedCount: 1,
              createdCount: 0,
              data: { updatedCount: 1, createdCount: 0, createdRecordIds: [] },
            });
          }
        } finally {
          retiredFactory.mockRestore();
        }
        const fieldsAfter = (await getFields(table.id)).data;
        // Exactly one field was added: neither link owns a reciprocal field.
        expect(fieldsAfter).toHaveLength(3);
        expect(fieldsAfter.find(({ id }) => id === copiedHeader.id)!.options).toEqual(
          copiedHeader.options
        );
        const newLink = fieldsAfter.find(
          ({ id }) => !fieldsBefore.some((field) => field.id === id)
        )!;
        expect(newLink.type).toBe(FieldType.Link);
        expect(newLink.isComputed).toBeUndefined();
        expect(newLink.isLookup).toBeUndefined();
        const newOptions = newLink.options as ILinkFieldOptions;
        expect(newOptions).toMatchObject({
          relationship: Relationship.ManyMany,
          foreignTableId: table.id,
          lookupFieldId: table.fields[0]!.id,
          isOneWay: true,
          fkHostTableName: expect.stringContaining(newLink.id),
          selfKeyName: expect.any(String),
          foreignKeyName: `__fk_${newLink.id}`,
        });
        expect(newOptions.fkHostTableName).not.toBe(oldOptions.fkHostTableName);
        expect(newOptions.symmetricFieldId).toBeUndefined();
        const recordsAfter = (
          await getRecords(table.id, {
            fieldKeyType: FieldKeyType.Id,
            projection: [table.fields[0]!.id, copiedHeader.id, newLink.id],
          })
        ).data.records;
        expect(recordsAfter.map(({ id }) => id)).toEqual(recordsBefore.map(({ id }) => id));
        for (const before of recordsBefore) {
          const after = recordsAfter.find(({ id }) => id === before.id)!;
          expect(after.fields[table.fields[0]!.id]).toBe(before.fields[table.fields[0]!.id]);
          expect(after.fields[copiedHeader.id]).toEqual(before.fields[copiedHeader.id]);
        }
        expect(
          recordsAfter.find(({ id }) => id === table.records[0]!.id)!.fields[newLink.id]
        ).toEqual([{ id: table.records[1]!.id, title: 'Beta' }]);
        expect(
          recordsAfter.find(({ id }) => id === table.records[1]!.id)!.fields[newLink.id]
        ).toBeUndefined();
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'preserves prevented select values through source-header conversion (%s)',
    async (mode) => {
      const table = await createTable(baseId, {
        name: 'Ordinary prevented select conversion',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: { choices: [{ name: 'Open' }], preventAutoNewOptions: true },
          },
          {
            name: 'Tags',
            type: FieldType.MultipleSelect,
            options: {
              choices: [{ name: 'Tag A' }, { name: 'Tag B' }],
              preventAutoNewOptions: true,
            },
          },
        ],
        records: [{ fields: { Title: 'before', Status: 'Open', Tags: ['Tag A'] } }],
      });
      try {
        const [title, status, tags] = table.fields;
        const paste: IPasteRo = {
          viewId: table.views[0]!.id,
          projection: [title!.id, status!.id, tags!.id],
          ranges: [
            [0, 0],
            [2, 0],
          ],
          header: [title!, status!, tags!],
          content: [['updated', ['Missing Status'], ['Missing Tag']]],
        };
        const retiredFactory = vi
          .spyOn(fieldFactory, 'createFieldInstanceByVo')
          .mockImplementation(() => {
            throw new Error('Legacy field factory is retired for ordinary paste preparation');
          });
        try {
          if (mode === 'sync') {
            const response = await axios.patch<IPasteVo>(
              urlBuilder(PASTE_URL, { tableId: table.id }),
              paste,
              { headers: { [X_CANARY_HEADER]: 'true' } }
            );
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data.ranges).toEqual(paste.ranges);
          } else {
            const events = await streamEvents(table.id, paste);
            expect(events.filter((event) => event.id === 'error')).toEqual([]);
            expect(events.find((event) => event.id === 'done')).toMatchObject({
              totalCount: 1,
              processedCount: 1,
              updatedCount: 1,
              createdCount: 0,
              data: { updatedCount: 1, createdCount: 0, createdRecordIds: [] },
            });
          }
        } finally {
          retiredFactory.mockRestore();
        }
        const persisted = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toMatchObject({
          id: table.records[0]!.id,
          fields: { [title!.id]: 'updated', [status!.id]: 'Open', [tags!.id]: ['Tag A'] },
        });
        const savedFields = (await getFields(table.id)).data;
        expect(savedFields.find((field) => field.id === status!.id)!.options).toEqual(
          status!.options
        );
        expect(savedFields.find((field) => field.id === tags!.id)!.options).toEqual(tags!.options);
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it.each(['sync', 'stream'] as const)(
    'preserves ordinary overflow clearing and valid sibling writes (%s)',
    async (mode) => {
      const table = await createTable(baseId, {
        name: 'Ordinary select isolation',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: { choices: [{ name: 'Existing' }] },
          },
        ],
        records: [{ fields: { Title: 'before', Status: 'Existing' } }],
      });
      try {
        const [title, status] = table.fields;
        const maxChoiceNameLength =
          DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoiceNameLength;
        const rejected = 'N'.repeat(maxChoiceNameLength + 1);
        const overflowMessage = `Select field option names cannot exceed ${maxChoiceNameLength} characters`;
        const overflowCode = 'validation.limit.select_choice_name_max_length';
        const overflowLocalization = {
          i18nKey: 'httpErrors.limit.selectChoiceNameMaxLength',
          context: { max: maxChoiceNameLength },
        };
        const paste: IPasteRo = {
          viewId: table.views[0]!.id,
          projection: [title!.id, status!.id],
          ranges: [
            [0, 0],
            [1, 0],
          ],
          header: [title!, status!],
          content: [['kept sibling', rejected]],
        };
        if (mode === 'sync') {
          const response = await axios.patch<IPasteVo>(
            urlBuilder(PASTE_URL, { tableId: table.id }),
            paste,
            { headers: { [X_CANARY_HEADER]: 'true' } }
          );
          expect(response.data.ranges).toEqual([
            [0, 0],
            [1, 0],
          ]);
        } else {
          const events = await streamEvents(table.id, paste);
          expect(events.filter((event) => event.id === 'error')).toEqual([]);
          expect(events.find((event) => event.id === 'done')).toMatchObject({
            processedCount: 1,
            updatedCount: 1,
            createdCount: 0,
          });
        }
        const after = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).data.records;
        // Ordinary typecast clears the rejected unknown option, but commits valid siblings.
        expect(after[0]?.fields).toEqual({ [title!.id]: 'kept sibling' });
        const savedStatus = (await getFields(table.id)).data.find(
          (field) => field.id === status!.id
        )!;
        expect(savedStatus.options).toMatchObject({
          choices: [expect.objectContaining({ name: 'Existing' })],
        });
        const selectOnly: IPasteRo = {
          ...paste,
          projection: [status!.id],
          ranges: [
            [0, 0],
            [0, 0],
          ],
          header: [status!],
          content: [[rejected]],
        };
        if (mode === 'sync') {
          await expect(
            axios.patch(urlBuilder(PASTE_URL, { tableId: table.id }), selectOnly, {
              headers: { [X_CANARY_HEADER]: 'true' },
            })
          ).rejects.toMatchObject({
            status: 400,
            message: overflowMessage,
            code: HttpErrorCode.VALIDATION_ERROR,
            data: {
              domainCode: overflowCode,
              domainTags: ['validation'],
              localization: overflowLocalization,
            },
          });
        } else {
          const events = await streamEvents(table.id, selectOnly);
          expect(events.filter((event) => event.id === 'error')).toEqual([
            {
              id: 'error',
              phase: 'pasting',
              batchIndex: 0,
              totalCount: 1,
              processedCount: 0,
              updatedCount: 0,
              createdCount: 0,
              recordIds: [table.records[0]!.id],
              message: overflowMessage,
              code: overflowCode,
              localization: overflowLocalization,
            },
          ]);
          expect(events.some((event) => event.id === 'done')).toBe(false);
        }
        const unchanged = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).data
          .records;
        expect(unchanged[0]?.fields).toEqual({ [title!.id]: 'kept sibling' });
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );
});
