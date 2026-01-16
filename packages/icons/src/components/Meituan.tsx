import * as React from 'react';
import type { SVGProps } from 'react';
const Meituan = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#FFD100" rx={4} />
    <path fill="#000" d="M6 8h3l1.5 4L12 8h3v8h-2v-5l-1.5 4h-1L9 11v5H7zm10 0h2v8h-2z" />
  </svg>
);
export default Meituan;
