/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IFieldRo } from '@teable-group/core';
import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable-group/core';
import { PrismaService } from '../../prisma.service';
import { FieldSupplementService } from './field-supplement.service';
import { createFieldInstanceByRo } from './model/factory';

describe('FieldSupplementService', () => {
  let service: FieldSupplementService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldSupplementService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<FieldSupplementService>(FieldSupplementService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('prepareFieldOptions', () => {
    it('should return the field if it is not a link field', async () => {
      const field: IFieldRo = {
        name: 'text',
        type: FieldType.SingleLineText,
      };
      const preparedField = {
        name: 'text',
        type: FieldType.SingleLineText,
        options: {},
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        isMultipleCellValue: false,
        isComputed: false,
      };
      const result = await service.prepareField(field);
      expect(result).toEqual(preparedField);
    });

    it('should prepare the options for a link field', async () => {
      const field: IFieldRo = {
        name: 'link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: 'foreignTable',
          // lookupFieldId
          // dbForeignKeyName
          // symmetricFieldId
        },
      };
      const mockField = { id: 'mockFieldId' };
      (prismaService as any).field = { findFirstOrThrow: jest.fn().mockResolvedValue(mockField) };

      const result = await service.prepareField(field);
      expect(result.id).toBeDefined();
      expect(result.options).toMatchObject({ lookupFieldId: mockField.id });
      expect(prismaService.field.findFirstOrThrow).toHaveBeenCalled();
    });
  });

  describe('supplementByCreate', () => {
    // setup prisma transaction client mock
    const prisma: any = {
      /* mock object */
    };

    // assume field is a link field
    const field: any = {
      type: FieldType.Link,
      options: {
        foreignTableId: 'foreignTableId',
        relationship: Relationship.ManyOne,
      },
    };

    it('should throw an error if the field is not a link field', async () => {
      const nonLinkField: any = { type: FieldType.SingleLineText /* other properties */ };
      await expect(
        service.createSupplementation(prisma, 'tableId', nonLinkField)
      ).rejects.toThrow();
    });

    it('should create symmetric field, foreign key field, and link reference for a link field', async () => {
      // setup mocks
      const sField = {
        type: FieldType.Link,
        options: {
          foreignTableId: 'tableId',
          relationship: Relationship.OneMany,
        },
      };
      service['generateSymmetricField'] = jest.fn().mockResolvedValue(sField);
      service['createForeignKeyField'] = jest.fn().mockResolvedValue(undefined);

      const symmetricField = await service.createSupplementation(prisma, 'tableId', field);

      expect(symmetricField).toBe(sField);
      expect(service['generateSymmetricField']).toHaveBeenCalled();
      expect(service['createForeignKeyField']).toHaveBeenCalledTimes(1);
    });
  });

  describe('createReference', () => {
    it('should create reference by link field', async () => {
      // setup mocks
      const linkField = {
        id: 'linkFieldId',
        name: 'link',
        type: FieldType.Link,
        options: {
          foreignTableId: 'tableId',
          relationship: Relationship.ManyOne,
          lookupFieldId: 'lookupFieldId',
          dbForeignKeyName: '__fk_linkFieldId',
          symmetricFieldId: 'symmetricFieldId',
        },
      };
      (prismaService as any).reference = { create: jest.fn().mockResolvedValue(undefined) };
      await service['createReference'](prismaService, createFieldInstanceByRo(linkField));

      expect(prismaService.reference.create).toBeCalledWith({
        data: {
          fromFieldId: 'lookupFieldId',
          toFieldId: 'linkFieldId',
        },
      });
    });

    it('should create reference by formula field', async () => {
      // setup mocks
      const formulaField = {
        id: 'formulaFieldId',
        name: 'formula',
        type: FieldType.Formula,
        options: {
          expression: 'concat({field1Id} + {field2Id}, {field3Id})',
        },
      };
      (prismaService as any).reference = { create: jest.fn().mockResolvedValue(undefined) };
      await service['createReference'](prismaService, createFieldInstanceByRo(formulaField));

      expect(prismaService.reference.create).toHaveBeenNthCalledWith(1, {
        data: {
          fromFieldId: 'field1Id',
          toFieldId: 'formulaFieldId',
        },
      });
      expect(prismaService.reference.create).toHaveBeenNthCalledWith(2, {
        data: {
          fromFieldId: 'field2Id',
          toFieldId: 'formulaFieldId',
        },
      });
      expect(prismaService.reference.create).toHaveBeenNthCalledWith(3, {
        data: {
          fromFieldId: 'field3Id',
          toFieldId: 'formulaFieldId',
        },
      });
    });
  });
});
