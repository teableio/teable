/* eslint-disable sonarjs/no-duplicate-string */
import type { IFieldVo, ILinkFieldOptions } from '@teable-group/core';
import {
  CellValueType,
  DateFieldCore,
  DbFieldType,
  FieldType,
  filterSchema,
  Relationship,
} from '@teable-group/core';
import dayjs from 'dayjs';
import knex from 'knex';
import { keyBy } from 'lodash';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { FilterQueryTranslator } from './filter-query-translator';

describe('FilterQueryTranslator', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryBuilder: any;
  const timeZone = 'Asia/Shanghai';
  let fieldContext: { [fieldId: string]: IFieldInstance } = {};

  beforeEach(() => {
    queryBuilder = knex({ client: 'sqlite3' })('table_name');
  });

  beforeAll(() => {
    const fieldsJson: IFieldVo[] = [
      {
        id: 'fld1',
        name: 'name',
        type: FieldType.SingleLineText,
        dbFieldName: 'name_fld1',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {},
      },
      {
        id: 'fld2',
        name: 'number',
        type: FieldType.Number,
        dbFieldName: 'number_fld2',
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {},
      },
      {
        id: 'fld3',
        name: 'status',
        type: FieldType.SingleSelect,
        dbFieldName: 'status_fld3',
        dbFieldType: DbFieldType.Text,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {},
      },
      {
        id: 'fld4',
        name: 'tags',
        type: FieldType.MultipleSelect,
        dbFieldName: 'tags_fld4',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        columnMeta: {},
        options: {},
      },
      {
        id: 'fld5',
        name: 'done',
        type: FieldType.Checkbox,
        dbFieldName: 'done_fld5',
        dbFieldType: DbFieldType.Integer,
        cellValueType: CellValueType.Boolean,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {},
      },
      {
        id: 'fld6',
        name: 'date',
        type: FieldType.Date,
        dbFieldName: 'date_fld6',
        dbFieldType: DbFieldType.DateTime,
        cellValueType: CellValueType.DateTime,
        isMultipleCellValue: false,
        columnMeta: {},
        options: DateFieldCore.defaultOptions(),
      },
      {
        id: 'fld7',
        name: 'Attachments',
        type: FieldType.Attachment,
        dbFieldName: 'attachments_fld7',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {},
      },
    ];

    const fields = fieldsJson.map((field) => createFieldInstanceByVo(field));
    fieldContext = keyBy(fields, 'id');
  });

  describe('should parse all `SingleLineText` conditions', () => {
    it('isEmpty, isNotEmpty', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'isEmpty',
              value: null,
            },
            {
              fieldId: 'fld1',
              operator: 'isNotEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch('`name_fld1` is null and `name_fld1` is not null');
    });

    it('is', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'is',
              value: 'a',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`name_fld1\` = 'a'`);
    });

    it('isNot', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'isNot',
              value: 'b',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`ifnull(name_fld1, '') != 'b'`);
    });

    it('contains', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'contains',
              value: 'c',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`name_fld1\` like '%c%'`);
    });

    it('doesNotContain', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'doesNotContain',
              value: 'd',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`ifnull(name_fld1, '') not like '%d%'`);
    });
  });

  describe('should parse all `Number` conditions', () => {
    it('isEmpty, isNotEmpty', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isEmpty',
              value: null,
            },
            {
              fieldId: 'fld2',
              operator: 'isNotEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch('`number_fld2` is null and `number_fld2` is not null');
    });

    it('is', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'is',
              value: 1,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`number_fld2\` = 1`);
    });

    it('isNot', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isNot',
              value: 2,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`ifnull(number_fld2, '') != 2`);
    });

    it('isGreater', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isGreater',
              value: 3,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`number_fld2\` > 3`);
    });

    it('isGreaterEqual', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isGreaterEqual',
              value: 4,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`number_fld2\` >= 4`);
    });

    it('isLess', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isLess',
              value: 5,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`number_fld2\` < 5`);
    });

    it('isLessEqual', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld2',
              operator: 'isLessEqual',
              value: 5,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`number_fld2\` <= 5`);
    });
  });

  describe('should parse all `SingleSelect` conditions', () => {
    it('isEmpty, isNotEmpty', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld3',
              operator: 'isEmpty',
              value: null,
            },
            {
              fieldId: 'fld3',
              operator: 'isNotEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch('`status_fld3` is null and `status_fld3` is not null');
    });

    it('is', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld3',
              operator: 'is',
              value: 'value1',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`\`status_fld3\` = 'value1'`);
    });

    it('isNot', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld3',
              operator: 'isNot',
              value: 'value2',
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch(`ifnull(status_fld3, '') != 'value2'`);
    });

    it('isAnyOf', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld3',
              operator: 'isAnyOf',
              value: ['value3', 'value1'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch("`status_fld3` in ('value3', 'value1')");
    });

    it('isNoneOf', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld3',
              operator: 'isNoneOf',
              value: ['value4'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch("ifnull(status_fld3, '') not in ('value4')");
    });
  });

  describe('should parse all `MultipleSelect` conditions', () => {
    it('isEmpty, isNotEmpty', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld4',
              operator: 'isEmpty',
              value: null,
            },
            {
              fieldId: 'fld4',
              operator: 'isNotEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch('`tags_fld4` is null and `tags_fld4` is not null');
    });

    it('hasAnyOf', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld4',
              operator: 'hasAnyOf',
              value: ['value1'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery().replace(/\s+/g, ' ')).toMatch(
        `exists ( select 1 from json_each(table_name.tags_fld4) where json_each.value in ('value1') )`
      );
    });

    it('hasAllOf', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld4',
              operator: 'hasAllOf',
              value: ['value1', 'value2'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery().replace(/\s+/g, ' ')).toMatch(
        `( select count(distinct json_each.value) from json_each(table_name.tags_fld4) where json_each.value in ('value1','value2') ) = 2`
      );
    });

    it('isExactly', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld4',
              operator: 'isExactly',
              value: ['value1'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery().replace(/\s+/g, ' ')).toMatch(
        `( select count(distinct json_each.value) from json_each(table_name.tags_fld4) where json_each.value in ('value1') and json_array_length(table_name.tags_fld4) = 1 ) = 1`
      );
    });

    it('hasNoneOf', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld4',
              operator: 'hasNoneOf',
              value: ['value1'],
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery().replace(/\s+/g, ' ')).toMatch(
        `not exists ( select 1 from json_each(table_name.tags_fld4) where json_each.value in ('value1') )`
      );
    });
  });

  it('should parse all `Checkbox` conditions', () => {
    const jsonFilter = filterSchema.parse({
      filterSet: [
        {
          fieldId: 'fld5',
          operator: 'is',
          value: true,
        },
        {
          fieldId: 'fld5',
          operator: 'is',
          value: null,
        },
      ],
      conjunction: 'and',
    });

    new FilterQueryTranslator(queryBuilder, fieldContext, jsonFilter).translateToSql();

    expect(queryBuilder.toQuery()).toMatch('`done_fld5` is not null and `done_fld5` is null');
  });

  it('should parse all `Attachment` conditions', () => {
    const jsonFilter = filterSchema.parse({
      filterSet: [
        {
          fieldId: 'fld7',
          operator: 'isEmpty',
          value: null,
        },
        {
          fieldId: 'fld7',
          operator: 'isNotEmpty',
          value: null,
        },
      ],
      conjunction: 'and',
    });

    new FilterQueryTranslator(queryBuilder, fieldContext, jsonFilter).translateToSql();

    expect(queryBuilder.toQuery()).toMatch(
      '`attachments_fld7` is null and `attachments_fld7` is not null'
    );
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  describe('should parse all `Date` conditions', () => {
    it('isEmpty, isNotEmpty', () => {
      new FilterQueryTranslator(
        queryBuilder,
        fieldContext,
        filterSchema.parse({
          filterSet: [
            {
              fieldId: 'fld6',
              operator: 'isEmpty',
              value: null,
            },
            {
              fieldId: 'fld6',
              operator: 'isNotEmpty',
              value: null,
            },
          ],
          conjunction: 'and',
        })
      ).translateToSql();

      expect(queryBuilder.toQuery()).toMatch('`date_fld6` is null and `date_fld6` is not null');
    });

    describe('comparison operations', () => {
      const date = dayjs().utc().tz(timeZone);
      const numberOfDays = 10;
      const exactDate = '2023-07-15T16:00:00.000Z';

      const subOps = [
        'today',
        'tomorrow',
        'yesterday',
        'oneWeekAgo',
        'oneWeekFromNow',
        'oneMonthAgo',
        'oneMonthFromNow',
        'daysAgo',
        'daysFromNow',
        'exactDate',
      ];

      const ops: Record<string, string[]> = {
        is: subOps,
        isNot: subOps,
        isBefore: subOps,
        isAfter: subOps,
        isOnOrBefore: subOps,
        isOnOrAfter: subOps,
      };

      Object.entries(ops).forEach(([key, values]) => {
        values.forEach((value) => {
          test(`given operator '${key}', tests sub operator '${value}'`, () => {
            new FilterQueryTranslator(
              queryBuilder,
              fieldContext,
              filterSchema.parse({
                filterSet: [
                  {
                    fieldId: 'fld6',
                    operator: key,
                    value: {
                      mode: value,
                      timeZone,
                      numberOfDays,
                      exactDate,
                    },
                  },
                ],
                conjunction: 'and',
              })
            ).translateToSql();

            let testDate: string[];
            let matchSql: string;

            if (value === 'today') {
              testDate = [date.startOf('day').toISOString(), date.endOf('day').toISOString()];
            } else if (value === 'tomorrow') {
              testDate = [
                date.add(1, 'day').startOf('day').toISOString(),
                date.add(1, 'day').endOf('day').toISOString(),
              ];
            } else if (value === 'yesterday') {
              testDate = [
                date.subtract(1, 'day').startOf('day').toISOString(),
                date.subtract(1, 'day').endOf('day').toISOString(),
              ];
            } else if (value === 'oneWeekAgo') {
              testDate = [
                date.subtract(1, 'week').startOf('day').toISOString(),
                date.subtract(1, 'week').endOf('day').toISOString(),
              ];
            } else if (value === 'oneWeekFromNow') {
              testDate = [
                date.add(1, 'week').startOf('day').toISOString(),
                date.add(1, 'week').endOf('day').toISOString(),
              ];
            } else if (value === 'oneMonthAgo') {
              testDate = [
                date.subtract(1, 'month').startOf('day').toISOString(),
                date.subtract(1, 'month').endOf('day').toISOString(),
              ];
            } else if (value === 'oneMonthFromNow') {
              testDate = [
                date.add(1, 'month').startOf('day').toISOString(),
                date.add(1, 'month').endOf('day').toISOString(),
              ];
            } else if (value === 'daysAgo') {
              testDate = [
                date.subtract(numberOfDays, 'day').startOf('day').toISOString(),
                date.subtract(numberOfDays, 'day').endOf('day').toISOString(),
              ];
            } else if (value === 'daysFromNow') {
              testDate = [
                date.add(numberOfDays, 'day').startOf('day').toISOString(),
                date.add(numberOfDays, 'day').endOf('day').toISOString(),
              ];
            } else {
              const ed = dayjs(exactDate).utc().tz(timeZone);
              testDate = [ed.startOf('day').toISOString(), ed.endOf('day').toISOString()];
            }

            if (key === 'is') {
              matchSql = `\`date_fld6\` between '${testDate[0]}' and '${testDate[1]}'`;
            } else if (key === 'isNot') {
              matchSql = `\`date_fld6\` not between '${testDate[0]}' and '${testDate[1]}'`;
            } else if (key === 'isBefore') {
              matchSql = `\`date_fld6\` < '${testDate[0]}'`;
            } else if (key === 'isAfter') {
              matchSql = `\`date_fld6\` > '${testDate[1]}'`;
            } else if (key === 'isOnOrBefore') {
              matchSql = `\`date_fld6\` <= '${testDate[1]}'`;
            } else {
              matchSql = `\`date_fld6\` >= '${testDate[0]}'`;
            }

            expect(queryBuilder.toQuery()).toMatch(matchSql);
          });
        });
      });
    });

    describe('isWithIn', () => {
      const date = dayjs().utc().tz(timeZone);

      it('pastWeek', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'pastWeek',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const pastWeek = date.subtract(1, 'week');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${pastWeek.startOf('day').toISOString()}' and '${date
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('pastMonth', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'pastMonth',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const pastMonth = date.subtract(1, 'month');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${pastMonth.startOf('day').toISOString()}' and '${date
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('pastYear', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'pastYear',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const pastYear = date.subtract(1, 'year');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${pastYear.startOf('day').toISOString()}' and '${date
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('nextWeek', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'nextWeek',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const nextWeek = date.add(1, 'week');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${date.startOf('day').toISOString()}' and '${nextWeek
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('nextMonth', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'nextMonth',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const nextMonth = date.add(1, 'month');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${date.startOf('day').toISOString()}' and '${nextMonth
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('nextYear', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'nextYear',
                  timeZone,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const nextYear = date.add(1, 'year');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${date.startOf('day').toISOString()}' and '${nextYear
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('pastNumberOfDays', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'pastNumberOfDays',
                  timeZone,
                  numberOfDays: 10,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const pastNumberOfDays = date.subtract(10, 'day');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${pastNumberOfDays.startOf('day').toISOString()}' and '${date
            .endOf('day')
            .toISOString()}'`
        );
      });

      it('nextNumberOfDays', () => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: 'fld6',
                operator: 'isWithIn',
                value: {
                  mode: 'nextNumberOfDays',
                  timeZone,
                  numberOfDays: 10,
                },
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        const nextNumberOfDays = date.add(10, 'day');

        expect(queryBuilder.toQuery()).toMatch(
          `\`date_fld6\` between '${date.startOf('day').toISOString()}' and '${nextNumberOfDays
            .endOf('day')
            .toISOString()}'`
        );
      });
    });
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  describe('should parse all `Link` conditions', () => {
    const fieldsJson: IFieldVo[] = [
      {
        id: 'fld7',
        name: 'link',
        type: FieldType.Link,
        dbFieldName: 'link_fld7',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: false,
        columnMeta: {},
        options: {
          relationship: Relationship.ManyOne,
        },
      },
      {
        id: 'fld8',
        name: 'link',
        type: FieldType.Link,
        dbFieldName: 'link_fld8',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        columnMeta: {},
        options: {
          relationship: Relationship.ManyMany,
        },
      },
      {
        id: 'fld9',
        name: 'link',
        type: FieldType.Link,
        dbFieldName: 'link_fld9',
        dbFieldType: DbFieldType.Json,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        columnMeta: {},
        options: {
          relationship: Relationship.OneMany,
        },
      },
    ];

    beforeAll(() => {
      const fields = fieldsJson.map((field) => createFieldInstanceByVo(field));
      fieldContext = keyBy(fields, 'id');
    });

    describe('isEmpty, isNotEmpty', () => {
      test.each(fieldsJson)('$id - relationship($options.relationship)', ({ id, dbFieldName }) => {
        new FilterQueryTranslator(
          queryBuilder,
          fieldContext,
          filterSchema.parse({
            filterSet: [
              {
                fieldId: id,
                operator: 'isEmpty',
                value: null,
              },
              {
                fieldId: id,
                operator: 'isNotEmpty',
                value: null,
              },
            ],
            conjunction: 'and',
          })
        ).translateToSql();

        expect(queryBuilder.toQuery()).toMatch(
          `\`${dbFieldName}\` is null and \`${dbFieldName}\` is not null`
        );
      });
    });

    describe('contains, doesNotContain', () => {
      test.each(fieldsJson)(
        '$id - relationship($options.relationship)',
        ({ id, dbFieldName, isMultipleCellValue }) => {
          new FilterQueryTranslator(
            queryBuilder,
            fieldContext,
            filterSchema.parse({
              filterSet: [
                {
                  fieldId: id,
                  operator: 'contains',
                  value: 'title',
                },
                {
                  fieldId: id,
                  operator: 'doesNotContain',
                  value: 'title',
                },
              ],
              conjunction: 'and',
            })
          ).translateToSql();

          let matchSql: string;

          if (isMultipleCellValue) {
            matchSql = `exists (select 1 from json_each(table_name.${dbFieldName}) where json_extract(json_each.value, '$.title') like '%title%')`;
            matchSql += ` and not exists (select 1 from json_each(table_name.${dbFieldName}) where json_extract(json_each.value, '$.title') like '%title%')`;
          } else {
            matchSql = `json_extract(${dbFieldName}, '$.title') like '%title%' and ifnull(json_extract(${dbFieldName}, '$.title'), '') not like '%title%'`;
          }

          expect(
            queryBuilder.toQuery().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
          ).toMatch(matchSql);
        }
      );
    });

    describe('comparison operations', () => {
      const ops1 = ['is', 'isNot', 'isAnyOf', 'isNoneOf'];

      const ops2 = ['hasAnyOf', 'hasAllOf', 'isExactly', 'hasNoneOf'];

      fieldsJson.forEach((field) => {
        let ops = ops1;
        if (field.isMultipleCellValue) {
          ops = ops2;
        }

        ops.forEach((op) => {
          test(`${field.id}, relationship(${
            (field.options as ILinkFieldOptions).relationship
          }), given operator '${op}'`, () => {
            new FilterQueryTranslator(
              queryBuilder,
              fieldContext,
              filterSchema.parse({
                filterSet: [
                  {
                    fieldId: field.id,
                    operator: op,
                    value: ['is', 'isNot'].includes(op) ? 'rec1' : ['rec2'],
                  },
                ],
                conjunction: 'and',
              })
            ).translateToSql();

            let matchSql: string;

            if (op === 'is') {
              matchSql = `json_extract(${field.dbFieldName}, '$.id') = 'rec1'`;
            } else if (op === 'isNot') {
              matchSql = `ifnull(json_extract(${field.dbFieldName}, '$.id'), '') != 'rec1'`;
            } else if (op === 'isAnyOf') {
              matchSql = `json_extract(${field.dbFieldName}, '$.id') in ('rec2')`;
            } else if (op === 'isNoneOf') {
              matchSql = `ifnull(json_extract(${field.dbFieldName}, '$.id'), '') not in ('rec2')`;
            } else if (op === 'hasAnyOf') {
              matchSql = `exists (select 1 from json_each(table_name.${field.dbFieldName}) where json_extract(json_each.value, '$.id') in ('rec2'))`;
            } else if (op === 'hasAllOf') {
              matchSql = `(select count(distinct json_each.value) from json_each(table_name.${field.dbFieldName}) where json_extract(json_each.value, '$.id') in ('rec2')) = 1`;
            } else if (op === 'hasNoneOf') {
              matchSql = `not exists (select 1 from json_each(table_name.${field.dbFieldName}) where json_extract(json_each.value, '$.id') in ('rec2'))`;
            } else {
              matchSql = `(select count(distinct json_each.value) from json_each(table_name.${field.dbFieldName}) where json_extract(json_each.value, '$.id') in ('rec2') and json_array_length(table_name.${field.dbFieldName}) = 1) = 1`;
            }

            expect(
              queryBuilder.toQuery().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
            ).toMatch(matchSql);
          });
        });
      });
    });
  });
});
