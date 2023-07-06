import * as React from 'react';
import type { SVGProps } from 'react';
const ClipboardEdit = (props: SVGProps<SVGSVGElement>) => (
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
      d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1ZM10.42 12.61a2.101 2.101 0 0 1 2.97 2.97L7.95 21 4 22l.99-3.95 5.43-5.44Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5.5M4 13.5V6a2 2 0 0 1 2-2h2"
    />
  </svg>
);
export default ClipboardEdit;
