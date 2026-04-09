import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type { ISchemaRule, SchemaRuleRepairHint, SchemaRuleValidationResult } from './ISchemaRule';
import {
  serializeManualRepairSchema,
  withManualRepairFieldMeta,
  withManualRepairFormMeta,
} from './ManualRepairSchema';
import { getRuleRepairHint } from './RuleRepairMetadata';

const createRule = (overrides: Partial<ISchemaRule> = {}): ISchemaRule => ({
  id: 'rule:test',
  description: 'Test rule',
  dependencies: [],
  required: true,
  repairMode: 'auto',
  isValid: vi.fn(async () => ok<SchemaRuleValidationResult, DomainError>({ valid: true })),
  up: vi.fn(() => ok([])),
  down: vi.fn(() => ok([])),
  ...overrides,
});

describe('RuleRepairMetadata', () => {
  describe('serializeManualRepairSchema', () => {
    it('should serialize zod-backed manual repair schema metadata', () => {
      const schema = withManualRepairFormMeta(
        z.object({
          resolution: withManualRepairFieldMeta(z.enum(['keep', 'drop']).default('keep'), {
            widget: 'select',
            title: { fallback: 'Resolution' },
            description: { fallback: 'Choose how to resolve the conflict.' },
            options: {
              keep: {
                value: 'keep',
                label: { fallback: 'Keep current' },
              },
              drop: {
                value: 'drop',
                label: { fallback: 'Drop duplicate' },
              },
            },
          }),
          note: withManualRepairFieldMeta(z.string().optional(), {
            widget: 'textarea',
            title: { fallback: 'Note' },
          }),
          confirm: withManualRepairFieldMeta(z.boolean(), {
            title: { fallback: 'Confirm' },
          }),
        }),
        {
          title: { fallback: 'Manual repair' },
          description: { fallback: 'Provide the required repair choices.' },
          submitLabel: { fallback: 'Apply repair' },
        }
      );

      const result = serializeManualRepairSchema(schema);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        type: 'object',
        title: { fallback: 'Manual repair' },
        description: { fallback: 'Provide the required repair choices.' },
        submitLabel: { fallback: 'Apply repair' },
        required: ['resolution', 'confirm'],
        properties: {
          resolution: {
            type: 'string',
            widget: 'select',
            title: { fallback: 'Resolution' },
            description: { fallback: 'Choose how to resolve the conflict.' },
            options: [
              { value: 'keep', label: { fallback: 'Keep current' } },
              { value: 'drop', label: { fallback: 'Drop duplicate' } },
            ],
            defaultValue: 'keep',
          },
          note: {
            type: 'string',
            widget: 'textarea',
            title: { fallback: 'Note' },
            description: undefined,
            defaultValue: undefined,
          },
          confirm: {
            type: 'boolean',
            widget: 'checkbox',
            title: { fallback: 'Confirm' },
            description: undefined,
            defaultValue: undefined,
          },
        },
      });
    });

    it('should return an error instead of throwing for unsupported property types', () => {
      const schema = z.object({
        count: z.number(),
      });

      const result = serializeManualRepairSchema(schema);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain(
        'Unsupported manual repair schema property "count"'
      );
    });

    it('should support zod default metadata stored as a direct value', () => {
      const resolution = z.enum(['keep', 'drop']).default('keep');
      const defaultSchema = resolution as typeof resolution & {
        _def: typeof resolution._def & { defaultValue: string };
      };
      defaultSchema._def.defaultValue = 'keep';

      const schema = z.object({
        resolution: withManualRepairFieldMeta(defaultSchema, {
          widget: 'select',
          title: { fallback: 'Resolution' },
          options: {
            keep: {
              value: 'keep',
              label: { fallback: 'Keep current' },
            },
            drop: {
              value: 'drop',
              label: { fallback: 'Drop duplicate' },
            },
          },
        }),
      });

      const result = serializeManualRepairSchema(schema);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().properties.resolution.defaultValue).toBe('keep');
    });
  });

  describe('getRuleRepairHint', () => {
    it('should skip statement generation during check-time hint computation', () => {
      const up = vi.fn(() => ok([]));
      const rule = createRule({ up });

      const result = getRuleRepairHint(
        rule,
        {} as SchemaRuleContext,
        { valid: false },
        { skipStatementCheck: true }
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        available: true,
        mode: 'auto',
      });
      expect(up).not.toHaveBeenCalled();
    });

    it('should prefer the rule-provided repair hint without calling up', () => {
      const up = vi.fn(() => ok([]));
      const customHint: SchemaRuleRepairHint = {
        available: false,
        mode: 'manual',
        reason: { fallback: 'Needs user choice' },
      };
      const rule = createRule({
        up,
        getRepairHint: () => ok(customHint),
      });

      const result = getRuleRepairHint(rule, {} as SchemaRuleContext, { valid: false });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(customHint);
      expect(up).not.toHaveBeenCalled();
    });

    it('should surface statement-generation failures as unavailable manual repair', () => {
      const rule = createRule({
        up: vi.fn(() => err(new Error('boom'))),
      });

      const result = getRuleRepairHint(rule, {} as SchemaRuleContext, { valid: false });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        available: false,
        mode: 'manual',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.statementGenerationFailed',
          fallback: 'Repair statements could not be generated.',
        },
        description: {
          fallback: 'boom',
        },
      });
    });
  });
});
