import { describe, it, expect } from 'vitest';
import {
  getGeneratedColumnName,
  isGeneratedColumnName,
  getOriginalFieldNameFromGenerated,
} from './generated-column';

describe('Generated Column Utilities', () => {
  describe('getGeneratedColumnName', () => {
    it('should append ___generated suffix to field name', () => {
      expect(getGeneratedColumnName('field1')).toBe('field1___generated');
      expect(getGeneratedColumnName('my_field')).toBe('my_field___generated');
      expect(getGeneratedColumnName('very_long_field_name')).toBe(
        'very_long_field_name___generated'
      );
    });

    it('should handle empty string', () => {
      expect(getGeneratedColumnName('')).toBe('___generated');
    });

    it('should handle field names with special characters', () => {
      expect(getGeneratedColumnName('field-with-dashes')).toBe('field-with-dashes___generated');
      expect(getGeneratedColumnName('field_with_underscores')).toBe(
        'field_with_underscores___generated'
      );
    });
  });

  describe('isGeneratedColumnName', () => {
    it('should return true for generated column names', () => {
      expect(isGeneratedColumnName('field1___generated')).toBe(true);
      expect(isGeneratedColumnName('my_field___generated')).toBe(true);
      expect(isGeneratedColumnName('___generated')).toBe(true);
    });

    it('should return false for non-generated column names', () => {
      expect(isGeneratedColumnName('field1')).toBe(false);
      expect(isGeneratedColumnName('my_field')).toBe(false);
      expect(isGeneratedColumnName('field1_generated')).toBe(false); // Only two underscores
      expect(isGeneratedColumnName('field1___generate')).toBe(false); // Wrong suffix
      expect(isGeneratedColumnName('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isGeneratedColumnName('field___generated___generated')).toBe(true); // Ends with the pattern
      expect(isGeneratedColumnName('generated___generated')).toBe(true);
    });
  });

  describe('getOriginalFieldNameFromGenerated', () => {
    it('should extract original field name from generated column name', () => {
      expect(getOriginalFieldNameFromGenerated('field1___generated')).toBe('field1');
      expect(getOriginalFieldNameFromGenerated('my_field___generated')).toBe('my_field');
      expect(getOriginalFieldNameFromGenerated('very_long_field_name___generated')).toBe(
        'very_long_field_name'
      );
    });

    it('should return original name if not a generated column name', () => {
      expect(getOriginalFieldNameFromGenerated('field1')).toBe('field1');
      expect(getOriginalFieldNameFromGenerated('my_field')).toBe('my_field');
      expect(getOriginalFieldNameFromGenerated('field1_generated')).toBe('field1_generated');
    });

    it('should handle edge cases', () => {
      expect(getOriginalFieldNameFromGenerated('___generated')).toBe('');
      expect(getOriginalFieldNameFromGenerated('field___generated___generated')).toBe(
        'field___generated'
      );
    });
  });

  describe('Integration tests', () => {
    it('should be reversible for valid field names', () => {
      const originalNames = ['field1', 'my_field', 'very_long_field_name', 'field-with-dashes'];

      originalNames.forEach((originalName) => {
        const generatedName = getGeneratedColumnName(originalName);
        expect(isGeneratedColumnName(generatedName)).toBe(true);
        expect(getOriginalFieldNameFromGenerated(generatedName)).toBe(originalName);
      });
    });

    it('should maintain consistency across multiple transformations', () => {
      const fieldName = 'test_field';
      const generated1 = getGeneratedColumnName(fieldName);
      const generated2 = getGeneratedColumnName(fieldName);

      expect(generated1).toBe(generated2);
      expect(generated1).toBe('test_field___generated');
    });
  });
});
