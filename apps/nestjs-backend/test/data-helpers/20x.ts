/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import {
  Colors,
  DateFormattingPreset,
  DateUtil,
  FieldType,
  NumberFormattingType,
  TimeFormatting,
} from '@teable/core';

const textField = {
  name: 'text field',
  description: 'the text field',
  type: FieldType.SingleLineText,
};

const numberField = {
  name: 'Number field',
  description: 'the number field',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 1 },
  },
};

const singleSelectField = {
  name: 'singleSelect field',
  description: 'the singleSelect field',
  type: FieldType.SingleSelect,
  options: {
    choices: [
      { id: 'choX', name: 'x', color: Colors.Cyan },
      { id: 'choY', name: 'y', color: Colors.Blue },
      { id: 'choZ', name: 'z', color: Colors.Gray },
    ],
  },
};

export const dateField = {
  name: 'date field',
  description: 'the date field',
  type: FieldType.Date,
  options: {
    formatting: {
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.None,

      timeZone: 'Asia/Singapore',
    },
  },
};

const checkboxField = {
  name: 'checkbox field',
  description: 'the checkbox field',
  type: FieldType.Checkbox,
};

const userField = {
  name: 'user field',
  description: 'the user field',
  type: FieldType.User,
};

const multipleSelectField = {
  name: 'multipleSelect field',
  description: 'the multipleSelect field',
  type: FieldType.MultipleSelect,
  options: {
    choices: [
      { id: 'choX', name: 'rap', color: Colors.Cyan },
      { id: 'choY', name: 'rock', color: Colors.Blue },
      { id: 'choZ', name: 'hiphop', color: Colors.Gray },
    ],
  },
};

const multipleUserField = {
  name: 'multiple user field',
  description: 'the multiple user field',
  type: FieldType.User,
  options: {
    isMultiple: true,
    shouldNotify: false,
  },
};

const formulaField = {
  name: 'formula user field',
  description: 'the formula user field',
  type: FieldType.Formula,
  options: {
    expression: '1 + 1.1',
    formatting: { type: NumberFormattingType.Decimal, precision: 1 },
  },
};

const dateFieldWithYM = {
  name: 'date field with YM',
  description: 'the date field with YM',
  type: FieldType.Date,
  options: {
    formatting: {
      date: DateFormattingPreset.YM,
      time: TimeFormatting.None,
      timeZone: 'Asia/Singapore',
    },
  },
};
export const x_20 = {
  // textField                => 0
  // numberField              => 1
  // singleSelectField        => 2
  // dateField                => 3
  // checkboxField            => 4
  // userField                => 5
  // multipleSelectField      => 6
  // multipleUserField        => 7
  // formulaField             => 8
  // dateFieldWithYM          => 9
  fields: [
    textField,
    numberField,
    singleSelectField,
    dateField,
    checkboxField,
    userField,
    multipleSelectField,
    multipleUserField,
    formulaField,
    dateFieldWithYM,
  ],

  // actual number of items: 23
  records: [
    {
      fields: {
        [textField.name]: '',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 0',
        [numberField.name]: 0,
        [dateField.name]: '2019-12-31T16:00:00.000Z',
        [dateFieldWithYM.name]: '2019-12-31T16:00:00.000Z',
        [userField.name]: { id: 'usrTestUserId', title: 'test' },
        [multipleSelectField.name]: ['rap', 'rock', 'hiphop'],
        [multipleUserField.name]: [
          { id: 'usrTestUserId', title: 'test' },
          { id: 'usrTestUserId_1', title: 'test_1' },
        ],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 1',
        [numberField.name]: 1,
        [multipleSelectField.name]: ['rap', 'rock'],
        [multipleUserField.name]: [{ id: 'usrTestUserId_1', title: 'test_1' }],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 2',
        [numberField.name]: 2,
        [checkboxField.name]: true,
        [dateField.name]: '2022-11-28T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-11-28T16:00:00.000Z',
        [multipleSelectField.name]: ['rap'],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 3',
        [numberField.name]: 3,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2022-01-27T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-01-27T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 4',
        [numberField.name]: 4,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2022-02-28T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-02-28T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 5',
        [numberField.name]: 5,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2022-03-01T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-03-01T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 6',
        [numberField.name]: 6,
        [checkboxField.name]: true,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2022-03-11T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-03-11T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 7',
        [numberField.name]: 7,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2022-05-08T16:00:00.000Z',
        [dateFieldWithYM.name]: '2022-05-08T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 8',
        [numberField.name]: 8,
        [singleSelectField.name]: 'x',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetDay(1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetDay(1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 9',
        [numberField.name]: 9,
        [singleSelectField.name]: 'x',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetDay(-1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetDay(-1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 10',
        [numberField.name]: 10,
        [singleSelectField.name]: 'y',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetWeek(1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetWeek(1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 11',
        [numberField.name]: 11,
        [singleSelectField.name]: 'z',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetWeek(-1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetWeek(-1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 12',
        [numberField.name]: 12,
        [checkboxField.name]: true,
        [singleSelectField.name]: 'z',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetMonth(1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetMonth(1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 13',
        [numberField.name]: 13,
        [singleSelectField.name]: 'y',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offsetMonth(-1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offsetMonth(-1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 14',
        [numberField.name]: 14,
        [singleSelectField.name]: 'y',
        [dateField.name]: new DateUtil('Asia/Singapore', true).offset('year', 1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offset('year', 1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 15',
        [numberField.name]: 15,
        [multipleSelectField.name]: ['rock', 'hiphop'],
        [dateField.name]: new DateUtil('Asia/Singapore', true).offset('year', -1),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).offset('year', -1),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 16',
        [numberField.name]: 16,
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 17',
        [numberField.name]: 17,
        [multipleSelectField.name]: ['rock'],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 18',
        [numberField.name]: 18,
        [multipleSelectField.name]: ['hiphop'],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 19',
        [numberField.name]: 19,
        [multipleSelectField.name]: ['rap', 'hiphop'],
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 20',
        [numberField.name]: 20,
        [checkboxField.name]: true,
        [dateField.name]: new DateUtil('Asia/Singapore', true).date().toISOString(),
        [dateFieldWithYM.name]: new DateUtil('Asia/Singapore', true).date().toISOString(),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 10',
        [numberField.name]: 10,
        [dateField.name]: '2099-12-31T15:59:59.000Z',
        [dateFieldWithYM.name]: '2099-12-31T15:59:59.000Z',
        [multipleSelectField.name]: ['rap', 'rock', 'hiphop'],
      },
    },
  ],
};
