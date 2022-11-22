/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
'use client';
import {
  CaretDownIcon,
  CaretRightIcon,
  Component1Icon,
  Component2Icon,
  FileIcon,
  FrameIcon,
} from '@radix-ui/react-icons';
import clx from 'classnames';
import React from 'react';
import { useOutsideClick } from 'rooks';

interface INavItemProps {
  icon: 'directory' | 'teable' | 'table' | 'file';
  open?: boolean;
  label: string;
  isActive?: boolean;
  setOpen?: (open: boolean) => void;
}

export const NavItem = (props: INavItemProps) => {
  const [isActived, setIsActived] = React.useState(props.isActive);
  const ref = React.useRef<HTMLDivElement>(null);
  useOutsideClick(ref, () => {
    setIsActived(false);
  });
  const fileIconMap = {
    file: <FileIcon />,
    directory: <FrameIcon />,
    table: <Component2Icon />,
    teable: <Component1Icon />,
  };
  const canOpenMap = {
    file: false,
    directory: true,
    table: false,
    teable: true,
  };

  const handleActive = () => {
    setIsActived(true);
  };

  const handleClick = () => {
    props.setOpen && props.setOpen(!props.open);
  };

  return (
    <div
      onClick={handleActive}
      ref={ref}
      className={clx(
        'flex items-center w-full px-2 py-2 hover:bg-gray-50 cursor-pointer select-none',
        { 'bg-gray-100': isActived }
      )}
    >
      {
        <div onClick={handleClick} className="w-4 hover:bg-gray-200">
          {canOpenMap[props.icon] ? (
            props.open ? (
              <CaretDownIcon />
            ) : (
              <CaretRightIcon />
            )
          ) : null}
        </div>
      }
      <div className="pl-2">{fileIconMap[props.icon]}</div>
      <div
        className={clx('pl-2', 'truncate', {
          'font-bold': isActived,
        })}
      >
        {props.label}
      </div>
    </div>
  );
};
