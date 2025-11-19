import * as React from 'react';
import type { SVGProps } from 'react';
const ColumnChart = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M4 6C4 4.89543 4.89543 4 6 4H10C11.1046 4 12 4.89543 12 6V35C12 35.5523 11.5523 36 11 36H5C4.44772 36 4 35.5523 4 35V6Z"
      fill="#27272A"
    />
    <path
      d="M16 23.6001C16 22.4955 16.8954 21.6001 18 21.6001H22C23.1046 21.6001 24 22.4955 24 23.6001V35.0001C24 35.5524 23.5523 36.0001 23 36.0001H17C16.4477 36.0001 16 35.5524 16 35.0001V23.6001Z"
      fill="#D4D4D8"
    />
    <path
      d="M28 14.7998C28 13.6952 28.8954 12.7998 30 12.7998H34C35.1046 12.7998 36 13.6952 36 14.7998V34.9998C36 35.5521 35.5523 35.9998 35 35.9998H29C28.4477 35.9998 28 35.5521 28 34.9998V14.7998Z"
      fill="#D4D4D8"
    />
  </svg>
);
export default ColumnChart;
