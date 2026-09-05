import { DefaultTableMapper, type ITablePersistenceDTO, type Table } from '@teable/v2-core';
import { bench, describe } from 'vitest';

const benchOptions = {
  iterations: 0,
  warmupIterations: 0,
  time: 1000,
  warmupTime: 200,
  throws: true,
};

const paddedId = (prefix: string, index: number): string =>
  `${prefix}${index.toString(36).padStart(16, '0')}`;

const buildDto = (fieldCount: number, viewCount: number): ITablePersistenceDTO => {
  const fields: ITablePersistenceDTO['fields'] = Array.from({ length: fieldCount }, (_, index) => {
    const id = paddedId('fld', index);
    const name = `Field ${index}`;
    const dbFieldName = `field_${index}`;
    switch (index % 5) {
      case 1:
        return {
          id,
          name,
          dbFieldName,
          type: 'number',
          options: { formatting: { type: 'decimal', precision: 2 } },
        };
      case 2:
        return { id, name, dbFieldName, type: 'checkbox' };
      case 3:
        return {
          id,
          name,
          dbFieldName,
          type: 'date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        };
      case 4:
        return {
          id,
          name,
          dbFieldName,
          type: 'singleSelect',
          options: {
            choices: [
              { id: paddedId('cho', index), name: 'A', color: 'blue' },
              { id: paddedId('cho', index + 10_000), name: 'B', color: 'green' },
            ],
          },
        };
      default:
        return { id, name, dbFieldName, type: 'singleLineText' };
    }
  });

  const columnMeta = Object.fromEntries(fields.map((field, index) => [field.id, { order: index }]));

  const views: ITablePersistenceDTO['views'] = Array.from({ length: viewCount }, (_, index) => ({
    id: paddedId('viw', index),
    name: `View ${index}`,
    type: 'grid',
    columnMeta,
  }));

  return {
    id: paddedId('tbl', fieldCount),
    baseId: paddedId('bse', 1),
    name: `Clone bench ${fieldCount}x${viewCount}`,
    primaryFieldId: fields[0]!.id,
    fields,
    views,
  };
};

type Scenario = {
  label: string;
  fieldCount: number;
  viewCount: number;
};

type Fixture = {
  label: string;
  dto: ITablePersistenceDTO;
  table: Table;
};

const mapper = new DefaultTableMapper();

const scenarios: Scenario[] = [
  { label: '20 fields, 1 view', fieldCount: 20, viewCount: 1 },
  { label: '50 fields, 3 views', fieldCount: 50, viewCount: 3 },
  { label: '200 fields, 5 views', fieldCount: 200, viewCount: 5 },
];

const fixtures: Fixture[] = scenarios.map((scenario) => {
  const dto = buildDto(scenario.fieldCount, scenario.viewCount);
  const mapped = mapper.toDomain(dto);
  if (mapped.isErr()) {
    throw new Error(mapped.error.message);
  }
  return { label: scenario.label, dto, table: mapped.value };
});

let sink: unknown;

for (const fixture of fixtures) {
  describe(`Table clone vs skip-clone: ${fixture.label}`, () => {
    bench(
      `${fixture.label}: skip clone (T7092 new)`,
      () => {
        sink = fixture.table.id().toString();
      },
      benchOptions
    );

    bench(
      `${fixture.label}: clone via toDTO+toDomain (T7092 old)`,
      () => {
        const cloned = fixture.table.clone(mapper);
        if (cloned.isErr()) {
          throw new Error(cloned.error.message);
        }
        sink = cloned.value.id().toString();
      },
      benchOptions
    );

    bench(
      `${fixture.label}: toDomain only`,
      () => {
        const mapped = mapper.toDomain(fixture.dto);
        if (mapped.isErr()) {
          throw new Error(mapped.error.message);
        }
        sink = mapped.value.id().toString();
      },
      benchOptions
    );
  });
}

void sink;
