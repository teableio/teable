import * as React from 'react';
import type { SVGProps } from 'react';
const Cat = (props: SVGProps<SVGSVGElement>) => (
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
      d="M14 5.256A8.148 8.148 0 0 0 12 5a9.04 9.04 0 0 0-2 .227M20.098 10c.572 1.068.902 2.24.902 3.444C21 17.89 16.97 21 12 21s-9-3-9-7.556c0-1.251.288-2.41.792-3.444M3.75 10S2.11 3.58 3.5 3C4.89 2.42 8 3 9.781 5M20.172 10.002s1.64-6.42.25-7c-1.39-.58-4.5 0-6.282 2M8 14v.5M16 14v.5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11.25 16.25h1.5L12 17l-.75-.75Z"
    />
  </svg>
);
export default Cat;
