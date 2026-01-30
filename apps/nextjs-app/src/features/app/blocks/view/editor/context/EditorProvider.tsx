import type { EditorView } from '@teable/sdk/model';
import { useView } from '@teable/sdk/hooks';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';

interface IEditorContext {
  selectedRecordId: string | null;
  setSelectedRecordId: (id: string | null) => void;
  editorFieldId: string | null;
}

const EditorContext = createContext<IEditorContext | null>(null);

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const view = useView() as EditorView | undefined;
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      selectedRecordId,
      setSelectedRecordId,
      editorFieldId: view?.options?.editorFieldId ?? null,
    }),
    [selectedRecordId, view?.options?.editorFieldId]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

export const useEditor = () => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within EditorProvider');
  }
  return context;
};
