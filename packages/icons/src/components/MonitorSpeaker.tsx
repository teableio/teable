import * as React from 'react';
import type { SVGProps } from 'react';
const MonitorSpeaker = (props: SVGProps<SVGSVGElement>) => (
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
      d="M5.5 20H8M17 9h.01M20 4h-6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
    />
  </svg>
);
export default MonitorSpeaker;
