import * as React from 'react';
import type { SVGProps } from 'react';

const DiffSquare = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
      <rect x={3} y={3} width={18} height={18} rx={3} />
      <path d="M12 6v6M9 9h6M9 16h6" />
    </g>
  </svg>
);

export default DiffSquare;
