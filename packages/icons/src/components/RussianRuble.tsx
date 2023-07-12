import * as React from 'react';
import type { SVGProps } from 'react';
const RussianRuble = (props: SVGProps<SVGSVGElement>) => (
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
      d="M14 11c5.333 0 5.333-8 0-8M6 11h8M6 15h8M9 21V3M9 3h5"
    />
  </svg>
);
export default RussianRuble;
