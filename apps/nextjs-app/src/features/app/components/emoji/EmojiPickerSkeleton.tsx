import { Skeleton } from '@teable/ui-lib/shadcn';

const EmojiGridSkeleton = ({ rows }: { rows: number }) => (
  <div className="grid grid-cols-[repeat(9,36px)]">
    {Array.from({ length: rows * 9 }, (_, i) => (
      <div key={i} className="flex size-9 items-center justify-center">
        <Skeleton className="size-6 rounded-full" />
      </div>
    ))}
  </div>
);

// Mirrors emoji-mart's default layout at its default 352×435 size — category nav, search,
// titled emoji grids and the preview footer — so the picker swaps in without a jump.
export const EmojiPickerSkeleton = () => (
  <div className="flex h-[435px] w-[352px] flex-col overflow-hidden">
    <div className="grid h-11 shrink-0 grid-cols-[repeat(9,36px)] items-center border-b ps-3">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex justify-center">
          <Skeleton className="size-[18px] rounded-full" />
        </div>
      ))}
    </div>
    <div className="min-h-0 flex-1 overflow-hidden pe-4 ps-3">
      <Skeleton className="mt-[9px] h-9 rounded-[10px]" />
      <Skeleton className="mb-2 ms-1.5 mt-[11px] h-3.5 w-28" />
      <EmojiGridSkeleton rows={1} />
      <Skeleton className="mb-2 ms-1.5 mt-2.5 h-3.5 w-32" />
      <EmojiGridSkeleton rows={5} />
    </div>
    <div className="flex h-[69px] shrink-0 items-center gap-3 border-t px-4">
      <Skeleton className="size-9 rounded-full" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="ms-auto size-4 rounded-full" />
    </div>
  </div>
);
