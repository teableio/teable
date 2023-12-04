import { pick } from 'lodash';
import type { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import type { IClsStore } from '../types/cls';
import type { IRawOpMap, IRawOp } from './interface';
import type { ShareDbService } from './share-db.service';
import type { WsDerivateService } from './ws-derivate.service';

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
    async (context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) => {
      const saveContext = context.agent.custom?.saveContext;
      const stashOpMap = context.agent.custom?.stashOpMap;

      if (stashOpMap) {
        cls.set('tx.stashOpMap', stashOpMap);
      }

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
