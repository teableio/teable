/* eslint-disable sonarjs/no-duplicate-string */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType } from '@teable/core';
import { describe, beforeEach, it, expect } from 'vitest';
import type { IFormulaConversionContext } from '../../db-provider/generated-column-query/generated-column-query.interface';
import { GeneratedColumnQueryPostgres } from '../../db-provider/generated-column-query/postgres/generated-column-query.postgres';

describe('Generated Column Query PostgreSQL Integration', () => {
  let generatedColumnQuery: GeneratedColumnQueryPostgres;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeneratedColumnQueryPostgres],
    }).compile();

    generatedColumnQuery = module.get<GeneratedColumnQueryPostgres>(GeneratedColumnQueryPostgres);
  });

  describe('fieldReference behavior', () => {
    it('should return column reference with proper PostgreSQL quoting', () => {
      const result = generatedColumnQuery.fieldReference('fld1', 'field1');
      expect(result).toBe('"field1"');
    });

    it('should work with context parameter (backward compatibility)', () => {
      const context: IFormulaConversionContext = {
        fieldMap: {
          fld1: {
            columnName: 'field1',
            fieldType: FieldType.Number,
            dbGenerated: false,
          },
        },
      };

      const result = generatedColumnQuery.fieldReference('fld1', 'field1', context);
      expect(result).toBe('"field1"');
    });

    it('should handle special characters in column names', () => {
      const result = generatedColumnQuery.fieldReference('fld1', 'field_with_special_chars');
      expect(result).toBe('"field_with_special_chars"');
    });
  });
});
