import { useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, FC } from 'react';

type TypedTextProps = {
  /** Animation speed in milliseconds */
  delay: number;
  children: string;
} & HTMLAttributes<HTMLSpanElement>;

const defaultProps = {
  delay: 250,
};

export const TypedText: FC<TypedTextProps> = (props) => {
  const { children, delay, ...restProps } = { ...defaultProps, ...props };

  const [text, setText] = useState(children);
  const [currIdx, setCurrIdx] = useState(0);

  const interval = useRef<number | null | undefined>();
  useEffect(() => {
    interval.current = window.setInterval(() => {
      // console.log('running interval');
      setCurrIdx((currIdx) => {
        if (currIdx > text.length) {
          if (interval.current) {
            setText(text === 'Typescript' ? children : 'Typescript');
            window.clearInterval(interval.current);
            interval.current = null;
          }
          return 0;
        }
        return currIdx + 1;
      });
    }, delay);
    return () => {
      if (interval.current) {
        setCurrIdx(0);
        window.clearInterval(interval.current);
        interval.current = null;
      }
    };
  }, [delay, text, children]);

  const slice =
    currIdx - 1 > text.length
      ? currIdx.toString(10)
      : `${text.slice(0, currIdx)}`;

  return <span {...restProps}>{slice}</span>;
};
