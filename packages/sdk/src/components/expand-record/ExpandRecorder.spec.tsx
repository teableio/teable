import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncCopy } from '../../utils';
import { ExpandRecorder } from './ExpandRecorder';

vi.mock('@teable/openapi', () => ({
  deleteRecord: vi.fn(),
}));

vi.mock('@teable/ui-lib', () => ({
  sonner: { toast: { success: vi.fn() } },
}));

vi.mock('react-use', () => ({
  useLocalStorage: (_key: string, initialValue: boolean) => [initialValue, vi.fn()],
}));

vi.mock('../../context', async () => {
  const { createContext } = await import('react');
  return {
    ShareViewContext: createContext({}),
    StandaloneViewProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ViewProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let mockBaseId: string | undefined;

vi.mock('../../hooks', () => ({
  useBaseId: () => mockBaseId,
  useTableId: () => 'tblA',
  useTables: () => [],
  useTablePermission: () => ({}),
  useCommentPermission: () => ({ commentReadable: false, commentWritable: false }),
  useRecordOperations: () => ({ duplicateRecord: vi.fn() }),
}));

vi.mock('../../utils', () => ({
  syncCopy: vi.fn(),
}));

vi.mock('./ExpandRecordNavigationContext', () => ({
  useExpandRecordNavigation: () => ({}),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let expandRecordProps: any;

vi.mock('./ExpandRecord', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ExpandRecord: (props: any) => {
    expandRecordProps = props;
    return <div data-testid="expand-record" />;
  },
}));

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

const mockHref = (href: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href, origin: new URL(href).origin },
  });
};

describe('ExpandRecorder copy record link', () => {
  beforeEach(() => {
    vi.mocked(syncCopy).mockClear();
    expandRecordProps = undefined;
    mockBaseId = 'bseA';
  });

  afterEach(() => {
    // the stub is a bare { href }, so leaving it in place would break anything later in the
    // file that reads window.location.origin / pathname / assign
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  it('carries the expanded record even when the view left it out of the url', () => {
    // kanban / gallery / calendar expand through component state, so the address bar
    // stops at the view (teableio/teable#3626)
    mockHref('https://teable.io/base/bseA/table/tblA/viwA');

    render(<ExpandRecorder tableId="tblA" recordId="recA" />);
    expandRecordProps.onCopyUrl();

    expect(syncCopy).toHaveBeenCalledWith(
      'https://teable.io/base/bseA/table/tblA/viwA?recordId=recA'
    );
  });

  it('copies the record the panel is showing, not a stale one left in the url', () => {
    mockHref('https://teable.io/base/bseA/table/tblA/viwA?recordId=recStale');

    render(<ExpandRecorder tableId="tblA" recordId="recA" />);
    expandRecordProps.onCopyUrl();

    expect(syncCopy).toHaveBeenCalledWith(
      'https://teable.io/base/bseA/table/tblA/viwA?recordId=recA'
    );
  });

  it('keeps the rest of the url untouched', () => {
    mockHref('https://teable.io/share/shrA/view?hideToolBar=true');

    render(<ExpandRecorder tableId="tblA" recordId="recA" />);
    expandRecordProps.onCopyUrl();

    expect(syncCopy).toHaveBeenCalledWith(
      'https://teable.io/share/shrA/view?hideToolBar=true&recordId=recA'
    );
  });

  it('hands over a url that already points at this record untouched', () => {
    // rewriting would re-encode the rest of the query: `%20` would come back as `+`
    const href = 'https://teable.io/base/bseA/table/tblA/viwA?search=hello%20world&recordId=recA';
    mockHref(href);

    render(<ExpandRecorder tableId="tblA" recordId="recA" />);
    expandRecordProps.onCopyUrl();

    expect(syncCopy).toHaveBeenCalledWith(href);
  });

  it('builds the record-own url for a record of another table', () => {
    // a linked record lives in a foreign table, which this page's url cannot address —
    // copying the address bar would link to whatever this page is showing (recA here)
    mockHref('https://teable.io/base/bseA/table/tblA/viwA?recordId=recA');

    render(<ExpandRecorder tableId="tblForeign" recordId="recForeign" isLinkedRecord />);
    expandRecordProps.onCopyUrl();

    expect(syncCopy).toHaveBeenCalledWith(
      'https://teable.io/base/bseA/table/tblForeign?recordId=recForeign'
    );
  });

  it('hides the copy button for a foreign record when no base is in scope', () => {
    // a share view has no baseId, so no url can address the foreign record at all —
    // better no button than a wrong link with a success toast
    mockBaseId = undefined;
    mockHref('https://teable.io/share/shrA/view?recordId=recA');

    render(<ExpandRecorder tableId="tblForeign" recordId="recForeign" isLinkedRecord />);

    expect(expandRecordProps.onCopyUrl).toBeUndefined();
  });
});
