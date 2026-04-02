import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export interface IPersonalViewStoreApi {
  personalViewMap: Record<string, Record<string, unknown>>;
  isPersonalView: (viewId: string) => boolean;
  setPersonalViewMap: (
    viewId: string,
    updater: (prev: Record<string, unknown>) => Record<string, unknown>
  ) => void;
  removePersonalView: (viewId: string) => void;
}

const ShareSessionViewStoreContext = createContext<IPersonalViewStoreApi | null>(null);

export const useShareSessionViewStore = () => useContext(ShareSessionViewStoreContext);

export const ShareSessionViewStoreProvider = ({
  children,
  initialViewMap,
}: {
  children: React.ReactNode;
  initialViewMap?: Record<string, Record<string, unknown>>;
}) => {
  const initialRef = useRef(initialViewMap);
  const [personalViewMap, setMap] = useState<Record<string, Record<string, unknown>>>(
    () => initialRef.current ?? {}
  );

  const isPersonalView = useCallback(
    (viewId: string) => Boolean(personalViewMap[viewId]),
    [personalViewMap]
  );

  const setPersonalViewMap = useCallback(
    (viewId: string, updater: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      setMap((prev) => ({
        ...prev,
        [viewId]: updater(prev[viewId] ?? {}),
      }));
    },
    []
  );

  const removePersonalView = useCallback((viewId: string) => {
    setMap((prev) => {
      const { [viewId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const value: IPersonalViewStoreApi = {
    personalViewMap,
    isPersonalView,
    setPersonalViewMap,
    removePersonalView,
  };

  return (
    <ShareSessionViewStoreContext.Provider value={value}>
      {children}
    </ShareSessionViewStoreContext.Provider>
  );
};
