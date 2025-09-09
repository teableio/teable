export const TooltipItem = (props: {
  label: string;
  indicatorColor?: string;
  children: React.ReactNode;
}) => {
  const { label, indicatorColor, children } = props;

  return (
    <>
      <div
        className="size-2.5 shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]"
        style={
          {
            '--color-bg': indicatorColor,
            '--color-border': indicatorColor,
          } as React.CSSProperties
        }
      />
      <div className="flex flex-1 items-center justify-between gap-2 leading-none">
        <div className="grid gap-1.5">
          <span className="text-muted-foreground">{label}</span>
        </div>
        <span className="text-foreground font-mono font-medium tabular-nums">{children}</span>
      </div>
    </>
  );
};
