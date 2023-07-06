import * as React from 'react';
import type { SVGProps } from 'react';
const ArrowBigLeft = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3 12 7-7v4h11v6H10v4l-7-7Z"
    />
  </svg>
);
export default ArrowBigLeft;
