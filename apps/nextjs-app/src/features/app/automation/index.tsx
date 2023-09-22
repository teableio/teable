import { Allotment } from 'allotment';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { autoMationContext } from './context';
import { LeftSider, FormPanel } from './left-sider';
import { Menu } from './menu';
import { WorkFlowPanel } from './workflow-panel';

// interface IAutpMationProps {
//   list: [];
// }

const AutoMationPage = () => {
  const [menuVisible, setMenuVisible] = useState(true);
  const [leftSiderVisible, setLeftSiderVisible] = useState(true);
  const toggleMenu = (visible: boolean) => {
    setMenuVisible(visible);
  };
  const router = useRouter();

  useEffect(() => {
    const {
      query: { automationId, actionId },
    } = router;
    if (actionId && automationId) {
      setLeftSiderVisible(true);
    } else {
      setLeftSiderVisible(false);
    }
  }, [router]);

  return (
    <autoMationContext.Provider
      value={{
        menuVisible,
        toggleMenu,
        leftSiderVisible,
        setLeftSiderVisible,
      }}
    >
      <div className="p-t-4 p-r-4 p-l-4 flex h-full justify-between">
        <>
          <Allotment>
            {menuVisible && (
              <Allotment.Pane minSize={250} maxSize={350} preferredSize={300}>
                <Menu></Menu>
              </Allotment.Pane>
            )}
            <WorkFlowPanel></WorkFlowPanel>
            {leftSiderVisible && (
              <Allotment.Pane minSize={320} maxSize={370} preferredSize={300}>
                <LeftSider>
                  <FormPanel></FormPanel>
                </LeftSider>
              </Allotment.Pane>
            )}
          </Allotment>
        </>
      </div>
    </autoMationContext.Provider>
  );
};
export { AutoMationPage };
