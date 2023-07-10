import * as React from 'react';
import type { SVGProps } from 'react';
const CheckCheck = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16"
    />
  </svg>
);
export default CheckCheck;
