import { X } from '@teable-group/icons';
import classnames from 'classnames';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { autoMationContext } from '../context';

interface ILeftSiderProps {
  title?: string;
  children?: React.ReactElement;
}

const LeftSider = (props: ILeftSiderProps) => {
  const { title = 'title', children } = props;
  const context = useContext(autoMationContext);
  const { leftSiderVisible, setLeftSiderVisible } = context;
  const router = useRouter();

  const closeSider = () => {
    const {
      query: { automationId },
      pathname,
    } = router;
    const newPathName = pathname
      .replace(/\[automationId\]/g, automationId as string)
      .replace(/\[actionId\]/g, '');
    router.push(`${newPathName}`);
    setLeftSiderVisible(false);
  };

  return (
    <div className={classnames('flex-1', leftSiderVisible ? '' : 'hidden')}>
      <header className="flex justify-between items-center h-12 px-4 border-secondary border-b">
        <span>{title}</span>
        <X className="h-5 w-5 cursor-pointer" onClick={() => closeSider()}></X>
      </header>
      <section>{children}</section>
    </div>
  );
};

export { LeftSider };
