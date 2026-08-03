import * as React from 'react';
import type { SVGProps } from 'react';
const Xiaomi = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#FF6900" rx={4} />
    <path fill="#fff" d="M6 8h4v2H8v6H6zm6 0h4c1.1 0 2 .9 2 2v6h-2v-6h-2v6h-2zm-4 4h2v4H8z" />
  </svg>
);
export default Xiaomi;
