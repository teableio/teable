import * as React from 'react';
import type { SVGProps } from 'react';
const Voyage = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#7C3AED" rx={4} />
    <path fill="#fff" d="M7 7h2l3 8 3-8h2l-4.5 10h-1z" />
  </svg>
);
export default Voyage;
