import { useIsHydrated } from '@teable-group/sdk/hooks';
import { Allotment } from 'allotment';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { autoMationContext } from './context';
import { Menu } from './menu';
import { RightSider, FormPanel } from './right-sider';
import { WorkFlowPanel } from './workflow-panel';

const AutoMationPage = () => {
  const [menuVisible, setMenuVisible] = useState(true);
  const [rightSiderVisible, setRightSiderVisible] = useState(true);
  const toggleMenu = (visible: boolean) => {
    setMenuVisible(visible);
  };
  const router = useRouter();

  const isHydrated = useIsHydrated();

  useEffect(() => {
    const {
      query: { automationId, actionId },
    } = router;
    if (actionId && automationId) {
      setRightSiderVisible(true);
    } else {
      setRightSiderVisible(false);
    }
  }, [router]);

  return isHydrated ? (
    <autoMationContext.Provider
      value={{
        menuVisible,
        toggleMenu,
        rightSiderVisible,
        setRightSiderVisible,
      }}
    >
      <div className="p-t-4 p-r-4 p-l-4 flex h-full w-full justify-between">
        <>
          <Allotment>
            {menuVisible && (
              <Allotment.Pane minSize={250} maxSize={350} preferredSize={300}>
                <Menu></Menu>
              </Allotment.Pane>
            )}
            <Allotment.Pane>
              <WorkFlowPanel></WorkFlowPanel>
            </Allotment.Pane>
            {rightSiderVisible && (
              <Allotment.Pane minSize={320} maxSize={370} preferredSize={300}>
                <RightSider>
                  <FormPanel></FormPanel>
                </RightSider>
              </Allotment.Pane>
            )}
          </Allotment>
        </>
      </div>
    </autoMationContext.Provider>
  ) : null;
};
export { AutoMationPage };
