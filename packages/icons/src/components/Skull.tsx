import * as React from 'react';
import type { SVGProps } from 'react';
const Skull = (props: SVGProps<SVGSVGElement>) => (
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
      d="M9 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM15 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 20v2h8v-2M12.5 17l-.5-1-.5 1h1Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"
    />
  </svg>
);
export default Skull;
