import { FileTree } from '../blocks/FileTree';
import { useAppStore } from '../store';

export const SideMenu = () => {
  const selectPath = useAppStore((state) => state.selectPath);
  // const [currentPath, setCurrentPath] = useLocalstorageState(
  //   'TEABLE_SIDE_MENU_INPUT',
  //   ''
  // );

  return (
    <>
      <FileTree rootPath={selectPath} />
    </>
  );
};
