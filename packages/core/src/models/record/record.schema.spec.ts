import { CellFormat, FieldKeyType } from './record';
import { getRecordsQuerySchema, recordSchema, recordsVoSchema } from './record.schema';

describe('recordsRoSchema', () => {
  const validData = {
    take: 10,
    skip: 0,
    recordIds: ['recXXXXXXX'],
    viewId: 'viwXXXXXXX',
    projection: { field1: true, field2: true },
    cellFormat: CellFormat.Json,
    fieldKeyType: FieldKeyType.Name,
  };

  it('validates successfully for correct data', () => {
    const result = getRecordsQuerySchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails for invalid take', () => {
    const data = { ...validData, take: -1 };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual('You should at least take 1 record');
  });

  it('fails for invalid skip', () => {
    const data = { ...validData, skip: -1 };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual(
        'You can not skip a negative count of records'
      );
  });

  it('fails for invalid recordIds', () => {
    const data = { ...validData, recordIds: ['invalidRecordId'] };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual('Error recordIds, recordId is illegal');
  });

  it('validates successfully for empty projection', () => {
    const data = { ...validData, projection: {} };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('fails for invalid projection (non-string array)', () => {
    const data = { ...validData, projection: { field1: 1, field2: 2 } };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual('Expected boolean, received number');
  });

  it('fails for invalid viewId', () => {
    const data = { ...validData, viewId: 'xxx' };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual('Invalid input: must start with "viw"');
  });

  it('fails for invalid cellFormat', () => {
    const data = { ...validData, cellFormat: 'invalidFormat' };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual(
        'Error cellFormate, You should set it to "json" or "text"'
      );
  });

  it('fails for invalid fieldKeyType', () => {
    const data = { ...validData, fieldKeyType: 'invalidKey' };
    const result = getRecordsQuerySchema.safeParse(data);
    expect(result.success).toBe(false);
    !result.success &&
      expect(result.error.errors[0].message).toEqual(
        'Error fieldKeyType, You should set it to "name" or "id"'
      );
  });
});

describe('recordSchema', () => {
  const validData = {
    id: 'recXXXXXXX',
    fields: {
      fieldName: 'value',
    },
    createdTime: '2023-01-01T00:00:00.000Z',
    lastModifiedTime: '2023-01-02T00:00:00.000Z',
    createdBy: 'user',
    lastModifiedBy: 'user',
    recordOrder: { viwXXXXXXX: 1 },
  };

  it('validates successfully for valid data', () => {
    const result = recordSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails for missing required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...validData };
    delete data.id;
    const result = recordSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Required');
    }
  });

  it('fails for invalid fields (non-object)', () => {
    const data = { ...validData, fields: 'invalidFields' };
    const result = recordSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Expected object, received string');
    }
  });

  it('validates successfully for missing optional fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...validData };
    delete data.createdBy;
    const result = recordSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('fails for invalid recordOrder (non-number values)', () => {
    const data = { ...validData, recordOrder: { viwXXXXXXX: 'invalidValue' } };
    const result = recordSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Expected number, received string');
    }
  });
});

describe('recordsVoSchema', () => {
  const validData = {
    records: [
      {
        id: 'recXXXXXXX',
        fields: {
          fldXXXXXXXXXXXXXXX: 'text value',
        },
        recordOrder: {},
      },
    ],
    total: 1,
  };

  it('validates successfully for valid data', () => {
    const result = recordsVoSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails for missing required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...validData };
    delete data.total;
    const result = recordsVoSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Required');
    }
  });

  it('fails for invalid records (non-array)', () => {
    const data = { ...validData, records: 'invalidRecords' };
    const result = recordsVoSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Expected array, received string');
    }
  });

  it('fails for invalid total (non-number)', () => {
    const data = { ...validData, total: 'invalidTotal' };
    const result = recordsVoSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toEqual('Expected number, received string');
    }
  });
});
