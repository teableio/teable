import * as React from 'react';
import type { SVGProps } from 'react';
const MousePointer2 = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m4 4 7.07 17 2.51-7.39L21 11.07 4 4Z"
    />
  </svg>
);
export default MousePointer2;
