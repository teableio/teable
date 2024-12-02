/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { CalculationModule } from './calculation.module';
import { ReferenceService } from './reference.service';

describe('ReferenceService', () => {
  let service: ReferenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<ReferenceService>(ReferenceService);
  });

  describe('revertFkMap', () => {
    it('should handle simple one-to-one change', () => {
      const fkMap = {
        b1: { newKey: ['a1'], oldKey: ['a1', 'a2'] },
        b2: { newKey: ['a2'], oldKey: [] },
      };

      const result = service.revertFkMap(fkMap);

      expect(result).toEqual({
        a2: { newKey: ['b2'], oldKey: ['b1'] },
      });
    });

    it('should handle multiple changes for one record', () => {
      const fkMap = {
        b1: { newKey: [], oldKey: ['a1'] },
        b2: { newKey: ['a1'], oldKey: [] },
        b3: { newKey: [], oldKey: ['a1'] },
      };

      const result = service.revertFkMap(fkMap);

      expect(result).toEqual({
        a1: { newKey: ['b2'], oldKey: ['b1', 'b3'] },
      });
    });

    it('should handle empty input', () => {
      const fkMap = {};
      const result = service.revertFkMap(fkMap);
      expect(result).toEqual({});
    });

    it('should handle null values', () => {
      const fkMap = {
        b1: { newKey: null, oldKey: null },
      };

      const result = service.revertFkMap(fkMap);
      expect(result).toEqual({});
    });

    it('should handle complex chain of changes', () => {
      const fkMap = {
        b1: { newKey: ['a2'], oldKey: ['a1'] },
        b2: { newKey: ['a3'], oldKey: ['a2'] },
        b3: { newKey: ['a1'], oldKey: ['a3'] },
      };

      const result = service.revertFkMap(fkMap);

      expect(result).toEqual({
        a1: { newKey: ['b3'], oldKey: ['b1'] },
        a2: { newKey: ['b1'], oldKey: ['b2'] },
        a3: { newKey: ['b2'], oldKey: ['b3'] },
      });
    });

    it('should handle records with no changes', () => {
      const fkMap = {
        b1: { newKey: ['a1'], oldKey: ['a1'] },
        b2: { newKey: ['a2'], oldKey: ['a2'] },
      };

      const result = service.revertFkMap(fkMap);
      expect(result).toEqual({});
    });

    it('should handle multiple new values for one old value', () => {
      const fkMap = {
        b1: { newKey: ['a2', 'a3'], oldKey: ['a1'] },
        b2: { newKey: [], oldKey: ['a2'] },
      };

      const result = service.revertFkMap(fkMap);

      expect(result).toEqual({
        a1: { newKey: [], oldKey: ['b1'] },
        a2: { newKey: ['b1'], oldKey: ['b2'] },
        a3: { newKey: ['b1'], oldKey: [] },
      });
    });
  });
});
