import * as React from 'react';
import type { SVGProps } from 'react';
const ArrowBigRight = (props: SVGProps<SVGSVGElement>) => (
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
      d="m21 12-7-7v4H3v6h11v4l7-7Z"
    />
  </svg>
);
export default ArrowBigRight;
