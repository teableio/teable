import * as React from 'react';
import type { SVGProps } from 'react';
const ArrowBigDown = (props: SVGProps<SVGSVGElement>) => (
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
      d="M9 3h6v11h4l-7 7-7-7h4V3Z"
    />
  </svg>
);
export default ArrowBigDown;
