import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGallery } from '../hooks';
import { GalleryProvider } from './GalleryProvider';

const fixtures = vi.hoisted(() => {
  const primaryField = {
    id: 'fldPrimary',
    name: 'Name',
    type: 'singleLineText',
    isPrimary: true,
    canReadFieldRecord: true,
  };
  const secondaryField = {
    id: 'fldNotes',
    name: 'Notes',
    type: 'singleLineText',
    isPrimary: false,
    canReadFieldRecord: true,
  };
  const deniedField = {
    id: 'fldDenied',
    name: 'Denied',
    type: 'singleLineText',
    isPrimary: false,
    canReadFieldRecord: false,
  };
  const allFields = [primaryField, secondaryField, deniedField];
  const columnMeta = {
    [primaryField.id]: { order: 0, visible: false },
    [secondaryField.id]: { order: 1 },
    [deniedField.id]: { order: 2 },
  };
  return {
    primaryField,
    secondaryField,
    deniedField,
    allFields,
    view: { id: 'viwGallery', type: 'gallery', columnMeta, options: {} },
  };
});

// mirrors useFields: readable fields for `withHidden`, the gallery `visible` rules otherwise
vi.mock('@teable/sdk/hooks', () => ({
  useTableId: () => 'tblTest',
  useView: () => fixtures.view,
  useFields: (options: { withHidden?: boolean } = {}) =>
    fixtures.allFields.filter((field) => {
      if (!field.canReadFieldRecord) return false;
      if (options.withHidden) return true;
      return fixtures.view.columnMeta[field.id]?.visible !== false;
    }),
  useCommentPermission: () => ({ commentReadable: false, commentWritable: false }),
  useTablePermission: () => ({}),
  useButtonClickStatus: () => ({}),
  useDeepCompareMemoize: (value: unknown) => value,
}));

vi.mock('@teable/sdk/components', () => ({ ExpandRecorder: () => null }));

vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, pathname: '/', push: vi.fn() }),
}));

const renderCards = () => {
  let projection: string[] | undefined;
  const Cards = () => {
    const { recordQuery } = useGallery();
    projection = recordQuery?.projection as string[] | undefined;
    return <div data-testid="gallery-cards" />;
  };

  const { getByTestId } = render(
    <GalleryProvider>
      <Cards />
    </GalleryProvider>
  );

  expect(getByTestId('gallery-cards')).toBeTruthy();
  return projection;
};

describe('GalleryProvider primary field', () => {
  it('renders the card area and keeps a hidden primary field in the projection', () => {
    const projection = renderCards();

    expect(projection).toContain(fixtures.primaryField.id);
    expect(projection).toContain(fixtures.secondaryField.id);
  });

  it('never projects a field the user cannot read', () => {
    const projection = renderCards();

    expect(projection).not.toContain(fixtures.deniedField.id);
  });
});
