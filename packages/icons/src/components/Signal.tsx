import * as React from 'react';
import type { SVGProps } from 'react';
const Signal = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"
    />
  </svg>
);
export default Signal;
