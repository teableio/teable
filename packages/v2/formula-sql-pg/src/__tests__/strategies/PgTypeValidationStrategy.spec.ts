import { describe, it, expect } from 'vitest';

import { Pg16TypeValidationStrategy } from '../../strategies/Pg16TypeValidationStrategy';
import { PgLegacyTypeValidationStrategy } from '../../strategies/PgLegacyTypeValidationStrategy';

describe('Pg16TypeValidationStrategy', () => {
  const strategy = new Pg16TypeValidationStrategy();

  it('generates pg_input_is_valid SQL for timestamptz', () => {
    expect(strategy.isValidForType('val::text', 'timestamptz')).toBe(
      "pg_input_is_valid(val::text, 'timestamptz')"
    );
  });

  it('generates pg_input_is_valid SQL for timestamp', () => {
    expect(strategy.isValidForType('val::text', 'timestamp')).toBe(
      "pg_input_is_valid(val::text, 'timestamp')"
    );
  });

  it('generates pg_input_is_valid SQL for numeric', () => {
    expect(strategy.isValidForType('val::text', 'numeric')).toBe(
      "pg_input_is_valid(val::text, 'numeric')"
    );
  });

  it('generates pg_input_is_valid SQL for jsonb', () => {
    expect(strategy.isValidForType('val::text', 'jsonb')).toBe(
      "pg_input_is_valid(val::text, 'jsonb')"
    );
  });

  it('handles complex SQL expressions', () => {
    const complexExpr = '(CASE WHEN x IS NULL THEN NULL ELSE x END)::text';
    expect(strategy.isValidForType(complexExpr, 'numeric')).toBe(
      `pg_input_is_valid(${complexExpr}, 'numeric')`
    );
  });
});

describe('PgLegacyTypeValidationStrategy', () => {
  const strategy = new PgLegacyTypeValidationStrategy();

  it('does not contain pg_input_is_valid for timestamptz', () => {
    const sql = strategy.isValidForType('val::text', 'timestamptz');
    expect(sql).not.toContain('pg_input_is_valid');
    expect(sql).toContain('teable_try_cast_valid');
  });

  it('does not contain pg_input_is_valid for timestamp', () => {
    const sql = strategy.isValidForType('val::text', 'timestamp');
    expect(sql).not.toContain('pg_input_is_valid');
    expect(sql).toContain('teable_try_cast_valid');
  });

  it('does not contain pg_input_is_valid for numeric', () => {
    const sql = strategy.isValidForType('val::text', 'numeric');
    expect(sql).not.toContain('pg_input_is_valid');
    expect(sql).toContain('teable_try_cast_valid');
  });

  it('does not contain pg_input_is_valid for jsonb', () => {
    const sql = strategy.isValidForType('val::text', 'jsonb');
    expect(sql).not.toContain('pg_input_is_valid');
    expect(sql).toContain('teable_try_cast_valid');
  });

  it('uses schema-qualified polyfill function', () => {
    const sql = strategy.isValidForType('val::text', 'timestamptz');
    expect(sql).toContain('public.teable_try_cast_valid');
  });

  it('handles complex SQL expressions', () => {
    const complexExpr = '(CASE WHEN x IS NULL THEN NULL ELSE x END)::text';
    const sql = strategy.isValidForType(complexExpr, 'numeric');
    expect(sql).toContain(complexExpr);
    expect(sql).toContain('teable_try_cast_valid');
  });
});

describe('Strategy interface contract', () => {
  const pg16Strategy = new Pg16TypeValidationStrategy();
  const legacyStrategy = new PgLegacyTypeValidationStrategy();

  const validationTypes = ['timestamptz', 'timestamp', 'numeric', 'jsonb'] as const;

  it.each(validationTypes)('both strategies handle %s type', (typeName) => {
    const pg16Sql = pg16Strategy.isValidForType('val::text', typeName);
    const legacySql = legacyStrategy.isValidForType('val::text', typeName);

    // Both should return non-empty strings
    expect(typeof pg16Sql).toBe('string');
    expect(pg16Sql.length).toBeGreaterThan(0);
    expect(typeof legacySql).toBe('string');
    expect(legacySql.length).toBeGreaterThan(0);

    // Both should include the type name
    expect(pg16Sql).toContain(typeName);
    expect(legacySql).toContain(typeName);
  });
});
