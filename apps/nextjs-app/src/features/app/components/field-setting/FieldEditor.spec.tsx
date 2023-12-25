import { FieldType } from '@teable-group/core';
import { vi } from 'vitest';
import { render } from '@/test-utils';
import { FieldEditor } from './FieldEditor';

// Mock FieldOptions
vi.mock('./FieldOptions', () => {
  return {
    FieldOptions: () => <div>Mocked FieldOptions</div>,
  };
});

// Mock LookupOptions
vi.mock('./lookup-options/LookupOptions', () => {
  return {
    LookupOptions: () => <div>Mocked LookupOptions</div>,
  };
});

describe('field editor tests', () => {
  it('should render field options', async () => {
    const el = render(
      <FieldEditor
        field={{
          type: FieldType.SingleLineText,
        }}
        onChange={() => undefined}
      />
    );
    expect(el.getByText('Name')).toBeInTheDocument();
  });
});
