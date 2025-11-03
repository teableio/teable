import * as React from 'react';
import type { SVGProps } from 'react';
const FileSpreadsheet = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="56"
    height="72"
    viewBox="0 0 56 72"
    fill="none"
    {...props}
  >
    <g clipPath="url(#clip0_260_30544)">
      <path
        d="M0 6C0 2.68629 2.68629 0 6 0H40L56 16V66C56 69.3137 53.3137 72 50 72H6C2.68629 72 0 69.3137 0 66V6Z"
        fill="#10B981"
      />
      <path d="M40 0L56 16H43C41.3431 16 40 14.6569 40 13V0Z" fill="#6EE7B7" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M41 29C43.4853 29 45.5 31.0147 45.5 33.5V51.5C45.5 53.9853 43.4853 56 41 56H15C12.5147 56 10.5 53.9853 10.5 51.5V33.5C10.5 31.0147 12.5147 29 15 29H41ZM13.5 51.5C13.5 52.3284 14.1716 53 15 53H18.5V48H13.5V51.5ZM21.5 53H26.5V48H21.5V53ZM29.5 53H34.5V48H29.5V53ZM37.5 53H41C41.8284 53 42.5 52.3284 42.5 51.5V48H37.5V53ZM13.5 45H18.5V40H13.5V45ZM21.5 45H26.5V40H21.5V45ZM29.5 45H34.5V40H29.5V45ZM37.5 45H42.5V40H37.5V45ZM15 32C14.1716 32 13.5 32.6716 13.5 33.5V37H42.5V33.5C42.5 32.6716 41.8284 32 41 32H15Z"
        fill="white"
      />
    </g>
    <defs>
      <clipPath id="clip0_260_30544">
        <rect width="56" height="72" fill="white" />
      </clipPath>
    </defs>
  </svg>
);
export default FileSpreadsheet;
