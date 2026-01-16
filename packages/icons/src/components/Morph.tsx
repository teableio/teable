import * as React from 'react';
import type { SVGProps } from 'react';
const Morph = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#10B981" rx={4} />
    <path fill="#fff" d="M6 7h3l1.5 5L12 7h1.5l1.5 5L16.5 7H18l-2.5 10h-2L12 12l-1.5 5h-2z" />
  </svg>
);
export default Morph;
