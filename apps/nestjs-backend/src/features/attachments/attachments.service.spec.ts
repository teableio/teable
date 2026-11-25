/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'node:stream';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ANONYMOUS_USER_ID, FieldType, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { axios, UploadType } from '@teable/openapi';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { getError } from '../../../test/utils/get-error';
import { storageConfig } from '../../configs/storage';
import { GlobalModule } from '../../global/global.module';
import { AttachmentsModule } from './attachments.module';
import { AttachmentsService, shareCanUploadAttachments } from './attachments.service';
import type { LocalStorage } from './plugins/local';

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AttachmentsModule, GlobalModule],
    })
      .useMocker((token) => {
        if (token === ClsService || token === PrismaService) {
          return vi.fn();
        }
      })
      .compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  afterEach(async () => {
    await module.close();
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('parses normalized Axios response headers', async () => {
    const headers = new AxiosHeaders();
    headers.set('content-length', '42');
    headers.set('content-type', 'image/png');
    vi.spyOn(axios, 'head').mockResolvedValue({
      headers,
    } as AxiosResponse);

    const result = await (
      service as unknown as {
        getFileInfo: (
          fileUrl: string,
          maxFileSize: number
        ) => Promise<{ contentLength: number; contentType: string; tempFilePath: string | null }>;
      }
    ).getFileInfo('https://example.com/image', 100);

    expect(result).toEqual({
      contentLength: 42,
      contentType: 'image/png',
      tempFilePath: null,
    });
  });

  describe('readLocalFile', () => {
    const findUnique = vi.fn();
    let localStorage: LocalStorage;
    let privateBucket: string;
    let publicBucket: string;

    const mintToken = (path: string, respHeaders?: Record<string, string>) =>
      localStorage.readTokenCodec.encode({ path, expiresDate: -1, respHeaders });

    beforeEach(() => {
      ({ privateBucket, publicBucket } = storageConfig());
      localStorage = service.storageAdapter as LocalStorage;
      findUnique.mockReset();
      Object.assign(service['prismaService'], {
        txClient: () => ({ attachments: { findUnique } }),
      });
      vi.spyOn(localStorage, 'read').mockImplementation(
        () => Readable.from([]) as ReturnType<LocalStorage['read']>
      );
    });

    it('rejects a private object without a token before touching storage', async () => {
      const error = await getError(() => service.readLocalFile(`${privateBucket}/table/a`));

      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
      expect(findUnique).not.toHaveBeenCalled();
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('rejects a token minted for another private object', async () => {
      const token = mintToken(`${privateBucket}/table/a`);

      const error = await getError(() => service.readLocalFile(`${privateBucket}/table/b`, token));

      expect(error?.message).toBe('Invalid token');
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('serves a private object with the token minted for it', async () => {
      const path = `${privateBucket}/table/a`;
      const token = mintToken(path, { 'Content-Type': 'image/png' });

      const { headers } = await service.readLocalFile(path, token);

      expect(headers).toEqual({ 'Content-Type': 'image/png' });
      expect(localStorage.read).toHaveBeenCalledWith(path);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('forces a download for active content whatever the token says', async () => {
      const path = `${privateBucket}/table/a`;

      const plain = await service.readLocalFile(
        path,
        mintToken(path, { 'Content-Type': 'image/svg+xml' })
      );
      expect(plain.headers['Content-Disposition']).toBe('attachment');

      const inline = await service.readLocalFile(
        path,
        mintToken(path, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'inline; filename="page.html"',
        })
      );
      expect(inline.headers['Content-Disposition']).toBe('attachment; filename="page.html"');
    });

    it('never serves backend-only prefixes, even with a token sealed to them', async () => {
      for (const dir of [
        'record-history',
        'record-removal',
        'workflow-run',
        'audit-log',
        'artifact',
      ]) {
        const path = `${privateBucket}/${dir}/v1/tbl/_stats.json`;
        const error = await getError(() => service.readLocalFile(path, mintToken(path)));
        expect(error?.message).toBe('Invalid path');
        expect(error?.status).toBe(400);
      }
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('serves a public object from its attachment row with its real mimetype', async () => {
      findUnique.mockResolvedValue({ mimetype: 'image/png' });

      const { headers } = await service.readLocalFile(`${publicBucket}/avatar/usr1`);

      expect(findUnique).toHaveBeenCalledWith({ where: { token: 'usr1', deletedTime: null } });
      expect(headers).toEqual({ 'Content-Type': 'image/png' });
      expect(localStorage.read).toHaveBeenCalledWith(`${publicBucket}/avatar/usr1`);
    });

    it('rejects a public path without a live attachment row', async () => {
      findUnique.mockResolvedValue(null);

      const error = await getError(() => service.readLocalFile(`${publicBucket}/avatar/usr1`));

      expect(error?.message).toBe('Invalid path');
      expect(error?.status).toBe(400);
      expect(localStorage.read).not.toHaveBeenCalled();
    });
  });

  describe('assertShareCanUpload', () => {
    const findMany = vi.fn();
    let permissions: string[];
    const shareInfo = (view: Record<string, unknown> | undefined) =>
      ({ shareId: 'shrShared', tableId: 'tblShared', view }) as never;
    const form = { id: 'viwForm', type: ViewType.Form, columnMeta: { fldFile: { visible: true } } };
    const grid = { id: 'viwGrid', type: ViewType.Grid, columnMeta: { fldFile: {} } };

    beforeEach(() => {
      findMany.mockReset().mockResolvedValue([{ id: 'fldFile' }]);
      permissions = ['record|read'];
      Object.assign(service['prismaService'], { txClient: () => ({ field: { findMany } }) });
      Object.assign(service['cls'], {
        get: (key: string) => (key === 'permissions' ? permissions : undefined),
      });
    });

    it('lets a form that shows an attachment field upload table attachments', async () => {
      await expect(
        service.assertShareCanUpload(shareInfo(form), UploadType.Table)
      ).resolves.toBeUndefined();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tableId: 'tblShared', type: FieldType.Attachment }),
        })
      );
    });

    it('refuses a read-only grid share', async () => {
      const error = await getError(() =>
        service.assertShareCanUpload(shareInfo(grid), UploadType.Table)
      );

      expect(error?.status).toBe(403);
    });

    it('lets a share with editing on upload when its view shows an attachment field', async () => {
      permissions = ['record|read', 'record|update'];

      await expect(
        service.assertShareCanUpload(shareInfo(grid), UploadType.Table)
      ).resolves.toBeUndefined();
    });

    it('refuses any other upload type, even on a form', async () => {
      const error = await getError(() =>
        service.assertShareCanUpload(shareInfo(form), UploadType.Avatar)
      );

      expect(error?.status).toBe(403);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('lets an editable include-hidden-fields share upload into a hidden attachment field', async () => {
      permissions = ['record|read', 'record|update'];
      const hiddenGrid = {
        id: 'viwGrid',
        type: ViewType.Grid,
        columnMeta: { fldFile: { hidden: true } },
        shareMeta: { includeHiddenField: true },
      };

      await expect(
        service.assertShareCanUpload(shareInfo(hiddenGrid), UploadType.Table)
      ).resolves.toBeUndefined();
    });

    it('refuses an anonymous visitor of a login-required form', async () => {
      Object.assign(service['cls'], {
        get: (key: string) =>
          key === 'permissions' ? permissions : key === 'user.id' ? ANONYMOUS_USER_ID : undefined,
      });
      const loginForm = {
        shareId: 'shrShared',
        tableId: 'tblShared',
        view: form,
        shareMeta: { submit: { requireLogin: true } },
      } as never;

      const error = await getError(() => service.assertShareCanUpload(loginForm, UploadType.Table));

      expect(error?.status).toBe(403);
    });

    it('still lets a signed-in visitor of a login-required form upload', async () => {
      Object.assign(service['cls'], {
        get: (key: string) =>
          key === 'permissions' ? permissions : key === 'user.id' ? 'usrSignedIn' : undefined,
      });
      const loginForm = {
        shareId: 'shrShared',
        tableId: 'tblShared',
        view: form,
        shareMeta: { submit: { requireLogin: true } },
      } as never;

      await expect(
        service.assertShareCanUpload(loginForm, UploadType.Table)
      ).resolves.toBeUndefined();
    });
  });
});

describe('shareCanUploadAttachments', () => {
  const view = (
    type: ViewType,
    columnMeta: Record<string, unknown>,
    options?: { includeHiddenField?: boolean }
  ) =>
    ({
      view: {
        id: 'viwX',
        type,
        columnMeta,
        ...(options?.includeHiddenField ? { shareMeta: { includeHiddenField: true } } : {}),
      },
    }) as never;

  it.each([
    [
      'a form showing the attachment field',
      ViewType.Form,
      { fldFile: { visible: true } },
      false,
      true,
    ],
    ['a form that hides it', ViewType.Form, { fldFile: { visible: false } }, false, false],
    ['a form without it in its columns', ViewType.Form, {}, false, false],
    ['a read-only grid', ViewType.Grid, { fldFile: {} }, false, false],
    ['an editable grid', ViewType.Grid, { fldFile: {} }, true, true],
    [
      'an editable grid hiding the field',
      ViewType.Grid,
      { fldFile: { hidden: true } },
      true,
      false,
    ],
    // Kanban/gallery hide with `visible: false`, so the grid-only `hidden` check used to pass them.
    [
      'an editable gallery hiding the field',
      ViewType.Gallery,
      { fldFile: { visible: false } },
      true,
      false,
    ],
    [
      'an editable gallery showing the field',
      ViewType.Gallery,
      { fldFile: { visible: true } },
      true,
      true,
    ],
    [
      'an editable kanban hiding the field',
      ViewType.Kanban,
      { fldFile: { visible: false } },
      true,
      false,
    ],
  ])('%s', (_label, type, columnMeta, canEdit, expected) => {
    expect(shareCanUploadAttachments(view(type, columnMeta), ['fldFile'], canEdit)).toBe(expected);
  });

  it('lets an editable share with include-hidden-fields upload into a hidden attachment field', () => {
    const hiddenGrid = view(
      ViewType.Grid,
      { fldFile: { hidden: true } },
      { includeHiddenField: true }
    );
    expect(shareCanUploadAttachments(hiddenGrid, ['fldFile'], true)).toBe(true);
    // still needs editing on
    expect(shareCanUploadAttachments(hiddenGrid, ['fldFile'], false)).toBe(false);
  });

  it('refuses a share whose table has no attachment field', () => {
    expect(
      shareCanUploadAttachments(view(ViewType.Form, { fldFile: { visible: true } }), [], true)
    ).toBe(false);
  });

  it('refuses a share without a view', () => {
    expect(shareCanUploadAttachments({ view: undefined } as never, ['fldFile'], true)).toBe(false);
  });
});
