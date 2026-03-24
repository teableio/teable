import { FieldKeyType, HttpErrorCode } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { RecordModifySharedService } from './record-modify.shared.service';

vi.mock('@teable/db-main-prisma', () => ({
  PrismaService: class PrismaService {},
  PrismaModule: class PrismaModule {},
}));

vi.mock('@prisma/client', () => ({
  Prisma: {},
  PrismaClient: class PrismaClient {},
}));

describe('RecordModifySharedService', () => {
  const createService = () =>
    new RecordModifySharedService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

  it('includes available field keys when create-record input references missing field names', () => {
    const service = createService();
    const getEffectFieldInstances = (
      service as unknown as {
        getEffectFieldInstances: (
          table: {
            getFieldsMap: (fieldKeyType: FieldKeyType) => Map<string, { id: string; name: string }>;
          },
          recordsFields: Record<string, unknown>[],
          fieldKeyType: FieldKeyType,
          ignoreMissingFields?: boolean
        ) => unknown;
      }
    ).getEffectFieldInstances.bind(service);

    const table = {
      getFieldsMap: (fieldKeyType: FieldKeyType) => {
        expect(fieldKeyType).toBe(FieldKeyType.Name);
        return new Map([
          ['Name', { id: 'fldName', name: 'Name' }],
          ['Status', { id: 'fldStatus', name: 'Status' }],
        ]);
      },
    };

    try {
      getEffectFieldInstances(
        table,
        [{ Name: 'Task A', 'Source ID 2': 'source-1' }],
        FieldKeyType.Name
      );
      expect.unreachable('Expected getEffectFieldInstances to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CustomHttpException);

      const httpError = error as CustomHttpException;
      expect(httpError.code).toBe(HttpErrorCode.NOT_FOUND);
      expect(httpError.message).toBe('Field "Source ID 2" does not exist in this table');
      expect(httpError.data).toMatchObject({
        fieldKeyType: FieldKeyType.Name,
        missedFields: ['Source ID 2'],
        availableFieldKeys: ['Name', 'Status'],
      });
    }
  });
});
