import * as React from 'react';
import type { SVGProps } from 'react';
const MailSearch = (props: SVGProps<SVGSVGElement>) => (
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
      d="M22 12.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h7.5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 22l-1.5-1.5"
    />
  </svg>
);
export default MailSearch;
