import type { IGetSpaceVo } from '@teable/openapi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@teable/ui-lib';
import { SpaceCollaboratorModal } from './SpaceCollaboratorModal';

interface ISpaceCollaboratorModalTrigger {
  space: IGetSpaceVo;
}

export const SpaceCollaboratorModalTrigger: React.FC<
  React.PropsWithChildren<ISpaceCollaboratorModalTrigger>
> = (props) => {
  const { children, space } = props;
  const { name } = space;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[90%] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{name} space sharing</DialogTitle>
        </DialogHeader>
        <SpaceCollaboratorModal space={space} />
      </DialogContent>
    </Dialog>
  );
};
