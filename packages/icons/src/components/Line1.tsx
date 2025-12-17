import * as React from 'react';
import type { SVGProps } from 'react';
const Line1 = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M19 8H5C3.89543 8 3 8.89543 3 10V14C3 15.1046 3.89543 16 5 16H19C20.1046 16 21 15.1046 21 14V10C21 8.89543 20.1046 8 19 8Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default Line1;
