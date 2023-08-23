import { Input } from '@teable-group/ui-lib';

export const ComputedEditor = (props: { cellValueString?: string }) => {
  const { cellValueString } = props;

  return <Input className="h-8 disabled:cursor-text" value={cellValueString} disabled />;
};
