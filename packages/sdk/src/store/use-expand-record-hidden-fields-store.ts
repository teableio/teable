import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { LocalStorageKeys } from '../config';

interface IExpandRecordHiddenFieldsState {
  hiddenFieldsVisible: boolean;
  setHiddenFieldsVisible: (visible: boolean) => void;
}

type IPersistedState = Pick<IExpandRecordHiddenFieldsState, 'hiddenFieldsVisible'>;

const jsonStorage = createJSONStorage<IPersistedState>(() => localStorage);

// react-use's useLocalStorage previously stored a bare JSON boolean under this
// key; wrap it in the persist envelope so the old preference is kept.
const legacyAwareStorage: PersistStorage<IPersistedState> | undefined = jsonStorage && {
  ...jsonStorage,
  getItem: (name) => {
    const value = jsonStorage.getItem(name) as StorageValue<IPersistedState> | boolean | null;
    if (typeof value === 'boolean') {
      return { state: { hiddenFieldsVisible: value }, version: 0 };
    }
    return value;
  },
};

export const useExpandRecordHiddenFieldsStore = create<IExpandRecordHiddenFieldsState>()(
  persist(
    (set) => ({
      hiddenFieldsVisible: false,
      setHiddenFieldsVisible: (visible: boolean) => set({ hiddenFieldsVisible: visible }),
    }),
    {
      name: LocalStorageKeys.ExpandRecordHiddenFieldsVisible,
      storage: legacyAwareStorage,
    }
  )
);
