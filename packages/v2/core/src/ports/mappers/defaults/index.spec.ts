import { describe, expect, it } from 'vitest';

import * as defaults from './index';

describe('ports/mappers/defaults index', () => {
  it('re-exports default mappers', () => {
    expect(defaults).toHaveProperty('DefaultTableMapper');
  });
});
