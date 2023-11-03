import { X } from '@teable-group/icons';
import classnames from 'classnames';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { autoMationContext } from '../context';

interface ILeftSiderProps {
  title?: string;
  children?: React.ReactElement;
}

const RightSider = (props: ILeftSiderProps) => {
  const { title = 'title', children } = props;
  const context = useContext(autoMationContext);
  const { rightSiderVisible, setRightSiderVisible } = context;
  const router = useRouter();

  const closeSider = () => {
    const {
      query: { automationId, baseId },
    } = router;

    router.push(
      {
        pathname: '/base/[baseId]/automation/[automationId]',
        query: { baseId, automationId },
      },
      undefined,
      { shallow: true }
    );
    setRightSiderVisible(false);
  };

  return (
    <div className={classnames('flex-1', rightSiderVisible ? '' : 'hidden')}>
      <header className="flex h-12 items-center justify-between border-b border-secondary px-4">
        <span>{title}</span>
        <X className="h-5 w-5 cursor-pointer" onClick={() => closeSider()}></X>
      </header>
      <section>{children}</section>
    </div>
  );
};

export { RightSider };
