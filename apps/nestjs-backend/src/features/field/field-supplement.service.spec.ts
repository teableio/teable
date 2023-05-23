/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable-group/core';
import { PrismaService } from '../../prisma.service';
import { FieldSupplementService } from './field-supplement.service';
import type { CreateFieldRo } from './model/create-field.ro';

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
      const field: CreateFieldRo = {
        name: 'text',
        type: FieldType.SingleLineText,
      };
      const result = await service.prepareFieldOptions(field);
      expect(result).toBe(field);
    });

    it('should prepare the options for a link field', async () => {
      const field: CreateFieldRo = {
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

      const result = await service.prepareFieldOptions(field);
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
      await expect(service.supplementByCreate(prisma, 'tableId', nonLinkField)).rejects.toThrow();
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
      service.generateSymmetricField = jest.fn().mockResolvedValue(sField);
      service.createForeignKeyField = jest.fn().mockResolvedValue(undefined);
      service['createLinkReference'] = jest.fn().mockResolvedValue(undefined);

      const symmetricField = await service.supplementByCreate(prisma, 'tableId', field);

      expect(symmetricField).toBe(sField);
      expect(service.generateSymmetricField).toHaveBeenCalled();
      expect(service.createForeignKeyField).toHaveBeenCalled();
      expect(service['createLinkReference']).toHaveBeenCalledTimes(2);
    });
  });
});
