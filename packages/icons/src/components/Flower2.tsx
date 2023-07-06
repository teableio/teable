import * as React from 'react';
import type { SVGProps } from 'react';
const Flower2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1m3 2a3 3 0 1 1-3 3m3-3h-1M9 8a3 3 0 1 0 3 3M9 8h1m2 3v-1"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 10v12M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5ZM12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"
    />
  </svg>
);
export default Flower2;
