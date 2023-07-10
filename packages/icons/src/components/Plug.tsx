import * as React from 'react';
import type { SVGProps } from 'react';
const Plug = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 22v-5M9 7V2M15 7V2M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z"
    />
  </svg>
);
export default Plug;
