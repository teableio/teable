import type { IRecord } from '../../models';
import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import { RecordId, TextAll } from './system';

describe('SystemFunc', () => {
  const textAllFunc = new TextAll();

  describe('TextAll', () => {
    it('should process single string correctly', () => {
      const result = textAllFunc.eval([new TypedValue('Hello', CellValueType.String, false)]);

      expect(result).toBe('Hello');
    });

    it('should process array of strings correctly', () => {
      const result = textAllFunc.eval([
        new TypedValue(['Hello', 'World'], CellValueType.String, true),
      ]);

      expect(result).toEqual(['Hello', 'World']);
    });

    it('should return null for null input', () => {
      const result = textAllFunc.eval([new TypedValue(null, CellValueType.String, false)]);

      expect(result).toBeNull();
    });

    it('should throw an error when more than 1 param provided', () => {
      expect(() =>
        textAllFunc.validateParams([
          new TypedValue('Hello', CellValueType.String, false),
          new TypedValue('World', CellValueType.String, false),
        ])
      ).toThrowError(`${textAllFunc.name} only allow 1 param`);
    });
  });

  describe('RecordId', () => {
    const record: IRecord = {
      id: 'recTest',
      fields: {},
      createdTime: new Date().toISOString(),
    };
    const context = {
      record,
      dependencies: {},
      timeZone: 'Asia/Shanghai',
    };

    it('should return record id', () => {
      const recordIdFunc = new RecordId();

      const result = recordIdFunc.eval([], context);

      expect(result).toBe('recTest');
    });
  });
});
