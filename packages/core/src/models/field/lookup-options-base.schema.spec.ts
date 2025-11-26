import { lookupOptionsRoSchema, lookupOptionsVoSchema } from './lookup-options-base.schema';

describe('lookupOptionsRoSchema validation', () => {
  describe('Valid lookup options', () => {
    it('should pass with correct link lookup options', () => {
      const validLinkLookup = {
        foreignTableId: 'tblXXX',
        lookupFieldId: 'fldYYY',
        linkFieldId: 'fldZZZ',
      };

      const result = lookupOptionsRoSchema.safeParse(validLinkLookup);
      expect(result.success).toBe(true);
    });
  });

  describe('Common mistakes detection', () => {
    it('should provide helpful error when expression is in lookupOptions instead of options', () => {
      const wrongStructure = {
        linkFieldId: 'fldXXX',
        lookupFieldId: 'fldYYY',
        foreignTableId: 'tblZZZ',
        expression: 'sum({values})', // Wrong place! Should be in field options
      };

      const result = lookupOptionsRoSchema.safeParse(wrongStructure);
      expect(result.success).toBe(false);

      if (!result.success) {
        const errorMessage = result.error.issues[0].message;

        // Should provide clear guidance about rollup field configuration
        expect(errorMessage).toContain('Rollup field configuration error');
        expect(errorMessage).toContain('expression');
        expect(errorMessage).toContain('options');
        expect(errorMessage).toContain('lookupOptions');

        // Should NOT be confusing union error starting with "Invalid"
        expect(errorMessage).not.toMatch(/^Invalid/);
      }
    });

    it('should reject unrecognized keys with helpful error message', () => {
      const invalidKeys = {
        foreignTableId: 'tblXXX',
        lookupFieldId: 'fldYYY',
        linkFieldId: 'fldZZZ',
        unknownKey: 'value', // Unrecognized key
      };

      const result = lookupOptionsRoSchema.safeParse(invalidKeys);
      expect(result.success).toBe(false);

      if (!result.success) {
        // With custom error handler, we get 1 issue with helpful message
        expect(result.error.issues).toHaveLength(1);

        const errorMessage = result.error.issues[0].message;
        // Should provide clear error about link lookup and mention unrecognized key
        expect(errorMessage).toContain('Link lookup error');
        expect(errorMessage).toContain('Unrecognized key');
      }
    });

    it('should provide clear error for missing required fields', () => {
      const missingFields = {
        linkFieldId: 'fldXXX',
        // Missing foreignTableId and lookupFieldId
      };

      const result = lookupOptionsRoSchema.safeParse(missingFields);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have exactly 1 issue from custom error handler
        expect(result.error.issues).toHaveLength(1);

        const errorMessage = result.error.issues[0].message;
        // Should provide clear context about link lookup
        expect(errorMessage).toContain('Link lookup error');
        // Should indicate the type of problem (invalid/missing field)
        expect(errorMessage).toContain('Invalid input');
      }
    });
  });
});

describe('lookupOptionsVoSchema validation', () => {
  it('should pass with correct link lookup options', () => {
    const validLinkLookup = {
      foreignTableId: 'tblXXX',
      lookupFieldId: 'fldYYY',
      linkFieldId: 'fldZZZ',
      relationship: 'manyOne',
      fkHostTableName: 'table1',
      selfKeyName: 'key1',
      foreignKeyName: 'key2',
    };

    const result = lookupOptionsVoSchema.safeParse(validLinkLookup);
    expect(result.success).toBe(true);
  });

  it('should provide helpful error when expression is misplaced', () => {
    const wrongStructure = {
      linkFieldId: 'fldXXX',
      lookupFieldId: 'fldYYY',
      foreignTableId: 'tblZZZ',
      relationship: 'manyOne',
      fkHostTableName: 'table1',
      selfKeyName: 'key1',
      foreignKeyName: 'key2',
      expression: 'sum({values})', // Wrong place!
    };

    const result = lookupOptionsVoSchema.safeParse(wrongStructure);
    expect(result.success).toBe(false);

    if (!result.success) {
      const errorMessage = result.error.issues[0].message;
      expect(errorMessage).toContain('Rollup field configuration error');
      expect(errorMessage).toContain('expression');
      expect(errorMessage).toContain('options');
    }
  });
});
