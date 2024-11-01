/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldType,
  isGreater,
  SortFunc,
  StatisticsFunc,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { createTable, baseQuery, BaseQueryColumnType, BaseQueryJoinType } from '@teable/openapi';
import { initApp } from './utils/init-app';

describe('BaseSqlQuery e2e', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Iterate through each query capability', () => {
    let table: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'age?',
            type: FieldType.Number,
          },
          {
            name: 'position',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                {
                  name: 'Frontend Developer',
                  color: Colors.Red,
                },
                {
                  name: 'Backend Developer',
                  color: Colors.Blue,
                },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              name: 'Alice',
              'age?': 20,
              position: 'Frontend Developer',
            },
          },
          {
            fields: {
              name: 'Bob',
              'age?': 30,
              position: 'Backend Developer',
            },
          },
          {
            fields: {
              name: 'Charlie',
              'age?': 40,
              position: 'Frontend Developer',
            },
          },
        ],
      }).then((res) => res.data);
    });

    it('aggregation', async () => {
      const res = await baseQuery(baseId, {
        from: table.id,
        aggregation: [
          {
            column: table.fields[1].id,
            type: BaseQueryColumnType.Field,
            statisticFunc: StatisticsFunc.Average,
          },
        ],
      });

      expect(res.data.rows).toEqual([
        expect.objectContaining({ [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 30 }),
      ]);
    });

    it('filter', async () => {
      const res = await baseQuery(baseId, {
        from: table.id,
        where: {
          conjunction: 'and',
          filterSet: [
            {
              column: table.fields[1].id,
              type: BaseQueryColumnType.Field,
              operator: isGreater.value,
              value: 35,
            },
          ],
        },
      });
      expect(res.data.columns).toHaveLength(3);
      expect(res.data.rows).toEqual([
        {
          [`${table.fields[0].id}`]: 'Charlie',
          [`${table.fields[1].id}`]: 40,
          [`${table.fields[2].id}`]: 'Frontend Developer',
        },
      ]);
    });

    it('orderBy', async () => {
      const res = await baseQuery(baseId, {
        from: table.id,
        orderBy: [
          {
            column: table.fields[1].id,
            type: BaseQueryColumnType.Field,
            order: SortFunc.Desc,
          },
        ],
      });
      expect(res.data.columns).toHaveLength(3);
      expect(res.data.rows).toEqual([
        {
          [`${table.fields[0].id}`]: 'Charlie',
          [`${table.fields[1].id}`]: 40,
          [`${table.fields[2].id}`]: 'Frontend Developer',
        },
        {
          [`${table.fields[0].id}`]: 'Bob',
          [`${table.fields[1].id}`]: 30,
          [`${table.fields[2].id}`]: 'Backend Developer',
        },
        {
          [`${table.fields[0].id}`]: 'Alice',
          [`${table.fields[1].id}`]: 20,
          [`${table.fields[2].id}`]: 'Frontend Developer',
        },
      ]);
    });

    it('groupBy', async () => {
      const res = await baseQuery(baseId, {
        from: table.id,
        select: [
          {
            column: table.fields[2].id,
            type: BaseQueryColumnType.Field,
          },
          {
            column: `${table.fields[1].id}_${StatisticsFunc.Average}`,
            type: BaseQueryColumnType.Aggregation,
          },
        ],
        groupBy: [
          {
            column: table.fields[2].id,
            type: BaseQueryColumnType.Field,
          },
        ],
        aggregation: [
          {
            column: table.fields[1].id,
            type: BaseQueryColumnType.Field,
            statisticFunc: StatisticsFunc.Average,
          },
        ],
      });
      expect(res.data.columns).toHaveLength(2);
      expect(res.data.rows).toEqual([
        {
          [`${table.fields[2].id}`]: 'Backend Developer',
          [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 30,
        },
        {
          [`${table.fields[2].id}`]: 'Frontend Developer',
          [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 30,
        },
      ]);
    });

    it('groupBy with date', async () => {
      const table = await createTable(baseId, {
        fields: [
          {
            name: 'id',
            type: FieldType.SingleLineText,
          },
          {
            name: 'date',
            type: FieldType.Date,
            options: {
              formatting: {
                date: 'YYYY-MM-DD',
                time: TimeFormatting.None,
                timeZone: 'Asia/Shanghai',
              },
            },
          },
        ],
        records: [
          {
            fields: {
              id: '1',
              date: '2024-01-01',
            },
          },
          {
            fields: {
              id: '2',
              date: '2024-01-02',
            },
          },
          {
            fields: {
              id: '3',
              date: '2024-01-01',
            },
          },
        ],
      }).then((res) => res.data);
      const res = await baseQuery(baseId, {
        from: table.id,
        groupBy: [{ column: table.fields[1].id, type: BaseQueryColumnType.Field }],
      });
      expect(res.data.columns).toHaveLength(1);
      expect(res.data.rows).toEqual(
        expect.arrayContaining([
          { [`${table.fields[1].id}`]: '2024-01-01' },
          { [`${table.fields[1].id}`]: '2024-01-02' },
        ])
      );
    });

    it('groupBy with single user field', async () => {
      const table = await createTable(baseId, {
        fields: [
          {
            name: 'user',
            type: FieldType.User,
          },
        ],
        records: [
          {
            fields: {},
          },
          {
            fields: {
              user: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      }).then((res) => res.data);
      const res = await baseQuery(baseId, {
        from: table.id,
        groupBy: [{ column: table.fields[0].id, type: BaseQueryColumnType.Field }],
      });
      console.log('res.data', res.data);
      expect(res.data.columns).toHaveLength(1);
      expect(res.data.rows).toEqual([
        {},
        { [`${table.fields[0].id}`]: globalThis.testConfig.userName },
      ]);
    });

    it('limit and offset', async () => {
      const res = await baseQuery(baseId, {
        from: table.id,
        limit: 1,
        offset: 1,
      });
      expect(res.data.columns).toHaveLength(3);
      expect(res.data.rows).toHaveLength(1);
    });

    describe('from', () => {
      it('from query', async () => {
        const res = await baseQuery(baseId, {
          from: {
            from: table.id,
            where: {
              conjunction: 'and',
              filterSet: [
                {
                  column: table.fields[1].id,
                  type: BaseQueryColumnType.Field,
                  operator: isGreater.value,
                  value: 35,
                },
              ],
            },
          },
        });
        expect(res.data.columns).toHaveLength(3);
        expect(res.data.rows).toEqual([
          {
            [`${table.fields[0].id}`]: 'Charlie',
            [`${table.fields[1].id}`]: 40,
            [`${table.fields[2].id}`]: 'Frontend Developer',
          },
        ]);
      });

      it('from query with aggregation', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Average}`,
              type: BaseQueryColumnType.Aggregation,
            },
          ],
          from: {
            from: table.id,
            where: {
              conjunction: 'and',
              filterSet: [
                {
                  column: table.fields[1].id,
                  type: BaseQueryColumnType.Field,
                  operator: isGreater.value,
                  value: 35,
                },
              ],
            },
          },
          aggregation: [
            {
              column: table.fields[1].id,
              type: BaseQueryColumnType.Field,
              statisticFunc: StatisticsFunc.Average,
            },
          ],
        });
        expect(res.data.columns).toHaveLength(1);
        expect(res.data.rows).toEqual([
          { [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 40 },
        ]);
      });

      it('from query include aggregation', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Average}`,
              type: BaseQueryColumnType.Aggregation,
            },
          ],
          from: {
            from: table.id,
            aggregation: [
              {
                column: table.fields[1].id,
                type: BaseQueryColumnType.Field,
                statisticFunc: StatisticsFunc.Average,
              },
            ],
          },
        });
        expect(res.data.columns).toHaveLength(1);
        expect(res.data.rows).toEqual([
          { [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 30 },
        ]);
      });

      it('from query include aggregation and filter', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Average}`,
              type: BaseQueryColumnType.Aggregation,
            },
          ],
          from: {
            from: table.id,
            aggregation: [
              {
                column: table.fields[1].id,
                type: BaseQueryColumnType.Field,
                statisticFunc: StatisticsFunc.Average,
              },
            ],
            where: {
              conjunction: 'and',
              filterSet: [
                {
                  column: table.fields[1].id,
                  type: BaseQueryColumnType.Field,
                  operator: isGreater.value,
                  value: 35,
                },
              ],
            },
          },
        });
        expect(res.data.columns).toHaveLength(1);
        expect(res.data.rows).toEqual([
          { [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 40 },
        ]);
      });

      it('from query include aggregation and filter and orderBy and groupBy', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Average}`,
              type: BaseQueryColumnType.Aggregation,
            },
          ],
          from: {
            from: table.id,
            aggregation: [
              {
                column: table.fields[1].id,
                type: BaseQueryColumnType.Field,
                statisticFunc: StatisticsFunc.Average,
              },
            ],
            where: {
              conjunction: 'and',
              filterSet: [
                {
                  column: table.fields[1].id,
                  type: BaseQueryColumnType.Field,
                  operator: isGreater.value,
                  value: 35,
                },
              ],
            },
            orderBy: [
              {
                column: table.fields[0].id,
                type: BaseQueryColumnType.Field,
                order: SortFunc.Desc,
              },
            ],
            groupBy: [
              {
                column: table.fields[0].id,
                type: BaseQueryColumnType.Field,
              },
            ],
          },
        });
        expect(res.data.columns).toHaveLength(1);
        expect(res.data.rows).toEqual([
          { [`${table.fields[1].id}_${StatisticsFunc.Average}`]: 40 },
        ]);
      });

      it('from query include aggregation, filter query aggregation field', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
              type: BaseQueryColumnType.Aggregation,
            },
            {
              column: table.fields[2].id,
              type: BaseQueryColumnType.Field,
            },
          ],
          where: {
            conjunction: 'and',
            filterSet: [
              {
                column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
                type: BaseQueryColumnType.Aggregation,
                operator: isGreater.value,
                value: 25,
              },
            ],
          },
          orderBy: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
              type: BaseQueryColumnType.Aggregation,
              order: SortFunc.Desc,
            },
          ],
          from: {
            from: table.id,
            aggregation: [
              {
                column: table.fields[1].id,
                type: BaseQueryColumnType.Field,
                statisticFunc: StatisticsFunc.Sum,
              },
            ],
            groupBy: [
              {
                column: table.fields[2].id,
                type: BaseQueryColumnType.Field,
              },
            ],
          },
        });
        expect(res.data.columns).toHaveLength(2);
        expect(res.data.rows).toEqual([
          {
            [`${table.fields[1].id}_${StatisticsFunc.Sum}`]: 60,
            [`${table.fields[2].id}`]: 'Frontend Developer',
          },
          {
            [`${table.fields[1].id}_${StatisticsFunc.Sum}`]: 30,
            [`${table.fields[2].id}`]: 'Backend Developer',
          },
        ]);
      });

      it('from query include aggregation, filter and group query aggregation field - query include select', async () => {
        const res = await baseQuery(baseId, {
          select: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
              type: BaseQueryColumnType.Aggregation,
            },
            {
              column: table.fields[2].id,
              type: BaseQueryColumnType.Field,
            },
          ],
          where: {
            conjunction: 'and',
            filterSet: [
              {
                column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
                type: BaseQueryColumnType.Aggregation,
                operator: isGreater.value,
                value: 25,
              },
            ],
          },
          groupBy: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
              type: BaseQueryColumnType.Aggregation,
            },
            {
              column: table.fields[2].id,
              type: BaseQueryColumnType.Field,
            },
          ],
          orderBy: [
            {
              column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
              type: BaseQueryColumnType.Aggregation,
              order: SortFunc.Desc,
            },
          ],
          from: {
            select: [
              {
                column: `${table.fields[1].id}_${StatisticsFunc.Sum}`,
                type: BaseQueryColumnType.Aggregation,
              },
              {
                column: table.fields[2].id,
                type: BaseQueryColumnType.Field,
              },
            ],
            from: table.id,
            aggregation: [
              {
                column: table.fields[1].id,
                type: BaseQueryColumnType.Field,
                statisticFunc: StatisticsFunc.Sum,
              },
            ],
            groupBy: [
              {
                column: table.fields[2].id,
                type: BaseQueryColumnType.Field,
              },
            ],
          },
        });
        expect(res.data.columns).toHaveLength(2);
        expect(res.data.rows).toEqual([
          {
            [`${table.fields[1].id}_${StatisticsFunc.Sum}`]: 60,
            [`${table.fields[2].id}`]: 'Frontend Developer',
          },
          {
            [`${table.fields[1].id}_${StatisticsFunc.Sum}`]: 30,
            [`${table.fields[2].id}`]: 'Backend Developer',
          },
        ]);
      });
    });
  });

  describe('Iterate through each query capability with join', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeAll(async () => {
      table1 = await createTable(baseId, {
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'age',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              name: 'Alice',
              age: 20,
            },
          },
          {
            fields: {
              name: 'Bob',
              age: 30,
            },
          },
          {
            fields: {
              name: 'Charlie',
              age: 40,
            },
          },
        ],
      }).then((res) => res.data);

      table2 = await createTable(baseId, {
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'age',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              name: 'David',
              age: 20,
            },
          },
          {
            fields: {
              name: 'Eve',
              age: 30,
            },
          },
          {
            fields: {
              name: 'Frank',
              age: 50,
            },
          },
        ],
      }).then((res) => res.data);
    });

    it('join', async () => {
      const res = await baseQuery(baseId, {
        from: table1.id,
        join: [
          {
            type: BaseQueryJoinType.Left,
            table: table2.id,
            on: [`${table1.fields[1].id}`, `${table2.fields[1].id}`],
          },
        ],
      });
      expect(res.data.columns).toHaveLength(4);
      expect(res.data.rows).toEqual([
        {
          [`${table1.fields[0].id}`]: 'Alice',
          [`${table1.fields[1].id}`]: 20,
          [`${table2.fields[0].id}`]: 'David',
          [`${table2.fields[1].id}`]: 20,
        },
        {
          [`${table1.fields[0].id}`]: 'Bob',
          [`${table1.fields[1].id}`]: 30,
          [`${table2.fields[0].id}`]: 'Eve',
          [`${table2.fields[1].id}`]: 30,
        },
        {
          [`${table1.fields[0].id}`]: 'Charlie',
          [`${table1.fields[1].id}`]: 40,
        },
      ]);
    });

    it('join inner', async () => {
      const res = await baseQuery(baseId, {
        from: table1.id,
        join: [
          {
            type: BaseQueryJoinType.Inner,
            table: table2.id,
            on: [`${table1.fields[1].id}`, `${table2.fields[1].id}`],
          },
        ],
      });
      expect(res.data.columns).toHaveLength(4);
      expect(res.data.rows).toEqual([
        {
          [`${table1.fields[0].id}`]: 'Alice',
          [`${table1.fields[1].id}`]: 20,
          [`${table2.fields[0].id}`]: 'David',
          [`${table2.fields[1].id}`]: 20,
        },
        {
          [`${table1.fields[0].id}`]: 'Bob',
          [`${table1.fields[1].id}`]: 30,
          [`${table2.fields[0].id}`]: 'Eve',
          [`${table2.fields[1].id}`]: 30,
        },
      ]);
    });

    it('join filter and select', async () => {
      const res = await baseQuery(baseId, {
        from: table1.id,
        join: [
          {
            type: BaseQueryJoinType.Left,
            table: table2.id,
            on: [`${table1.fields[1].id}`, `${table2.fields[1].id}`],
          },
        ],
        where: {
          conjunction: 'and',
          filterSet: [
            {
              column: `${table2.fields[1].id}`,
              type: BaseQueryColumnType.Field,
              operator: isGreater.value,
              value: 25,
            },
          ],
        },
        select: [
          {
            column: `${table1.fields[0].id}`,
            type: BaseQueryColumnType.Field,
          },
          {
            column: `${table2.fields[0].id}`,
            type: BaseQueryColumnType.Field,
          },
        ],
      });
      expect(res.data.columns).toHaveLength(2);
      expect(res.data.rows).toEqual([
        {
          [`${table1.fields[0].id}`]: 'Bob',
          [`${table2.fields[0].id}`]: 'Eve',
        },
      ]);
    });
  });
});
