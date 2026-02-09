import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { FieldId } from '../../domain/table/fields/FieldId';
import {
  SetAttachmentValueSpec,
  type AttachmentItem,
} from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import type {
  AttachmentLookupRecord,
  IAttachmentLookupService,
} from '../../ports/AttachmentLookupService';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { AttachmentValueResolverService } from './AttachmentValueResolverService';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

class FakeAttachmentLookupService implements IAttachmentLookupService {
  constructor(private readonly records: ReadonlyArray<AttachmentLookupRecord>) {}

  async listAttachmentsByTokens(tokens: ReadonlyArray<string>) {
    return ok(this.records.filter((record) => tokens.includes(record.token)));
  }

  async listAttachmentsByAttachmentIds(attachmentIds: ReadonlyArray<string>) {
    return ok(
      this.records.filter((record) => {
        const key = record.attachmentId ?? record.id;
        return key ? attachmentIds.includes(key) : false;
      })
    );
  }
}

describe('AttachmentValueResolverService', () => {
  it('returns empty array for empty specs', async () => {
    const service = new AttachmentValueResolverService(new FakeAttachmentLookupService([]));
    const result = await service.resolveSpecs(createContext(), []);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('returns validation error for invalid attachment format', async () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const invalidItem: AttachmentItem = {
      id: '',
      name: 'Bad',
      path: '',
      token: '',
      size: 0,
      mimetype: 'text/plain',
    };
    const spec = new SetAttachmentValueSpec(
      fieldId,
      CellValue.fromValidated<AttachmentItem[]>([invalidItem])
    );

    const service = new AttachmentValueResolverService(new FakeAttachmentLookupService([]));
    const result = await service.resolveSpecs(createContext(), [spec]);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.invalid_attachment_format');
  });

  it('resolves attachment tokens and preserves provided id', async () => {
    const fieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const inputItem: AttachmentItem = {
      id: 'att-1',
      name: 'Input',
      path: '',
      token: 'tok-1',
      size: 0,
      mimetype: 'text/plain',
    };
    const stored: AttachmentLookupRecord = {
      id: 'actStored',
      attachmentId: 'att-1',
      token: 'tok-1',
      name: 'Stored',
      path: '/stored/path',
      size: 10,
      mimetype: 'text/plain',
    };

    const spec = new SetAttachmentValueSpec(
      fieldId,
      CellValue.fromValidated<AttachmentItem[]>([inputItem])
    );
    const service = new AttachmentValueResolverService(new FakeAttachmentLookupService([stored]));

    const result = await service.resolveSpecs(createContext(), [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetAttachmentValueSpec);
    const resolvedValue = (resolvedSpec as SetAttachmentValueSpec).value.toValue();
    expect(resolvedValue).toEqual([
      {
        id: 'att-1',
        name: 'Input',
        token: 'tok-1',
        path: '/stored/path',
        size: 10,
        mimetype: 'text/plain',
      },
    ]);
  });

  it('resolves null values to null attachment value', async () => {
    const fieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetAttachmentValueSpec(fieldId, CellValue.null<AttachmentItem[]>());

    const service = new AttachmentValueResolverService(new FakeAttachmentLookupService([]));
    const result = await service.resolveSpecs(createContext(), [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetAttachmentValueSpec);
    const resolvedValue = (resolvedSpec as SetAttachmentValueSpec).value.toValue();
    expect(resolvedValue).toBeNull();
  });

  it('resolves attachment ids when token is missing', async () => {
    const fieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const inputItem: AttachmentItem = {
      id: 'att-2',
      name: 'Input',
      path: '',
      token: '',
      size: 0,
      mimetype: 'text/plain',
    };
    const stored: AttachmentLookupRecord = {
      id: 'actStored2',
      attachmentId: 'att-2',
      token: 'tok-2',
      name: 'Stored',
      path: '/stored/attachment',
      size: 12,
      mimetype: 'text/plain',
    };

    const spec = new SetAttachmentValueSpec(
      fieldId,
      CellValue.fromValidated<AttachmentItem[]>([inputItem])
    );
    const service = new AttachmentValueResolverService(new FakeAttachmentLookupService([stored]));

    const result = await service.resolveSpecs(createContext(), [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetAttachmentValueSpec);
    const resolvedValue = (resolvedSpec as SetAttachmentValueSpec).value.toValue();
    expect(resolvedValue).toHaveLength(1);
    const resolvedItem = resolvedValue?.[0];
    expect(resolvedItem?.id).not.toBe('att-2');
    expect(resolvedItem?.id.startsWith('act')).toBe(true);
    expect(resolvedItem).toEqual({
      id: resolvedItem?.id ?? '',
      name: 'Input',
      token: 'tok-2',
      path: '/stored/attachment',
      size: 12,
      mimetype: 'text/plain',
    });
  });
});
