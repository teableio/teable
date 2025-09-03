import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IFieldVo, ILookupOptionsVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Events } from '../../event-emitter/events';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';
import { ICreateFieldsPayload } from '../undo-redo/operations/create-fields.operation';
import { RealtimeOpService } from './realtime-op.service';

@Injectable()
export class RealtimeOpListener {
  private readonly logger = new Logger(RealtimeOpListener.name);

  constructor(
    private readonly realtimeOpService: RealtimeOpService,
    private readonly prismaService: PrismaService
  ) {}

  // Use OPERATION_FIELDS_CREATE which fires after computed fields have been calculated
  @OnEvent(Events.OPERATION_FIELDS_CREATE, { async: true })
  async onFieldsCreate(event: ICreateFieldsPayload) {
    try {
      const { tableId, fields } = event;
      const fieldIds: string[] = (fields || []).map((f) => f.id);
      if (!fieldIds.length) return;

      await this.realtimeOpService.publishOnFieldCreate(tableId, fieldIds);
    } catch (e) {
      this.logger.warn(`Realtime publish on field create failed: ${(e as Error).message}`);
    }
  }

  // Field convert/update: after metadata and constraints applied
  @OnEvent(Events.OPERATION_FIELD_CONVERT, { async: true })
  async onFieldConvert(event: {
    tableId: string;
    newField: IFieldVo;
    oldField: IFieldVo;
    references?: string[];
  }) {
    try {
      const { tableId, newField, references } = event;
      if (!newField?.id) return;
      const updatedFieldIds = Array.from(new Set([newField.id, ...(references || [])]));
      await this.realtimeOpService.publishOnFieldUpdateDependencies(tableId, updatedFieldIds);
    } catch (e) {
      this.logger.warn(`Realtime publish on field convert failed: ${(e as Error).message}`);
    }
  }

  // Field delete: refresh dependents (may become null/error)
  @OnEvent(Events.OPERATION_FIELDS_DELETE, { async: true })
  async onFieldsDelete(event: {
    tableId: string;
    fields: { id: string; references?: string[]; type?: FieldType; isLookup?: boolean }[];
  }) {
    try {
      const { tableId, fields } = event;
      const deletedIds = (fields || []).map((f) => f.id);
      if (!deletedIds.length) return;
      // Include dependent field ids from the event payload because DB references
      // have already been removed at this point.
      const dependentIds = (fields || []).flatMap((f) => f.references || []).filter(Boolean);

      // Also include lookup/rollup fields depending on deleted link fields
      const deletedLinkIds = (fields || [])
        .filter((f) => f.type === FieldType.Link && !f.isLookup)
        .map((f) => f.id);
      let extraDependents: string[] = [];
      if (deletedLinkIds.length) {
        const maybeDependents = await this.prismaService.txClient().field.findMany({
          where: { tableId, deletedTime: null },
          select: { id: true, type: true, isLookup: true, lookupOptions: true },
        });
        extraDependents = maybeDependents
          .filter((f) => f.isLookup || f.type === FieldType.Rollup)
          .filter((f) => {
            try {
              const opts = f.lookupOptions
                ? (JSON.parse(f.lookupOptions as unknown as string) as ILookupOptionsVo)
                : undefined;
              return Boolean(opts && deletedLinkIds.includes(opts.linkFieldId));
            } catch {
              return false;
            }
          })
          .map((f) => f.id);
      }

      // Also include computed fields that directly reference the deleted field ids (e.g., B deleted -> include C)
      const allFieldsRaw = await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
      });
      const directDependents = allFieldsRaw
        .map((raw) => createFieldInstanceByRaw(raw))
        .filter((f) => f.isComputed)
        .filter((f) => {
          if (
            f.lookupOptions?.lookupFieldId &&
            deletedIds.includes(f.lookupOptions.lookupFieldId)
          ) {
            return true;
          }
          if (f.type === FieldType.Formula) {
            try {
              const refs = (f as unknown as FormulaFieldDto).getReferenceFieldIds();
              return refs?.some((id) => deletedIds.includes(id));
            } catch {
              return false;
            }
          }
          return false;
        })
        .map((f) => f.id);
      extraDependents.push(...directDependents);

      const updatedFieldIds = Array.from(
        new Set([...deletedIds, ...dependentIds, ...extraDependents])
      );
      await this.realtimeOpService.publishOnFieldUpdateDependencies(tableId, updatedFieldIds);
    } catch (e) {
      this.logger.warn(`Realtime publish on fields delete failed: ${(e as Error).message}`);
    }
  }
}
