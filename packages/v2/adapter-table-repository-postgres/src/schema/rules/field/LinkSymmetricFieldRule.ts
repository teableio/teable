import { domainError, type DomainError, type LinkField } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleManualRepairOptions,
  SchemaRuleManualRepairValues,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  serializeManualRepairSchema,
  withManualRepairFieldMeta,
  withManualRepairFormMeta,
} from '../core/ManualRepairSchema';

/**
 * Schema rule for validating Link field symmetric relationship integrity.
 *
 * This rule checks for common data corruption issues in link fields:
 * 1. symmetricFieldId points to a non-existent field
 * 2. symmetricFieldId points to a non-link field (e.g., formula field)
 * 3. Bidirectional relationship is broken (A -> B, but B -/-> A)
 * 4. Multiple link fields share the same symmetricFieldId (should be unique)
 */
export class LinkSymmetricFieldRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;
  readonly repairMode = 'manual' as const;

  private readonly manualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(
        z.enum(['keep_current_link', 'convert_duplicate_to_one_way']),
        {
          widget: 'select',
          title: {
            key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.resolutionLabel',
            fallback: 'Repair strategy',
          },
          description: {
            key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.resolutionDescription',
            fallback:
              'Decide which field keeps the current two-way link, or convert the duplicate link into a one-way link before repairing.',
          },
          options: {
            keep_current_link: {
              value: 'keep_current_link',
              label: {
                key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.option.keepCurrent',
                fallback: 'Keep the current link as the two-way source',
              },
            },
            convert_duplicate_to_one_way: {
              value: 'convert_duplicate_to_one_way',
              label: {
                key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.option.convertDuplicate',
                fallback: 'Convert the duplicate link to one-way',
              },
            },
          },
        }
      ).default('keep_current_link'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.title',
        fallback: 'Resolve symmetric field conflict',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricField.description',
        fallback:
          'This rule cannot be repaired automatically. The user must choose how to handle the duplicate two-way link.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

  private readonly missingTargetManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['convert_current_to_one_way']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldMissing.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldMissing.resolutionDescription',
          fallback:
            'The paired field no longer exists. Convert the current link to a one-way link so the existing relation data can keep using its stored link structure.',
        },
        options: {
          convert_current_to_one_way: {
            value: 'convert_current_to_one_way',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldMissing.option.convertCurrent',
              fallback: 'Convert the current link to one-way',
            },
          },
        },
      }).default('convert_current_to_one_way'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldMissing.title',
        fallback: 'Resolve missing paired link field',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldMissing.description',
        fallback:
          'The paired link field has been deleted. Confirm converting this field to a one-way link before repairing.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

  private readonly brokenPairManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['convert_current_to_one_way']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldBroken.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldBroken.resolutionDescription',
          fallback:
            'The paired field does not point back to this field. Convert the current link to a one-way link so it no longer depends on the broken pair.',
        },
        options: {
          convert_current_to_one_way: {
            value: 'convert_current_to_one_way',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldBroken.option.convertCurrent',
              fallback: 'Convert the current link to one-way',
            },
          },
        },
      }).default('convert_current_to_one_way'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldBroken.title',
        fallback: 'Resolve broken paired link field',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.symmetricFieldBroken.description',
        fallback:
          'The paired link field exists but is not a valid two-way counterpart. Confirm converting this field to a one-way link before repairing.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

  private constructor(
    private readonly field: LinkField,
    private readonly symmetricFieldId: string
  ) {
    this.id = `symmetric_field:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Symmetric field relationship for "${name}"`;
  }

  /**
   * Creates a LinkSymmetricFieldRule for a two-way link field.
   * Returns undefined for one-way links (no symmetric field to validate).
   */
  static forField(field: LinkField): LinkSymmetricFieldRule | undefined {
    if (field.isOneWay()) {
      return undefined;
    }

    const symmetricFieldId = field.symmetricFieldId();
    if (!symmetricFieldId) {
      return undefined;
    }

    return new LinkSymmetricFieldRule(field, symmetricFieldId.toString());
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const currentFieldId = this.field.id().toString();
    const symmetricFieldId = this.symmetricFieldId;
    const missing: string[] = [];
    const currentFieldResult = await ctx.db
      .selectFrom('field')
      .select(['options'])
      .where('id', '=', currentFieldId)
      .executeTakeFirst();

    if (currentFieldResult) {
      const currentOptionsResult = this.parseLinkOptions(currentFieldResult.options);
      if (currentOptionsResult.isErr()) {
        return err(currentOptionsResult.error);
      }

      if (currentOptionsResult.value.isOneWay === true) {
        return ok({ valid: true });
      }
    }

    // 1. Check if symmetric field exists and get its details
    const symmetricFieldResult = await ctx.db
      .selectFrom('field')
      .select(['id', 'name', 'type', 'options'])
      .where('id', '=', symmetricFieldId)
      .executeTakeFirst();

    if (!symmetricFieldResult) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" does not exist (field may have been deleted)`
      );
      return ok({
        valid: false,
        missing,
        missingItems: [
          {
            code: 'symmetric_field_missing',
            message: {
              key: 'table:table.integrity.v2.detail.symmetricFieldTargetMissing',
              values: {
                fieldName: this.field.name().toString(),
              },
              fallback: `The paired link field for "${this.field.name().toString()}" does not exist.`,
            },
            description: {
              fallback: missing[0],
            },
          },
        ],
      });
    }

    // 2. Check if symmetric field is a link type
    if (symmetricFieldResult.type !== 'link') {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) is type "${symmetricFieldResult.type}", expected "link"`
      );
      return ok({
        valid: false,
        missing,
        missingItems: [
          {
            code: 'symmetric_field_wrong_type',
            message: {
              key: 'table:table.integrity.v2.detail.symmetricFieldWrongType',
              values: {
                fieldName: this.field.name().toString(),
                targetFieldName: symmetricFieldResult.name,
                targetFieldType: symmetricFieldResult.type,
              },
              fallback: `The paired field "${symmetricFieldResult.name}" is not a link field.`,
            },
            description: {
              fallback: missing[0],
            },
          },
        ],
      });
    }

    // 3. Check bidirectional consistency: symmetric field should point back to this field
    let symmetricOptions: { symmetricFieldId?: string } = {};
    if (symmetricFieldResult.options) {
      try {
        symmetricOptions =
          typeof symmetricFieldResult.options === 'string'
            ? JSON.parse(symmetricFieldResult.options)
            : (symmetricFieldResult.options as { symmetricFieldId?: string });
      } catch {
        missing.push(
          `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) has invalid JSON in options column`
        );
        return ok({
          valid: false,
          missing,
          missingItems: [
            {
              code: 'symmetric_field_invalid_options',
              message: {
                key: 'table:table.integrity.v2.detail.symmetricFieldInvalidOptions',
                values: {
                  targetFieldName: symmetricFieldResult.name,
                },
                fallback: `The paired field "${symmetricFieldResult.name}" has invalid link metadata.`,
              },
              description: {
                fallback: missing[0],
              },
            },
          ],
        });
      }
    }

    const backReference = symmetricOptions.symmetricFieldId;
    if (!backReference) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) has no symmetricFieldId (broken bidirectional link)`
      );
      return ok({
        valid: false,
        missing,
        missingItems: [
          {
            code: 'symmetric_field_no_back_reference',
            message: {
              key: 'table:table.integrity.v2.detail.symmetricFieldMissingBackReference',
              values: {
                fieldName: this.field.name().toString(),
                targetFieldName: symmetricFieldResult.name,
              },
              fallback: `The paired field "${symmetricFieldResult.name}" no longer points back to "${this.field.name().toString()}".`,
            },
            description: {
              fallback: missing[0],
            },
          },
        ],
      });
    }

    if (backReference !== currentFieldId) {
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" (${symmetricFieldResult.name}) points to "${backReference}", expected "${currentFieldId}" (broken bidirectional link)`
      );
      return ok({
        valid: false,
        missing,
        missingItems: [
          {
            code: 'symmetric_field_wrong_back_reference',
            message: {
              key: 'table:table.integrity.v2.detail.symmetricFieldWrongBackReference',
              values: {
                fieldName: this.field.name().toString(),
                targetFieldName: symmetricFieldResult.name,
              },
              fallback: `The paired field "${symmetricFieldResult.name}" points to another field instead of "${this.field.name().toString()}".`,
            },
            description: {
              fallback: missing[0],
            },
          },
        ],
      });
    }

    // 4. Check for duplicate symmetric field references (uniqueness)
    // Find all link fields that reference the same symmetricFieldId
    const duplicateResult = await ctx.db
      .selectFrom('field')
      .select(['id', 'name', 'options'])
      .where('table_id', '=', ctx.tableId)
      .where('type', '=', 'link')
      .where('id', '!=', currentFieldId)
      .execute();

    const activeDuplicates = duplicateResult.filter((row) => {
      try {
        const options =
          typeof row.options === 'string'
            ? (JSON.parse(row.options) as { symmetricFieldId?: string; isOneWay?: boolean })
            : (row.options as { symmetricFieldId?: string; isOneWay?: boolean } | null) ?? {};

        return options.symmetricFieldId === symmetricFieldId && options.isOneWay !== true;
      } catch {
        return true;
      }
    });

    if (activeDuplicates.length > 0) {
      const duplicates = activeDuplicates.map((r) => `${r.id} (${r.name})`).join(', ');
      missing.push(
        `symmetricFieldId "${symmetricFieldId}" is also used by: ${duplicates} (should be unique)`
      );
      return ok({
        valid: false,
        missing,
        missingItems: [
          {
            code: 'symmetric_field_duplicate_usage',
            message: {
              key: 'table:table.integrity.v2.detail.symmetricFieldDuplicateUsage',
              values: {
                symmetricFieldId,
                conflictFieldName: activeDuplicates.map((r) => r.name).join(', '),
              },
              fallback: `The paired link target for "${this.field.name().toString()}" is reused by another link field.`,
            },
            description: {
              key: 'table:table.integrity.v2.detail.symmetricFieldDuplicateUsageDescription',
              values: {
                conflictFieldName: activeDuplicates.map((r) => r.name).join(', '),
              },
              fallback: missing[0],
            },
          },
        ],
      });
    }

    return ok({ valid: true });
  }

  async manualRepair(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>> {
    const resolution =
      typeof values?.resolution === 'string' ? values.resolution : 'keep_current_link';

    if (
      resolution !== 'keep_current_link' &&
      resolution !== 'convert_duplicate_to_one_way' &&
      resolution !== 'convert_current_to_one_way'
    ) {
      return err(
        domainError.validation({
          message: 'Unsupported manual repair strategy',
          details: { resolution },
        })
      );
    }

    if (options?.dryRun) {
      return ok(undefined);
    }

    if (resolution === 'convert_current_to_one_way') {
      return this.convertCurrentFieldToOneWay(ctx);
    }

    const currentFieldId = this.field.id().toString();
    const duplicateResult = await ctx.db
      .selectFrom('field')
      .select(['id', 'name', 'options'])
      .where('table_id', '=', ctx.tableId)
      .where('type', '=', 'link')
      .where('id', '!=', currentFieldId)
      .execute();

    for (const duplicateField of duplicateResult) {
      const duplicateOptionsResult = this.parseLinkOptions(duplicateField.options);
      if (duplicateOptionsResult.isErr()) {
        return err(
          domainError.validation({
            message: `Link field "${duplicateField.name}" has invalid options and cannot be manually repaired`,
            details: { fieldId: duplicateField.id },
          })
        );
      }

      const duplicateOptions = duplicateOptionsResult.value;
      if (
        duplicateOptions.symmetricFieldId !== this.symmetricFieldId ||
        duplicateOptions.isOneWay === true
      ) {
        continue;
      }

      await ctx.db
        .updateTable('field')
        .set({
          options: JSON.stringify({
            ...duplicateOptions,
            isOneWay: true,
          }),
        })
        .where('id', '=', duplicateField.id)
        .execute();
    }

    return ok(undefined);
  }

  /**
   * This rule is validation-only. Symmetric field corruption cannot be auto-fixed
   * and requires manual intervention to resolve.
   */
  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  /**
   * This rule is validation-only.
   */
  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  getRepairHint(
    _ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const duplicateMessage = validation.missingItems?.find(
      (item) => item.code === 'symmetric_field_duplicate_usage'
    );
    const duplicateSchemaResult = duplicateMessage
      ? serializeManualRepairSchema(this.manualRepairSchema)
      : undefined;
    const missingTargetMessage = validation.missingItems?.find(
      (item) => item.code === 'symmetric_field_missing'
    );
    const missingTargetSchemaResult = missingTargetMessage
      ? serializeManualRepairSchema(this.missingTargetManualRepairSchema)
      : undefined;
    const brokenPairMessage = validation.missingItems?.find((item) =>
      [
        'symmetric_field_wrong_type',
        'symmetric_field_invalid_options',
        'symmetric_field_no_back_reference',
        'symmetric_field_wrong_back_reference',
      ].includes(item.code ?? '')
    );
    const brokenPairSchemaResult = brokenPairMessage
      ? serializeManualRepairSchema(this.brokenPairManualRepairSchema)
      : undefined;

    if (missingTargetMessage) {
      return ok({
        available: missingTargetSchemaResult?.isOk() === true,
        mode: 'manual',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.symmetricFieldMissing',
          fallback:
            'The paired link field no longer exists. Confirm converting this link to one-way before repairing.',
        },
        description: missingTargetMessage.description ?? {
          key: 'table:table.integrity.v2.repairMeta.description.symmetricFieldMissing',
          fallback:
            'Convert the current link to one-way, then rerun repair so dependent junction table rules can be recreated if needed.',
        },
        manualRepairSchema: missingTargetSchemaResult?.isOk()
          ? missingTargetSchemaResult.value
          : undefined,
      });
    }

    if (brokenPairMessage) {
      return ok({
        available: brokenPairSchemaResult?.isOk() === true,
        mode: 'manual',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.symmetricFieldBroken',
          fallback:
            'The paired link field is broken. Confirm converting this link to one-way before repairing.',
        },
        description: brokenPairMessage.description ?? {
          key: 'table:table.integrity.v2.repairMeta.description.symmetricFieldBroken',
          fallback:
            'Convert the current link to one-way, then rerun repair so dependent link schema rules can be checked again.',
        },
        manualRepairSchema: brokenPairSchemaResult?.isOk()
          ? brokenPairSchemaResult.value
          : undefined,
      });
    }

    return ok({
      available: duplicateSchemaResult?.isOk() === true,
      mode: 'manual',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.symmetricFieldConflict',
        fallback:
          'This two-way link needs a user decision because more than one field shares the same symmetric target.',
      },
      description: duplicateMessage?.description ?? {
        key: 'table:table.integrity.v2.repairMeta.description.symmetricFieldConflict',
        fallback:
          'Choose which link should keep the existing symmetric pairing, and decide how the duplicate field should be adjusted.',
      },
      manualRepairSchema: duplicateSchemaResult?.isOk() ? duplicateSchemaResult.value : undefined,
    });
  }

  private async convertCurrentFieldToOneWay(
    ctx: SchemaRuleContext
  ): Promise<Result<void, DomainError>> {
    const currentField = await ctx.db
      .selectFrom('field')
      .select(['options'])
      .where('id', '=', this.field.id().toString())
      .executeTakeFirst();

    if (!currentField) {
      return err(
        domainError.validation({
          message: 'Current link field does not exist',
          details: { fieldId: this.field.id().toString() },
        })
      );
    }

    const optionsResult = this.parseLinkOptions(currentField.options);
    if (optionsResult.isErr()) {
      return err(optionsResult.error);
    }

    await ctx.db
      .updateTable('field')
      .set({
        options: JSON.stringify({
          ...optionsResult.value,
          isOneWay: true,
        }),
      })
      .where('id', '=', this.field.id().toString())
      .execute();

    return ok(undefined);
  }

  private parseLinkOptions(
    options: unknown
  ): Result<{ symmetricFieldId?: string; isOneWay?: boolean }, DomainError> {
    if (!options) {
      return ok({});
    }

    if (typeof options === 'string') {
      try {
        return ok(JSON.parse(options) as { symmetricFieldId?: string; isOneWay?: boolean });
      } catch {
        return err(
          domainError.validation({
            message: 'Invalid link field options JSON',
          })
        );
      }
    }

    if (typeof options === 'object') {
      return ok(options as { symmetricFieldId?: string; isOneWay?: boolean });
    }

    return err(
      domainError.validation({
        message: 'Invalid link field options value',
      })
    );
  }
}
