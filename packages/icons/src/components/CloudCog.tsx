import * as React from 'react';
import type { SVGProps } from 'react';
const CloudCog = (props: SVGProps<SVGSVGElement>) => (
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
      d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 13v1M12 20v1M16 17h-1M9 17H8M15 14l-.88.88M9.88 19.12 9 20M15 20l-.88-.88M9.88 14.88 9 14"
    />
  </svg>
);
export default CloudCog;
