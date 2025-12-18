import type { ITemplateVo } from '@teable/openapi';
import { Sheet, SheetContent, SheetTrigger } from '@teable/ui-lib/shadcn';
import { TemplatePreview } from './TemplatePreview';

interface ITemplatePreviewSheetProps {
  detail?: ITemplateVo;
  children: React.ReactNode;
}
export const TemplatePreviewSheet = (props: ITemplatePreviewSheetProps) => {
  const { detail, children } = props;
  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="h-[65%]">
        <div className="h-full pt-4">
          <TemplatePreview className="h-full" detail={detail} hidePreviewButton isFull />
        </div>
      </SheetContent>
    </Sheet>
  );
};
