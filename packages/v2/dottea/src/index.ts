import { Buffer } from 'node:buffer';

import {
  domainError,
  type DomainError,
  type DotTeaStructure,
  type DotTeaSource,
  type IDotTeaParser,
  type NormalizedDotTeaStructure,
} from '@teable/v2-core';
import { normalizeField } from './normalizer';
import { injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import unzipper from 'unzipper';
import { z } from 'zod';

const dotTeaFieldSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string(),
    isPrimary: z.boolean().optional(),
    isLookup: z.boolean().optional(),
    isConditionalLookup: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    lookupOptions: z.record(z.string(), z.unknown()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    cellValueType: z.string().optional(),
    isMultipleCellValue: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  })
  .passthrough();

const dotTeaViewSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const dotTeaTableSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    fields: z.array(dotTeaFieldSchema),
    views: z.array(dotTeaViewSchema).optional(),
  })
  .passthrough();

const dotTeaStructureSchema = z
  .object({
    tables: z.array(dotTeaTableSchema),
  })
  .passthrough();

const streamToBuffer = async (source: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

const readStructureJson = async (zip: unzipper.CentralDirectory): Promise<string> => {
  const entry = zip.files.find((file: unzipper.File) => file.path === 'structure.json');
  if (!entry) {
    throw new Error('structure.json not found in dottea file');
  }
  const buffer = await entry.buffer();
  return buffer.toString('utf-8');
};

const allowedViewTypes = new Set(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']);

@injectable()
export class DotTeaParser implements IDotTeaParser {
  async parseStructure(source: DotTeaSource): Promise<Result<DotTeaStructure, DomainError>> {
    try {
      const zip = await this.openZip(source);
      const json = await readStructureJson(zip);
      const raw = JSON.parse(json) as unknown;
      const parsed = dotTeaStructureSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          domainError.validation({
            message: 'Invalid dottea structure.json',
            details: z.formatError(parsed.error),
            code: 'dottea.structure_invalid',
          })
        );
      }

      return ok({ tables: parsed.data.tables });
    } catch (error) {
      return err(domainError.fromUnknown(error, { code: 'dottea.parse_failed' }));
    }
  }

  async parseNormalizedStructure(
    source: DotTeaSource
  ): Promise<Result<NormalizedDotTeaStructure, DomainError>> {
    const structureResult = await this.parseStructure(source);
    if (structureResult.isErr()) {
      return err(structureResult.error);
    }

    const structure = structureResult.value;

    // Build a map of field IDs to field types for dependency detection
    const fieldTypesById = new Map<string, string>();
    for (const table of structure.tables) {
      for (const field of table.fields) {
        if (field.id) {
          fieldTypesById.set(field.id, field.type);
        }
      }
    }

    // Normalize all tables and their fields
    const normalizedTables = structure.tables.map((table) => ({
      ...(table.id ? { id: table.id } : {}),
      name: table.name,
      fields: table.fields.map((field) => normalizeField(field, fieldTypesById)),
      views: table.views
        ?.filter((view) => (view.type ? allowedViewTypes.has(view.type) : true))
        .map((view) => ({
          ...(view.id ? { id: view.id } : {}),
          name: view.name,
          type: view.type,
        })),
    }));

    return ok({ tables: normalizedTables });
  }

  private async openZip(source: DotTeaSource): Promise<unzipper.CentralDirectory> {
    switch (source.type) {
      case 'buffer':
        return unzipper.Open.buffer(Buffer.from(source.data));
      case 'stream': {
        const buffer = await streamToBuffer(source.data);
        return unzipper.Open.buffer(buffer);
      }
      case 'path':
        return unzipper.Open.file(source.path);
    }
  }
}

export * from './normalizer';
