import type ShareDBClass from 'sharedb';
import type { ShareDbService } from './share-db.service';
import type { WsDerivateService } from './ws-derivate.service';

export const derivateMiddleware = (
  shareDB: ShareDbService,
  wsDerivateService: WsDerivateService
) => {
  shareDB.use(
    'apply',
    async (context: ShareDBClass.middleware.ApplyContext, next: (err?: unknown) => void) => {
      await wsDerivateService.onRecordApply(context, next);
    }
  );

  shareDB.use(
    'afterWrite',
    async (context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) => {
      const saveContext = context.agent.custom?.saveContext;
      if (saveContext) {
        try {
          await wsDerivateService.save(saveContext);
        } catch (e) {
          // TODO: rollback
          return next(e);
        }
      }

      next();
    }
  );
};
