/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable/core';
import { GlobalModule } from '../../../global/global.module';
import { FieldService } from '../field.service';
import { FieldCalculateModule } from './field-calculate.module';
import { FieldSupplementService } from './field-supplement.service';

describe('FieldSupplementService', () => {
  let service: FieldSupplementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldCalculateModule],
    }).compile();

    const fieldService = module.get<FieldService>(FieldService);
    service = module.get<FieldSupplementService>(FieldSupplementService);
    fieldService.generateDbFieldName = vi.fn().mockImplementation((name) => name);
  });

  describe('supplementByCreate', () => {
    it('should throw an error if the field is not a link field', async () => {
      const nonLinkField: any = { type: FieldType.SingleLineText /* other properties */ };
      await expect(service.createForeignKey(nonLinkField)).rejects.toThrow();
    });
  });
});
