import * as React from 'react';
import type { SVGProps } from 'react';
const Pause = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 4H6v16h4V4ZM18 4h-4v16h4V4Z"
    />
  </svg>
);
export default Pause;
