import * as React from 'react';
import type { SVGProps } from 'react';
const Vibrate = (props: SVGProps<SVGSVGElement>) => (
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
      d="m2 8 2 2-2 2 2 2-2 2M22 8l-2 2 2 2-2 2 2 2M15 5H9a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"
    />
  </svg>
);
export default Vibrate;
