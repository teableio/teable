import * as React from 'react';
import type { SVGProps } from 'react';
const DraggableHandle = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 10 20"
    {...props}
  >
    <g clipPath="url(#prefix__draggable-handle)">
      <path
        fill="#94A3B8"
        d="M2.143 17.143a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857m5.714 0a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857m-5.714-5.714a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857m5.714 0a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857M2.143 5.714a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857m5.714 0a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857M2.143 0a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857m5.714 0a1.429 1.429 0 1 1 0 2.857 1.429 1.429 0 0 1 0-2.857"
      />
    </g>
    <defs>
      <clipPath id="prefix__draggable-handle">
        <path fill="#fff" d="M0 0h10v20H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default DraggableHandle;
