import type { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import type { IClsStore } from '../types/cls';
import type { ShareDbService } from './share-db.service';
import type { ICustomSubmitContext, WsDerivateService } from './ws-derivate.service';

export const derivateMiddleware = (
  shareDB: ShareDbService,
  cls: ClsService<IClsStore>,
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
    async (context: ICustomSubmitContext, next: (err?: unknown) => void) => {
      // console.log('afterWrite:context', JSON.stringify(context.extra, null, 2));
      const saveContext = context.extra.saveContext;
      const stashOpMap = context.extra.stashOpMap;

      if (saveContext) {
        stashOpMap && cls.set('tx.stashOpMap', stashOpMap);

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
