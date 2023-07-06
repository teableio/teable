import * as React from 'react';
import type { SVGProps } from 'react';
const Crown = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5 20h14M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7Z"
    />
  </svg>
);
export default Crown;
