import { getBaseDisplayName } from './base-name';

const t = (key: 'common:untitledBase') =>
  key === 'common:untitledBase' ? 'Untitled project' : key;

describe('getBaseDisplayName', () => {
  it('shows the placeholder for a name no person or AI has set', () => {
    expect(getBaseDisplayName(null, t)).toBe('Untitled project');
    expect(getBaseDisplayName(undefined, t)).toBe('Untitled project');
  });

  it('treats a whitespace-only name as unnamed', () => {
    expect(getBaseDisplayName('   ', t)).toBe('Untitled project');
  });

  it('keeps a real name and trims surrounding whitespace', () => {
    expect(getBaseDisplayName('Sales', t)).toBe('Sales');
    expect(getBaseDisplayName('  Sales  ', t)).toBe('Sales');
  });
});
