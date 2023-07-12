import * as React from 'react';
import type { SVGProps } from 'react';
const GripHorizontal = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
    />
  </svg>
);
export default GripHorizontal;
