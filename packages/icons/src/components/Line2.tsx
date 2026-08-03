import * as React from 'react';
import type { SVGProps } from 'react';
const Line2 = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M21 12H3M5 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7C3 5.89543 3.89543 5 5 5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default Line2;
