import { describe, expect, it } from 'vitest';
import { joinWildcardParam } from './wildcard-param';

describe('joinWildcardParam', () => {
  it('joins the segment array Express 5 produces for a named wildcard', () => {
    expect(joinWildcardParam(['table', 'tbl123', 'file name.png'])).toBe(
      'table/tbl123/file name.png'
    );
  });

  it('passes a plain string through unchanged', () => {
    expect(joinWildcardParam('react@18.3.1/umd/react.js')).toBe('react@18.3.1/umd/react.js');
  });

  it('returns an empty string when the param is missing', () => {
    expect(joinWildcardParam(undefined)).toBe('');
  });
});
