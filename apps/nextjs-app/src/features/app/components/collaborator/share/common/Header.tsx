interface IShareHeaderProps {
  title: string;
  description: React.ReactNode;
}
export const ShareHeader = (props: IShareHeaderProps) => {
  const { title, description } = props;
  return (
    <div className="flex flex-col items-start gap-1 self-stretch">
      <p className="text-lg font-semibold leading-normal">{title}</p>
      <p className="text-xs leading-normal text-muted-foreground">{description}</p>
    </div>
  );
};
