import { err, ok } from 'neverthrow';

import { domainError } from '../../shared/DomainError';
import { CellValueType } from '../CellValueType';
import type { TypedValue } from '../typed-value';
import { FormulaFunc, FormulaFuncType, FunctionName } from './common';

abstract class TextFunc extends FormulaFunc {
  readonly type = FormulaFuncType.Text;
}

export class Concatenate extends TextFunc {
  name = FunctionName.Concatenate;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Concatenate} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Find extends TextFunc {
  name = FunctionName.Find;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Find} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Search extends TextFunc {
  name = FunctionName.Search;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Search} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class Mid extends TextFunc {
  name = FunctionName.Mid;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      return err(
        domainError.validation({ message: `${FunctionName.Mid} needs at least 3 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Left extends TextFunc {
  name = FunctionName.Left;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Left} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Right extends TextFunc {
  name = FunctionName.Right;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 1) {
      return err(
        domainError.validation({ message: `${FunctionName.Right} needs at least 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Replace extends TextFunc {
  name = FunctionName.Replace;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 4) {
      return err(
        domainError.validation({ message: `${FunctionName.Replace} needs at least 4 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class RegExpReplace extends TextFunc {
  name = FunctionName.RegExpReplace;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      return err(
        domainError.validation({ message: `${FunctionName.RegExpReplace} needs at least 3 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Substitute extends TextFunc {
  name = FunctionName.Substitute;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 3) {
      return err(
        domainError.validation({ message: `${FunctionName.Substitute} needs at least 3 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Lower extends TextFunc {
  name = FunctionName.Lower;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Lower} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Upper extends TextFunc {
  name = FunctionName.Upper;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Upper} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Rept extends TextFunc {
  name = FunctionName.Rept;

  acceptValueType = new Set([CellValueType.String, CellValueType.Number]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length < 2) {
      return err(
        domainError.validation({ message: `${FunctionName.Rept} needs at least 2 params` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Trim extends TextFunc {
  name = FunctionName.Trim;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Trim} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class T extends TextFunc {
  name = FunctionName.T;

  acceptValueType = new Set([
    CellValueType.String,
    CellValueType.Number,
    CellValueType.Boolean,
    CellValueType.DateTime,
  ]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.T} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}

export class Len extends TextFunc {
  name = FunctionName.Len;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(domainError.validation({ message: `${FunctionName.Len} only allow 1 param` }));
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.Number });
    return this.validateParams(params).map(() => ({ type: CellValueType.Number }));
  }
}

export class EncodeUrlComponent extends TextFunc {
  name = FunctionName.EncodeUrlComponent;

  acceptValueType = new Set([CellValueType.String]);

  acceptMultipleValue = true;

  validateParams(params: TypedValue[]) {
    if (params.length !== 1) {
      return err(
        domainError.validation({ message: `${FunctionName.EncodeUrlComponent} only allow 1 param` })
      );
    }
    return ok(undefined);
  }

  getReturnType(params?: TypedValue[]) {
    if (!params) return ok({ type: CellValueType.String });
    return this.validateParams(params).map(() => ({ type: CellValueType.String }));
  }
}
