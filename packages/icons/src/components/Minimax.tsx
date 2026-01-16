import * as React from 'react';
import type { SVGProps } from 'react';
const Minimax = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#6366F1" rx={4} />
    <path fill="#fff" d="M7 8h2l3 4 3-4h2v8h-2v-5l-3 4-3-4v5H7z" />
  </svg>
);
export default Minimax;
