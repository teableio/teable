import * as React from 'react';
import type { SVGProps } from 'react';
const StarHalf = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 17.8 5.8 21 7 14.1 2 9.3l7-1L12 2"
    />
  </svg>
);
export default StarHalf;
