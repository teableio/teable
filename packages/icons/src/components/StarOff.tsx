import * as React from 'react';
import type { SVGProps } from 'react';
const StarOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91M2 2l20 20"
    />
  </svg>
);
export default StarOff;
