import { FieldMenu, EditorContainer, FieldSetting } from './components';
import { useGridViewStore } from './store/gridView';

export const DomBox = () => {
  const { editorCtx } = useGridViewStore();

  return (
    <>
      {/* field header menu */}
      {<FieldMenu />}
      {/* field setting */}
      {<FieldSetting />}
      {editorCtx && <EditorContainer />}
    </>
  );
};
