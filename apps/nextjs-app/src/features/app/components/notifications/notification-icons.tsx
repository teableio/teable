import type { ReactNode, SVGProps } from 'react';

/**
 * Lucide icons the panel needs and `@teable/icons` (generated from Figma) does
 * not have yet, drawn the same way: 24 grid, 2px round stroke, 1em.
 */
const icon = (shapes: ReactNode) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1em"
        height="1em"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {shapes}
      </svg>
    );
  };

export const BellDot = icon(
  <>
    <path d="M19.4 14.9C20.2 16.4 21 17 21 17H3s3-2 3-9c0-3.3 2.7-6 6-6 .7 0 1.3.1 1.9.3M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    <circle cx={18} cy={8} r={3} />
  </>
);

export const FileDown = icon(
  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M12 18v-6M9 15l3 3 3-3" />
);

export const MessageCircle = icon(
  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
);

export const Gift = icon(
  <>
    <rect x={3} y={8} width={18} height={4} rx={1} />
    <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
  </>
);

export const MonitorDot = icon(
  <>
    <path d="M12 17v4M22 12.307V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8.693M8 21h8" />
    <circle cx={19} cy={6} r={3} />
  </>
);
