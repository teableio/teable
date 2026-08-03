import * as React from 'react';
import type { SVGProps } from 'react';
const FileImage = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-image)">
      <path
        fill="#FF3093"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm5.931 14.461c.467.624.936 1.249 1.315 1.249.713 0 1.5-1.172 2.306-2.37 1.096-1.632 2.225-3.312 3.24-2.143.638.735 1.296 2.345 1.875 3.762.202.494.394.964.573 1.367v.57c0 .677-.547 1.224-1.224 1.224H7.104a1.224 1.224 0 0 1-1.224-1.224v-.403c.232-.52.468-1.105.682-1.635.21-.522.4-.99.542-1.29.402-.848 1.053.021 1.707.893m.741-6.745a1.835 1.835 0 1 1-3.672 0 1.835 1.835 0 1 1 3.672 0"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-image">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileImage;
