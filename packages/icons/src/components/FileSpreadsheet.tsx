import * as React from 'react';
import type { SVGProps } from 'react';
const FileSpreadsheet = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="120"
    height="120"
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect width="120" height="120" fill="#D1FAE5" />
    <g clipPath="url(#clip0_221_32413)">
      <path
        d="M32 30C32 26.6863 34.6863 24 38 24H72L88 40V90C88 93.3137 85.3137 96 82 96H38C34.6863 96 32 93.3137 32 90V30Z"
        fill="#10B981"
      />
      <path d="M72 24L88 40H75C73.3431 40 72 38.6569 72 37V24Z" fill="#6EE7B7" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M73 53C75.4853 53 77.5 55.0147 77.5 57.5V75.5C77.5 77.9853 75.4853 80 73 80H47C44.5147 80 42.5 77.9853 42.5 75.5V57.5C42.5 55.0147 44.5147 53 47 53H73ZM45.5 75.5C45.5 76.3284 46.1716 77 47 77H50.5V72H45.5V75.5ZM53.5 77H58.5V72H53.5V77ZM61.5 77H66.5V72H61.5V77ZM69.5 77H73C73.8284 77 74.5 76.3284 74.5 75.5V72H69.5V77ZM45.5 69H50.5V64H45.5V69ZM53.5 69H58.5V64H53.5V69ZM61.5 69H66.5V64H61.5V69ZM69.5 69H74.5V64H69.5V69ZM47 56C46.1716 56 45.5 56.6716 45.5 57.5V61H74.5V57.5C74.5 56.6716 73.8284 56 73 56H47Z"
        fill="white"
      />
    </g>
    <defs>
      <clipPath id="clip0_221_32413">
        <rect width="56" height="72" fill="white" transform="translate(32 24)" />
      </clipPath>
    </defs>
  </svg>
);
export default FileSpreadsheet;
