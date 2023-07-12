import * as React from 'react';
import type { SVGProps } from 'react';
const Accessibility = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 19l1-7-5.87.94M5 8l3-3 5.5 3-2.21 3.1M4.24 14.48c-.19.58-.27 1.2-.23 1.84a5 5 0 0 0 7.11 4.21"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13.76 17.52c.19-.58.27-1.2.23-1.84a5 5 0 0 0-5.31-4.67c-.65.04-1.25.2-1.8.46"
    />
  </svg>
);
export default Accessibility;
