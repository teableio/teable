import type {
  IParentBridgeMethods,
  IParentBridgeUIMethods,
  IParentBridgeUtilsMethods,
} from '@teable/sdk/plugin-bridge';
import { render } from '@testing-library/react';
import { connectToChild } from 'penpal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IframePluginRender } from './IframePluginRender';

vi.mock('penpal', () => ({
  connectToChild: vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() })),
}));

const tempToken = { accessToken: 'viewer-token', expiresTime: '2030-01-01T00:00:00.000Z' };

const renderFrame = (src: string) => {
  const utilsEvent = {
    updateStorage: vi.fn().mockResolvedValue({}),
    getAuthCode: vi.fn().mockResolvedValue('auth-code'),
    getSelfTempToken: vi.fn().mockResolvedValue(tempToken),
    getSelectionRecords: vi.fn().mockResolvedValue({ records: [], fields: [] }),
  } satisfies IParentBridgeUtilsMethods;
  const uiEvent = {
    expandRecord: vi.fn(),
    expandPlugin: vi.fn(),
  } satisfies IParentBridgeUIMethods;

  render(
    <IframePluginRender src={src} utilsEvent={utilsEvent} uiEvent={uiEvent} onBridge={vi.fn()} />
  );

  const options = vi.mocked(connectToChild).mock.calls.at(-1)?.[0];
  return {
    utilsEvent,
    childOrigin: options?.childOrigin,
    methods: options?.methods as unknown as IParentBridgeMethods | undefined,
  };
};

describe('IframePluginRender bridge', () => {
  beforeEach(() => {
    vi.mocked(connectToChild).mockClear();
  });

  it('runs on an http(s) page, which the origin checks below rely on', () => {
    expect(window.location.origin).toMatch(/^https?:\/\//);
  });

  it('keeps the viewer token away from a plugin served from another origin', async () => {
    const { utilsEvent, childOrigin, methods } = renderFrame(
      'https://plugin.example.net/widget?pluginId=plg1'
    );

    expect(childOrigin).toBe('https://plugin.example.net');
    await expect(methods?.getSelfTempToken()).rejects.toThrow(/another origin/);
    expect(utilsEvent.getSelfTempToken).not.toHaveBeenCalled();
  });

  it('still hands a third-party plugin its own auth code', async () => {
    const { utilsEvent, methods } = renderFrame('https://plugin.example.net/widget');

    await expect(methods?.getAuthCode()).resolves.toBe('auth-code');
    expect(utilsEvent.getAuthCode).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a look-alike host',
      () => `${window.location.protocol}//${window.location.hostname}.evil.example/widget`,
    ],
    ['another port', () => `${window.location.protocol}//${window.location.hostname}:1/widget`],
    [
      'another scheme',
      () =>
        `${window.location.protocol === 'https:' ? 'http:' : 'https:'}//${window.location.host}/widget`,
    ],
  ])('treats %s as another origin', async (_name, src) => {
    const { utilsEvent, methods } = renderFrame(src());

    await expect(methods?.getSelfTempToken()).rejects.toThrow(/another origin/);
    expect(utilsEvent.getSelfTempToken).not.toHaveBeenCalled();
  });

  it.each([
    ['a relative url', () => '/plugin/sheet-form-view?lang=en'],
    ['an absolute url on the page origin', () => `${window.location.origin}/plugin/chart`],
  ])('gives the viewer token to a plugin served from the app itself (%s)', async (_name, src) => {
    const { utilsEvent, childOrigin, methods } = renderFrame(src());

    expect(childOrigin).toBe(window.location.origin);
    await expect(methods?.getSelfTempToken()).resolves.toEqual(tempToken);
    expect(utilsEvent.getSelfTempToken).toHaveBeenCalledTimes(1);
  });

  it.each(['data:text/html,<p>plugin</p>', 'javascript:void(0)//'])(
    'opens no bridge for %s',
    (src) => {
      const { methods } = renderFrame(src);

      expect(connectToChild).not.toHaveBeenCalled();
      expect(methods).toBeUndefined();
    }
  );
});
