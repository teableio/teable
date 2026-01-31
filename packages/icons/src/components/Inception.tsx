import * as React from 'react';
import type { SVGProps } from 'react';
const Inception = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#F59E0B" rx={4} />
    <path fill="#fff" d="M11 7h2v10h-2z" />
  </svg>
);
export default Inception;
