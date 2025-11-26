/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fail } from 'assert';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod.validation.pipe';

describe('ZodValidationPipe', () => {
  describe('Basic validation', () => {
    const simpleSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    let pipe: ZodValidationPipe;

    beforeEach(() => {
      pipe = new ZodValidationPipe(simpleSchema);
    });

    it('should pass through valid data unchanged', () => {
      const validData = {
        name: 'John',
        age: 30,
      };

      const result = pipe.transform(validData, {} as any);
      expect(result).toEqual(validData);
    });

    it('should throw BadRequestException for invalid data', () => {
      const invalidData = {
        name: 'John',
        age: 'thirty', // Wrong type
      };

      expect(() => pipe.transform(invalidData, {} as any)).toThrow(BadRequestException);
    });

    it('should format error messages', () => {
      const invalidData = {
        name: 123, // Wrong type
      };

      try {
        pipe.transform(invalidData, {} as any);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as BadRequestException).message;
        expect(message).toContain('Validation error');
      }
    });
  });

  describe('Custom error messages from schema', () => {
    it('should prioritize custom error messages over generic ones', () => {
      const schemaWithCustomError = z
        .string()
        .refine((val) => val.length > 5, 'Custom error: String must be longer than 5 characters');

      const pipe = new ZodValidationPipe(schemaWithCustomError);

      try {
        pipe.transform('abc', {} as any);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as BadRequestException).message;
        // Custom error should be used
        expect(message).toContain('Custom error');
      }
    });
  });

  describe('Long error message truncation', () => {
    it('should truncate very long error messages', () => {
      const complexSchema = z.object({
        field1: z.string(),
        field2: z.string(),
        field3: z.string(),
        field4: z.string(),
        field5: z.string(),
        field6: z.string(),
        field7: z.string(),
        field8: z.string(),
        field9: z.string(),
        field10: z.string(),
        field11: z.string(),
        field12: z.string(),
        field13: z.string(),
        field14: z.string(),
        field15: z.string(),
        field16: z.string(),
        field17: z.string(),
        field18: z.string(),
        field19: z.string(),
        field20: z.string(),
        field21: z.string(),
        field22: z.string(),
        field23: z.string(),
        field24: z.string(),
        field25: z.string(),
        field26: z.string(),
        field27: z.string(),
        field28: z.string(),
        field29: z.string(),
        field30: z.string(),
      });

      const pipe = new ZodValidationPipe(complexSchema);

      try {
        pipe.transform({}, {} as any);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as BadRequestException).message;
        // If message is very long, should be truncated
        if (message.length > 1000) {
          expect(message).toContain('truncated');
        }
      }
    });
  });

  describe('Custom union error message', () => {
    it('should use custom message for invalid_union instead of detailed errors', () => {
      // Create a union with custom error message
      const schema1 = z.object({ type: z.literal('A'), value: z.string() });
      const schema2 = z.object({ type: z.literal('B'), value: z.number() });

      const unionSchema = z.union([schema1, schema2], {
        error: () => {
          return 'Custom helpful message: Please use type "A" with string value or type "B" with number value';
        },
      });

      const pipe = new ZodValidationPipe(unionSchema);

      try {
        pipe.transform({ type: 'C', value: 'test' }, {} as any);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as BadRequestException).message;
        // Should use our custom message, not the detailed union errors
        expect(message).toContain('Custom helpful message');
        expect(message).toContain('type "A"');
        expect(message).toContain('type "B"');
        // Should NOT contain the default Zod error format
        expect(message).not.toContain('Invalid input at');
      }
    });

    it('should use fromZodError for invalid_union with default message', () => {
      const schema1 = z.object({ type: z.literal('A'), value: z.string() });
      const schema2 = z.object({ type: z.literal('B'), value: z.number() });

      const unionSchema = z.union([schema1, schema2]); // No custom error

      const pipe = new ZodValidationPipe(unionSchema);

      try {
        pipe.transform({ type: 'C', value: 'test' }, {} as any);
        fail('Should have thrown');
      } catch (error) {
        const message = (error as BadRequestException).message;
        // Should use fromZodError formatting
        expect(message).toContain('Validation error');
      }
    });
  });
});
