import * as Portal from '@radix-ui/react-portal';
import classnames from 'classnames';

export const Drawer = (props: {
  visible?: boolean;
  onChange?: () => void;
  children?: React.ReactNode;
}) => {
  const { visible, onChange, children } = props;
  return (
    <Portal.Root
      className={classnames('absolute top-0 left-0 w-full h-full', {
        'max-w-0': !visible,
      })}
    >
      <div className="drawer drawer-end rounded">
        <input
          id="my-drawer-4"
          type="checkbox"
          className="drawer-toggle"
          checked={visible}
          onChange={onChange}
        />
        <div className="drawer-side">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label htmlFor="my-drawer-4" className="drawer-overlay"></label>
          <div className="w-96 bg-base-100">{children}</div>
        </div>
      </div>
    </Portal.Root>
  );
};
