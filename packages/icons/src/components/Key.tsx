import * as React from 'react';
import type { SVGProps } from 'react';
const Key = (props: SVGProps<SVGSVGElement>) => (
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
      d="m21 2-2 2m0 0 3 3-3.5 3.5-3-3M19 4l-3.5 3.5m-4.11 4.11a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5"
    />
  </svg>
);
export default Key;
