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

    it('should strip persisted link lookup metadata from read options', () => {
      const persistedLinkLookup = {
        foreignTableId: 'tblXXX',
        lookupFieldId: 'fldYYY',
        linkFieldId: 'fldZZZ',
        relationship: 'manyOne',
        fkHostTableName: 'base.table',
        selfKeyName: '__fk_self',
        foreignKeyName: '__id',
        filterByViewId: 'viwActive',
        visibleFieldIds: ['fldYYY'],
        isOneWay: false,
        symmetricFieldId: 'fldSymmetric',
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: 'is',
              value: {
                mode: 'today',
                timeZone: 'UTC',
              },
            },
          ],
        },
      };

      const result = lookupOptionsRoSchema.safeParse(persistedLinkLookup);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        foreignTableId: 'tblXXX',
        lookupFieldId: 'fldYYY',
        linkFieldId: 'fldZZZ',
        filter: persistedLinkLookup.filter,
      });
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
      filterByViewId: 'viwActive',
      visibleFieldIds: ['fldYYY'],
    };

    const result = lookupOptionsVoSchema.safeParse(validLinkLookup);
    expect(result.success).toBe(true);
  });

  it('should keep link display config in lookup field VO payloads', () => {
    const validLinkLookup = {
      foreignTableId: 'tblXXX',
      lookupFieldId: 'fldYYY',
      linkFieldId: 'fldZZZ',
      relationship: 'manyOne',
      fkHostTableName: 'table1',
      selfKeyName: 'key1',
      foreignKeyName: 'key2',
      filterByViewId: 'viwActive',
      visibleFieldIds: ['fldYYY', 'fldZZZ'],
    };

    const result = lookupOptionsVoSchema.safeParse(validLinkLookup);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect('filterByViewId' in result.data).toBe(true);
    expect('visibleFieldIds' in result.data).toBe(true);
    if (!('filterByViewId' in result.data) || !('visibleFieldIds' in result.data)) {
      throw new Error('Expected link lookup options');
    }

    expect(result.data.filterByViewId).toBe('viwActive');
    expect(result.data.visibleFieldIds).toEqual(['fldYYY', 'fldZZZ']);
  });

  it('should accept persisted lookup metadata extensions used by realtime field payloads', () => {
    const persistedLookup = {
      baseId: 'bseXXX',
      foreignTableId: 'tblXXX',
      lookupFieldId: 'fldYYY',
      linkFieldId: 'fldZZZ',
      relationship: 'oneMany',
      fkHostTableName: 'base.table',
      selfKeyName: '__fk_self',
      foreignKeyName: '__id',
      filterByViewId: 'viwActive',
      isOneWay: false,
      symmetricFieldId: 'fldSymmetric',
    };

    const result = lookupOptionsVoSchema.safeParse(persistedLookup);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toMatchObject({
      isOneWay: false,
      symmetricFieldId: 'fldSymmetric',
    });
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
