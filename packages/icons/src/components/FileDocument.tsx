import * as React from 'react';
import type { SVGProps } from 'react';
const FileDocument = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="120"
    height="120"
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect width="120" height="120" fill="#DBEAFE" />
    <g clipPath="url(#clip0_221_32461)">
      <path
        d="M32 30C32 26.6863 34.6863 24 38 24H72L88 40V90C88 93.3137 85.3137 96 82 96H38C34.6863 96 32 93.3137 32 90V30Z"
        fill="#3B82F6"
      />
      <path
        d="M60.2294 63.8389L64.8172 76.6848C65.7348 78.5199 68.4875 78.5199 68.9462 76.6848L75.828 58.3335C76.2867 56.9572 75.828 56.0396 74.4516 55.5808C73.0753 55.122 72.1577 55.5808 71.6989 56.4984L67.1111 69.3443L62.5233 56.4984C61.6057 54.6632 58.853 54.6632 57.9355 56.4984L53.3477 69.3443L48.7599 56.4984C48.3011 55.5808 46.9247 54.6632 45.5484 55.122C44.172 55.5808 43.7133 56.9572 44.172 58.3335L51.0538 76.6848C51.9713 78.5199 54.724 78.5199 55.1828 76.6848L60.2294 63.8389Z"
        fill="white"
      />
      <path d="M72 24L88 40H75C73.3431 40 72 38.6569 72 37V24Z" fill="#93C5FD" />
    </g>
    <defs>
      <clipPath id="clip0_221_32461">
        <rect width="56" height="72" fill="white" transform="translate(32 24)" />
      </clipPath>
    </defs>
  </svg>
);
export default FileDocument;
