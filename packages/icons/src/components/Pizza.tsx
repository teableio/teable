import * as React from 'react';
import type { SVGProps } from 'react';
const Pizza = (props: SVGProps<SVGSVGElement>) => (
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
      d="M15 11h.01M11 15h.01M16 16h.01M2 16l20 6-6-20c-3.36.9-6.42 2.67-8.88 5.12A19.876 19.876 0 0 0 2 16Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 6c-6.29 1.47-9.43 5.13-11 11"
    />
  </svg>
);
export default Pizza;
