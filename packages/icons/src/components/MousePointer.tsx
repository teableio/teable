import * as React from 'react';
import type { SVGProps } from 'react';
const MousePointer = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3ZM13 13l6 6"
    />
  </svg>
);
export default MousePointer;
