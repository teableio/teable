/* eslint-disable @typescript-eslint/naming-convention */
import { faker } from '@faker-js/faker';
import {
  Colors,
  DateFormattingPreset,
  FieldType,
  generateFieldId,
  NumberFormattingType,
  TimeFormatting,
} from '@teable-group/core';

const textField = {
  id: generateFieldId(),
  name: 'text field',
  description: 'the text field',
  type: FieldType.SingleLineText,
};

const numberField = {
  id: generateFieldId(),
  name: 'Number field',
  description: 'the number field',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 1 },
  },
};

const singleSelectField = {
  id: generateFieldId(),
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

const dateField = {
  id: generateFieldId(),
  name: 'date field',
  description: 'the date field',
  type: FieldType.Date,
  options: {
    formatting: {
      date: DateFormattingPreset.ISO,
      time: TimeFormatting.None,
      timeZone: 'utc',
    },
  },
};

const checkboxField = {
  id: generateFieldId(),
  name: 'checkbox field',
  description: 'the checkbox field',
  type: FieldType.Checkbox,
};

const userField = {
  id: generateFieldId(),
  name: 'user field',
  description: 'the user field',
  type: FieldType.User,
};

export const x_20 = {
  fields: [textField, numberField, singleSelectField, dateField, checkboxField, userField],

  records: [
    {
      fields: {},
    },
    {
      fields: {
        [textField.name]: 'Text Field 0',
        [numberField.name]: 0,
        [dateField.name]: '2019-12-31T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 1',
        [numberField.name]: 1,
        [dateField.name]: faker.date.past({ years: 1 }).toISOString(),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 2',
        [numberField.name]: 2,
        [checkboxField.name]: true,
        [dateField.name]: '2023-11-28T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 3',
        [numberField.name]: 3,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2023-01-27T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 4',
        [numberField.name]: 4,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2023-02-28T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 5',
        [numberField.name]: 5,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2023-03-01T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 6',
        [numberField.name]: 6,
        [checkboxField.name]: true,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2023-03-11T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 7',
        [numberField.name]: 7,
        [singleSelectField.name]: 'x',
        [dateField.name]: '2023-05-08T16:00:00.000Z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 8',
        [numberField.name]: 8,
        [singleSelectField.name]: 'x',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 9',
        [numberField.name]: 9,
        [singleSelectField.name]: 'x',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 10',
        [numberField.name]: 10,
        [singleSelectField.name]: 'y',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 11',
        [numberField.name]: 11,
        [singleSelectField.name]: 'z',
        [dateField.name]: faker.date.future({ years: 1 }).toISOString(),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 12',
        [numberField.name]: 12,
        [checkboxField.name]: true,
        [singleSelectField.name]: 'z',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 13',
        [numberField.name]: 13,
        [singleSelectField.name]: 'y',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 14',
        [numberField.name]: 14,
        [singleSelectField.name]: 'y',
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 15',
        [numberField.name]: 15,
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
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 18',
        [numberField.name]: 18,
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 19',
        [numberField.name]: 19,
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 20',
        [numberField.name]: 20,
        [checkboxField.name]: true,
        [dateField.name]: new Date().toISOString(),
      },
    },
    {
      fields: {
        [textField.name]: 'Text Field 10',
        [numberField.name]: 10,
        [dateField.name]: '2099-12-31T15:59:59.000Z',
      },
    },
  ],
};
