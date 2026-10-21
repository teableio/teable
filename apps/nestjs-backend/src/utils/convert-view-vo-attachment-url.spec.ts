import { ViewType } from '@teable/core';
import type { IViewVo } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { convertViewVoAttachmentUrl } from './convert-view-vo-attachment-url';

vi.mock('../features/attachments/plugins/utils', () => ({
  getPublicFullStorageUrl: (path: string) =>
    `https://s3.us-west-2.amazonaws.com/storage-public.teable.io/${path}`,
}));

const formView = (options: Record<string, unknown>) =>
  ({ type: ViewType.Form, options }) as unknown as IViewVo;

describe('convertViewVoAttachmentUrl', () => {
  it('converts relative form cover and logo paths to full storage urls', () => {
    const view = convertViewVoAttachmentUrl(
      formView({ coverUrl: 'form/uKvyPWrWrE6q', logoUrl: 'form/logoToken' })
    );

    expect(view.options).toEqual({
      coverUrl: 'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/form/uKvyPWrWrE6q',
      logoUrl: 'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/form/logoToken',
    });
  });

  it('is idempotent for already-converted urls', () => {
    const once = convertViewVoAttachmentUrl(formView({ coverUrl: 'form/uKvyPWrWrE6q' }));
    const twice = convertViewVoAttachmentUrl(once);

    expect((twice.options as { coverUrl: string }).coverUrl).toBe(
      'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/form/uKvyPWrWrE6q'
    );
  });

  it('leaves external absolute urls untouched', () => {
    const view = convertViewVoAttachmentUrl(
      formView({ coverUrl: 'https://www.example.com/a.png' })
    );

    expect((view.options as { coverUrl: string }).coverUrl).toBe('https://www.example.com/a.png');
  });

  it('converts plugin logo paths and skips already-converted ones', () => {
    const pluginView = {
      type: ViewType.Plugin,
      options: { pluginLogo: 'plugin/logoToken' },
    } as unknown as IViewVo;

    const once = convertViewVoAttachmentUrl(pluginView);
    const twice = convertViewVoAttachmentUrl(once);

    expect((twice.options as { pluginLogo: string }).pluginLogo).toBe(
      'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/plugin/logoToken'
    );
  });

  it('keeps empty urls unchanged', () => {
    const view = convertViewVoAttachmentUrl(formView({ coverUrl: '', logoUrl: undefined }));

    expect(view.options).toEqual({ coverUrl: '', logoUrl: undefined });
  });
});
