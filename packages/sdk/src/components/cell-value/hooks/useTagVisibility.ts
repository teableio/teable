import { isString } from 'lodash';
import { useEffect, useRef, useState } from 'react';

export const useTagsVisibility = <T extends string | { id: string; title?: string }>(
  tags: T[] | undefined,
  maxWidth: number = Infinity,
  className: string = 'px-2 text-sm'
) => {
  const [visibleTags, setVisibleTags] = useState<T[]>([]);
  const [hiddenTags, setHiddenTags] = useState<T[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculateVisibleTags = () => {
      if (!containerRef.current || tags == null) return;

      const container = containerRef.current;
      const visible: T[] = [];
      const hidden: T[] = [];

      // Estimated width for "+x" tag
      const plusTagWidth = 40;
      let currentWidth = 0;

      tags.forEach((tag, index) => {
        const tempSpan = document.createElement('span');
        tempSpan.innerText = isString(tag) ? tag : tag.title ?? 'Unnamed record';
        tempSpan.className = className;
        container.appendChild(tempSpan);
        const tagWidth = tempSpan.offsetWidth;
        container.removeChild(tempSpan);

        if (index === 0 && tagWidth > maxWidth - plusTagWidth) {
          visible.push(tag);
          currentWidth = maxWidth;
        } else if (currentWidth + tagWidth + plusTagWidth <= maxWidth) {
          visible.push(tag);
          currentWidth += tagWidth;
        } else {
          hidden.push(tag);
          currentWidth = maxWidth;
        }
      });

      setVisibleTags(visible);
      setHiddenTags(hidden);
    };

    calculateVisibleTags();
    window.addEventListener('resize', calculateVisibleTags);

    return () => window.removeEventListener('resize', calculateVisibleTags);
  }, [tags, className, maxWidth]);

  return { visibleTags, hiddenTags, containerRef };
};
