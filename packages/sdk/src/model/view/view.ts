import type { IJsonApiSuccessResponse, IViewSnapshot, IViewVo } from '@teable-group/core';
import { OpBuilder, ViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';
export class ViewExtended {
  static updateName(doc: Doc<IViewSnapshot>, name: string, oldName: string) {
    const viewOperation = OpBuilder.editor.setViewName.build({
      newName: name,
      oldName: oldName,
    });

    return new Promise<void>((resolve, reject) => {
      doc.submitOp([viewOperation], undefined, (error) => {
        error ? reject(error) : resolve(undefined);
      });
    });
  }
}

export abstract class View extends ViewCore {
  static async getViews(tableId: string) {
    const response = await axios.get<IJsonApiSuccessResponse<IViewVo[]>>(
      `/api/table/${tableId}/view`
    );
    return response.data.data;
  }

  abstract updateName(_name: string): Promise<void>;
}
