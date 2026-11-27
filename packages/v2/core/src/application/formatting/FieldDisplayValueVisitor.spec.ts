import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { describe, expect, it } from 'vitest';

import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { AttachmentField } from '../../domain/table/fields/types/AttachmentField';
import { CellValueMultiplicity } from '../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../domain/table/fields/types/CellValueType';
import { CreatedTimeField } from '../../domain/table/fields/types/CreatedTimeField';
import { DateField } from '../../domain/table/fields/types/DateField';
import {
  DateFormattingPreset,
  DateTimeFormatting,
  TimeFormatting,
} from '../../domain/table/fields/types/DateTimeFormatting';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LastModifiedTimeField } from '../../domain/table/fields/types/LastModifiedTimeField';
import { LookupField } from '../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { UserField } from '../../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../../domain/table/fields/types/UserMultiplicity';
import { dateDisplayPattern } from './cellValueFormatting';
import { FieldDisplayValueVisitor } from './FieldDisplayValueVisitor';

dayjs.extend(utc);
dayjs.extend(timezone);

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (value: string) => FieldName.create(value)._unsafeUnwrap();

describe('prepared native display values', () => {
  it('reuses prepared numeric formatting while preserving currency rounding and signs', () => {
    const format = NumberField.create({
      id: fieldId('l'),
      name: fieldName('Amount'),
      formatting: NumberFormatting.create({
        type: 'currency',
        precision: 2,
        symbol: '$',
      })._unsafeUnwrap(),
    })
      .andThen((field) => field.accept(new FieldDisplayValueVisitor()))
      ._unsafeUnwrap();
    expect(
      [-1234.565, -0, 1.005, Number.NaN, Number.POSITIVE_INFINITY].map((value) =>
        format(value)._unsafeUnwrap()
      )
    ).toEqual(['-$1,234.57', '$0.00', '$1.01', '$NaN', '$∞']);
    expect(format(null)._unsafeUnwrap()).toBe('');
  });

  it('preserves historical text and select scalars instead of clipboard coercion', () => {
    const text = SingleLineTextField.create({ id: fieldId('a'), name: fieldName('Text') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const select = SingleSelectField.create({
      id: fieldId('b'),
      name: fieldName('Status'),
      options: [],
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const malformed = { title: 'Historical object' };
    const scalarArray = ['Alpha', 'Beta'];
    expect(text(42)._unsafeUnwrap()).toBe(42);
    expect(text(malformed)._unsafeUnwrap()).toBe(malformed);
    expect(text(scalarArray)._unsafeUnwrap()).toBe(scalarArray);
    expect(select(false)._unsafeUnwrap()).toBe(false);
    expect(select(['Alpha, Beta', 'Gamma'])._unsafeUnwrap()).toBe('Alpha, Beta, Gamma');
    expect(text(null)._unsafeUnwrap()).toBe('');
    expect(select(undefined)._unsafeUnwrap()).toBe('');
  });

  it('quotes multiple select and user commas but preserves null array slots', () => {
    const select = MultipleSelectField.create({
      id: fieldId('c'),
      name: fieldName('Tags'),
      options: [],
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const user = UserField.create({
      id: fieldId('d'),
      name: fieldName('Owners'),
      isMultiple: UserMultiplicity.multiple(),
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(select(['Alpha, Beta', null, 'Gamma'])._unsafeUnwrap()).toBe('"Alpha, Beta", , Gamma');
    expect(user([{ title: 'Doe, Jane' }, null, { title: 'Alex' }])._unsafeUnwrap()).toBe(
      '"Doe, Jane", , Alex'
    );
    expect(user([{ title: 42 }]).isErr()).toBe(true);
  });

  it.each([
    { kind: 'created-time', fieldClass: CreatedTimeField },
    { kind: 'last-modified-time', fieldClass: LastModifiedTimeField },
  ])('retains outer lookup multiplicity for $kind fields', ({ fieldClass }) => {
    const createdTime = fieldClass
      .create({
        id: fieldId('e'),
        name: fieldName('Created'),
        formatting: DateTimeFormatting.create({
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'Asia/Tokyo',
        })._unsafeUnwrap(),
      })
      ._unsafeUnwrap();
    const lookup = LookupField.create({
      id: fieldId('f'),
      name: fieldName('Created values'),
      innerField: createdTime,
      isMultipleCellValue: true,
      lookupOptions: LookupOptions.create({
        linkFieldId: fieldId('g').toString(),
        foreignTableId: `tbl${'h'.repeat(16)}`,
        lookupFieldId: createdTime.id().toString(),
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const format = lookup.accept(new FieldDisplayValueVisitor())._unsafeUnwrap();
    expect(
      format(['2026-02-01T23:45:00.000Z', null, '2026-02-02T23:45:00.000Z'])._unsafeUnwrap()
    ).toBe('2026-02-02 08:45, , 2026-02-03 08:45');
    expect(format(null)._unsafeUnwrap()).toBe('');
    expect(format('2026-02-01T23:45:00.000Z').isErr()).toBe(true);
  });

  it('returns errors rather than equal empty strings for malformed date and computed values', () => {
    const date = DateField.create({ id: fieldId('i'), name: fieldName('Date') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const computed = FormulaField.create({
      id: fieldId('j'),
      name: fieldName('Computed'),
      expression: FormulaExpression.create('NOW()')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.multiple(),
      },
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(date('not-a-date')._unsafeUnwrapErr().code).toBe('formatting.invalid_cell_value');
    expect(computed('2026-02-01T23:45:00.000Z').isErr()).toBe(true);
    expect(computed(['not-a-date']).isErr()).toBe(true);
    expect(computed([null])._unsafeUnwrap()).toBe('');
  });

  it('preserves attachment item text while reporting malformed container values', () => {
    const format = AttachmentField.create({ id: fieldId('k'), name: fieldName('Files') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(format([{ name: 'a.txt', token: 'token-a' }, null, {}])._unsafeUnwrap()).toBe(
      'a.txt (token-a),,undefined (undefined)'
    );
    expect(format({ name: 'Historical scalar' }).isErr()).toBe(true);
    expect(format(null)._unsafeUnwrap()).toBe('');
  });

  it('matches dayjs.tz().format() across all date/time presets, timezones, DST transitions, and edge inputs', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const timeZones = [
        'utc',
        'UTC',
        'Etc/UTC',
        'Etc/GMT+5',
        'Asia/Qatar',
        'America/New_York',
        'Europe/London',
        'Asia/Kolkata',
        'Pacific/Chatham',
        'Australia/Lord_Howe',
      ];
      const inputs: unknown[] = [
        '2026-01-01T00:00:00.000Z',
        '2026-06-15T12:00:00.000Z',
        '2026-06-15T12:30:00.000Z',
        '2024-03-10T06:59:59.000Z',
        '2024-03-10T07:00:00.000Z',
        '2024-11-03T05:30:00.000Z',
        '2000-02-29T23:45:00.000Z',
        '1970-01-01T00:00:00.000Z',
        '1969-12-31T23:59:59.500Z',
        '1969-12-31T23:59:59.000Z',
        '2026-02-01T10:23:45.123456Z',
        '2026-06-15T12:30:00+03:00',
        '2026-06-15 12:30:00+00:00',
        '2026-02-01',
        new Date('2026-11-14T10:23:45.678Z'),
        1763115825678,
        '0050-03-05T04:05:06.000Z',
      ];

      for (const timeZone of timeZones) {
        for (const datePreset of Object.values(DateFormattingPreset)) {
          for (const timePreset of Object.values(TimeFormatting)) {
            const formatting = DateTimeFormatting.create({
              date: datePreset,
              time: timePreset,
              timeZone,
            })._unsafeUnwrap();
            const pattern = dateDisplayPattern(formatting);
            const format = DateField.create({
              id: fieldId('m'),
              name: fieldName('Date'),
              formatting,
            })
              ._unsafeUnwrap()
              .accept(new FieldDisplayValueVisitor())
              ._unsafeUnwrap();

            for (const input of inputs) {
              const expected = dayjs(input as string)
                .tz(timeZone)
                .format(pattern);
              expect(format(input)._unsafeUnwrap()).toBe(expected);
            }
          }
        }
      }

      // Custom non-preset date pattern, historical sub-minute LMT offset, and invalid numeric inputs
      const customFormatting = DateTimeFormatting.create({
        date: 'DD MMM YYYY',
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Qatar',
      })._unsafeUnwrap();
      const customFormat = DateField.create({
        id: fieldId('n'),
        name: fieldName('Custom Date'),
        formatting: customFormatting,
      })
        ._unsafeUnwrap()
        .accept(new FieldDisplayValueVisitor())
        ._unsafeUnwrap();
      expect(customFormat('2026-11-14T10:23:45.678Z')._unsafeUnwrap()).toBe(
        dayjs('2026-11-14T10:23:45.678Z').tz('Asia/Qatar').format('DD MMM YYYY HH:mm')
      );
      expect(customFormat(Number.NaN).isErr()).toBe(true);
      expect(customFormat(Number.POSITIVE_INFINITY).isErr()).toBe(true);

      const lmtFormatting = DateTimeFormatting.create({
        date: 'YYYY-MM-DD HH:mm:ss',
        time: TimeFormatting.None,
        timeZone: 'Africa/Monrovia',
      })._unsafeUnwrap();
      const lmtFormat = DateField.create({
        id: fieldId('o'),
        name: fieldName('LMT Date'),
        formatting: lmtFormatting,
      })
        ._unsafeUnwrap()
        .accept(new FieldDisplayValueVisitor())
        ._unsafeUnwrap();
      expect(lmtFormat('1970-06-01T00:00:00.000Z')._unsafeUnwrap()).toBe(
        dayjs('1970-06-01T00:00:00.000Z').tz('Africa/Monrovia').format('YYYY-MM-DD HH:mm:ss')
      );
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('formats dates identically across UTC and America/New_York host process timezones', () => {
    const parisFormat = DateField.create({
      id: fieldId('p'),
      name: fieldName('Paris Date'),
      formatting: DateTimeFormatting.create({
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'Europe/Paris',
      })._unsafeUnwrap(),
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const gmtPlus5Format = DateField.create({
      id: fieldId('q'),
      name: fieldName('Fixed Offset Date'),
      formatting: DateTimeFormatting.create({
        date: 'YYYY-MM-DD HH:mm Z',
        time: TimeFormatting.None,
        timeZone: 'Etc/GMT+5',
      })._unsafeUnwrap(),
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();

    const previousTz = process.env.TZ;
    try {
      for (const hostTz of ['UTC', 'America/New_York']) {
        process.env.TZ = hostTz;
        expect(parisFormat('2024-03-10T06:30:00.000Z')._unsafeUnwrap()).toBe('2024-03-10 07:30');
        expect(gmtPlus5Format('2024-03-10T07:00:00.000Z')._unsafeUnwrap()).toBe(
          '2024-03-10 02:00 -05:00'
        );
      }
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });
});
