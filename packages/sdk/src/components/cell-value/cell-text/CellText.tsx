import type { ISingleLineTextActionType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import type { MouseEvent, ReactNode } from 'react';
import { findUrls } from '../../../utils/find-urls';
import { toUrlHref } from '../../../utils/url';
import { onMixedTextClick } from '../../editor/text/utils';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellText extends ICellValue<string> {
  // Email / phone turn the whole value into an action; otherwise URLs inside
  // the text are detected and rendered as links
  actionType?: ISingleLineTextActionType;
}

const stopPropagation = (e: MouseEvent) => e.stopPropagation();

// Splits the text into plain runs and anchors for every detected URL
const renderLinkedText = (value: string): ReactNode => {
  const links = findUrls(value);
  if (!links.length) return undefined;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  links.forEach(({ start, end, url }) => {
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(
      <a
        key={start}
        href={toUrlHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-violet-500 hover:underline hover:underline-offset-2"
        onClick={stopPropagation}
      >
        {value.slice(start, end)}
      </a>
    );
    cursor = end;
  });
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
};

export const CellText = (props: ICellText) => {
  const { value, className, style, ellipsis, actionType } = props;

  const onJump = () => {
    if (!actionType || !value) return;
    onMixedTextClick(actionType, value);
  };

  return (
    <OverflowTooltip
      text={value}
      content={!actionType && value ? renderLinkedText(value) : undefined}
      ellipsis={ellipsis}
      className={cn(
        'w-full text-[13px] leading-5',
        actionType && 'cursor-pointer hover:underline hover:underline-offset-2 text-violet-500',
        className
      )}
      style={style}
      onClick={!actionType ? undefined : onJump}
    />
  );
};
