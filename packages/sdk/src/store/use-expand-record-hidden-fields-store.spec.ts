import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageKeys } from '../config';

const importStore = async () => {
  vi.resetModules();
  return (await import('./use-expand-record-hidden-fields-store')).useExpandRecordHiddenFieldsStore;
};

describe('useExpandRecordHiddenFieldsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads the legacy bare boolean persisted by react-use useLocalStorage', async () => {
    localStorage.setItem(LocalStorageKeys.ExpandRecordHiddenFieldsVisible, 'true');

    const store = await importStore();

    expect(store.getState().hiddenFieldsVisible).toBe(true);
  });

  it('keeps the default when the legacy value is false', async () => {
    localStorage.setItem(LocalStorageKeys.ExpandRecordHiddenFieldsVisible, 'false');

    const store = await importStore();

    expect(store.getState().hiddenFieldsVisible).toBe(false);
  });

  it('reads its own persist envelope after a write', async () => {
    const store = await importStore();
    store.getState().setHiddenFieldsVisible(true);

    const rehydrated = await importStore();

    expect(rehydrated.getState().hiddenFieldsVisible).toBe(true);
  });

  it('falls back to the default when storage is empty', async () => {
    const store = await importStore();

    expect(store.getState().hiddenFieldsVisible).toBe(false);
  });
});
