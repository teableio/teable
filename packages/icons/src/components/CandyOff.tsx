import * as React from 'react';
import type { SVGProps } from 'react';
const CandyOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="m8.5 8.5-1 1a4.95 4.95 0 0 0 7 7l1-1M11.843 6.187a4.947 4.947 0 0 1 5.922 3.47c.23.816.246 1.676.048 2.5M14 16.5V14M14 6.5v1.843M10 10v7.5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m16 7 1-5 1.367.683A3 3 0 0 0 19.708 3H21v1.292a3 3 0 0 0 .317 1.341L22 7l-5 1M8 17l-1 5-1.367-.683A3 3 0 0 0 4.292 21H3v-1.292a3 3 0 0 0-.317-1.341L2 17l5-1M2 2l20 20"
    />
  </svg>
);
export default CandyOff;
