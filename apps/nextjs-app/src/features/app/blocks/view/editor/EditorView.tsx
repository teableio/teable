import { RecordProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { EditorToolBar } from '../tool-bar/EditorToolBar';
import { EditorProvider } from './context';
import { EditorViewBase } from './EditorViewBase';

export const EditorView = () => {
  const isHydrated = useIsHydrated();

  return (
    <SearchProvider>
      <RecordProvider>
        <EditorToolBar />
        <EditorProvider>
          <div className="w-full grow overflow-hidden">{isHydrated && <EditorViewBase />}</div>
        </EditorProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
