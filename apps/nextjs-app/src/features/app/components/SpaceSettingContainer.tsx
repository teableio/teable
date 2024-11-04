interface SpaceSettingContainerProps {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode | React.ReactNode[];
}

export const SpaceSettingContainer = ({
  title,
  description,
  className,
  children,
}: SpaceSettingContainerProps) => {
  return (
    <div className="h-screen w-full overflow-y-auto overflow-x-hidden">
      <div className="w-full px-8 py-6">
        <div className="border-b pb-4">
          <h1 className="text-3xl font-semibold">{title}</h1>
          {description && <div className="mt-3 text-sm text-slate-500">{description}</div>}
        </div>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
};
