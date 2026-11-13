import { describe, expect, it } from 'vitest';
import { generateSecret } from '../utils';
import { deriveOfficialPluginSecret, OFFICIAL_PLUGIN_SECRETS } from './official-plugin-secret';

const ROOT = 'a-strong-root-secret-for-tests';

describe('deriveOfficialPluginSecret', () => {
  it('is a full-length value that follows SECRET_KEY and differs per plugin', () => {
    const chart = deriveOfficialPluginSecret(ROOT, 'plgchart');

    expect(chart).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveOfficialPluginSecret(ROOT, 'plgchart')).toBe(chart);
    expect(deriveOfficialPluginSecret(ROOT, 'plgsheetform')).not.toBe(chart);
    expect(deriveOfficialPluginSecret('another-root', 'plgchart')).not.toBe(chart);
  });

  it('keeps the root key out of what the plugin row stores', async () => {
    const derived = deriveOfficialPluginSecret(ROOT, 'plgchart');
    const { maskedSecret } = await generateSecret(derived);

    expect(derived).not.toContain(ROOT);
    // the masked form shows the derived value's tail, never the root key's
    expect(maskedSecret.endsWith(ROOT.slice(-10))).toBe(false);
    expect(maskedSecret.replace(/\*/g, '')).toBe(derived.slice(-10));
  });

  it('lists both official plugins with their override variables', () => {
    expect(OFFICIAL_PLUGIN_SECRETS).toEqual([
      { pluginId: 'plgchart', envKey: 'PLUGIN_CHART_SECRET' },
      { pluginId: 'plgsheetform', envKey: 'PLUGIN_SHEETFORMVIEW_SECRET' },
    ]);
  });
});
