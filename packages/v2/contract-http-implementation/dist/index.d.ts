import { ICreateTableEndpointResult, IGetTableByIdEndpointResult, IHandlerResolver } from "@teable/v2-contract-http";
import { IExecutionContext as IExecutionContext$1 } from "@teable/v2-core";

//#region src/router.d.ts
interface IV2OrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext$1 | Promise<IExecutionContext$1>;
}
declare const createV2OrpcRouter: (options?: IV2OrpcRouterOptions) => any;
type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;
//#endregion
//#region src/handlers/tables/createTable.d.ts
declare const executeCreateTableEndpoint: (context: IExecutionContext, rawBody: unknown, commandBus: ICommandBus) => Promise<ICreateTableEndpointResult>;
//#endregion
//#region src/handlers/tables/getTableById.d.ts
declare const executeGetTableByIdEndpoint: (context: IExecutionContext, rawInput: unknown, queryBus: IQueryBus) => Promise<IGetTableByIdEndpointResult>;
//#endregion
export { IV2OrpcRouterOptions, V2OrpcRouter, createV2OrpcRouter, executeCreateTableEndpoint, executeGetTableByIdEndpoint };
//# sourceMappingURL=index.d.ts.map