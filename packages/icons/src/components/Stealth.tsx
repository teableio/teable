import * as React from 'react';
import type { SVGProps } from 'react';
const Stealth = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#374151" rx={4} />
    <path
      fill="#fff"
      d="M8 9c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v1h-2V9h-4v2h4c1.1 0 2 .9 2 2v2c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2v-1h2v1h4v-2h-4c-1.1 0-2-.9-2-2z"
    />
  </svg>
);
export default Stealth;
