import type { IJsonApiSuccessResponse, IViewVo } from '@teable-group/core';
import { ViewOpBuilder, ViewCore } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import axios from 'axios';
export class ViewExtended {
  static updateName(doc: Doc<IViewVo>, name: string, oldName: string) {
    const viewOperation = ViewOpBuilder.editor.setViewName.build({
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
