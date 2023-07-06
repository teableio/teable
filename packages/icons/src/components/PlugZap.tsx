import * as React from 'react';
import type { SVGProps } from 'react';
const PlugZap = (props: SVGProps<SVGSVGElement>) => (
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
      d="m13 2-2 2.5h3L12 7M12 22v-3M10 13v-2.5M10 12.5v-2M14 12.5v-2M16 15a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2Z"
    />
  </svg>
);
export default PlugZap;
