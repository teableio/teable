import * as _orpc_server0 from "@orpc/server";
import * as zod0 from "zod";
import * as zod_v4_core0 from "zod/v4/core";
import { ICreateTableEndpointResult, IGetTableByIdEndpointResult, IHandlerResolver } from "@teable/v2-contract-http";
import { IExecutionContext as IExecutionContext$1 } from "@teable/v2-core";

//#region src/router.d.ts
interface IV2OrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext$1 | Promise<IExecutionContext$1>;
}
declare const createV2OrpcRouter: (options?: IV2OrpcRouterOptions) => {
  tables: {
    create: _orpc_server0.Procedure<_orpc_server0.MergedInitialContext<Record<never, never>, Record<never, never>, Record<never, never>>, Record<never, never>, zod0.ZodObject<{
      baseId: zod0.ZodString;
      name: zod0.ZodString;
      fields: zod0.ZodDefault<zod0.ZodArray<zod0.ZodDiscriminatedUnion<[zod0.ZodObject<{
        type: zod0.ZodLiteral<"singleLineText">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          showAs: zod0.ZodOptional<zod0.ZodObject<{
            type: zod0.ZodEnum<{
              [x: string]: string;
            }>;
          }, zod_v4_core0.$strip>>;
          defaultValue: zod0.ZodOptional<zod0.ZodString>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"longText">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          defaultValue: zod0.ZodOptional<zod0.ZodString>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"number">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          formatting: zod0.ZodOptional<zod0.ZodDiscriminatedUnion<[zod0.ZodObject<{
            type: zod0.ZodLiteral<any>;
            precision: zod0.ZodNumber;
          }, zod_v4_core0.$strip>, zod0.ZodObject<{
            type: zod0.ZodLiteral<any>;
            precision: zod0.ZodNumber;
          }, zod_v4_core0.$strip>, zod0.ZodObject<{
            type: zod0.ZodLiteral<any>;
            precision: zod0.ZodNumber;
            symbol: zod0.ZodString;
          }, zod_v4_core0.$strip>], "type">>;
          showAs: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodObject<{
            type: zod0.ZodEnum<{
              [x: string]: any;
            }>;
            color: zod0.ZodEnum<{
              [x: string]: string;
            }>;
            showValue: zod0.ZodBoolean;
            maxValue: zod0.ZodNumber;
          }, zod_v4_core0.$strip>, zod0.ZodObject<{
            type: zod0.ZodEnum<{
              [x: string]: any;
            }>;
            color: zod0.ZodEnum<{
              [x: string]: string;
            }>;
          }, zod_v4_core0.$strip>]>>;
          defaultValue: zod0.ZodOptional<zod0.ZodNumber>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"rating">;
        name: zod0.ZodString;
        max: zod0.ZodOptional<zod0.ZodNumber>;
        options: zod0.ZodOptional<zod0.ZodObject<{
          icon: zod0.ZodOptional<zod0.ZodEnum<{
            [x: string]: string;
          }>>;
          color: zod0.ZodOptional<zod0.ZodEnum<{
            [x: string]: string;
          }>>;
          max: zod0.ZodOptional<zod0.ZodNumber>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"singleSelect">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodArray<zod0.ZodString>, zod0.ZodObject<{
          choices: zod0.ZodOptional<zod0.ZodArray<zod0.ZodObject<{
            id: zod0.ZodOptional<zod0.ZodString>;
            name: zod0.ZodString;
            color: zod0.ZodEnum<{
              [x: string]: string;
            }>;
          }, zod_v4_core0.$strip>>>;
          defaultValue: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodString, zod0.ZodArray<zod0.ZodString>]>>;
          preventAutoNewOptions: zod0.ZodOptional<zod0.ZodBoolean>;
        }, zod_v4_core0.$strip>]>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"multipleSelect">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodArray<zod0.ZodString>, zod0.ZodObject<{
          choices: zod0.ZodOptional<zod0.ZodArray<zod0.ZodObject<{
            id: zod0.ZodOptional<zod0.ZodString>;
            name: zod0.ZodString;
            color: zod0.ZodEnum<{
              [x: string]: string;
            }>;
          }, zod_v4_core0.$strip>>>;
          defaultValue: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodString, zod0.ZodArray<zod0.ZodString>]>>;
          preventAutoNewOptions: zod0.ZodOptional<zod0.ZodBoolean>;
        }, zod_v4_core0.$strip>]>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"checkbox">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          defaultValue: zod0.ZodOptional<zod0.ZodBoolean>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"attachment">;
        name: zod0.ZodString;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"date">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          formatting: zod0.ZodOptional<zod0.ZodObject<{
            date: zod0.ZodString;
            time: zod0.ZodEnum<{
              [x: string]: any;
            }>;
            timeZone: zod0.ZodEnum<{
              [x: string]: string;
            }>;
          }, zod_v4_core0.$strip>>;
          defaultValue: zod0.ZodOptional<zod0.ZodEnum<{
            now: "now";
          }>>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"user">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          isMultiple: zod0.ZodOptional<zod0.ZodBoolean>;
          shouldNotify: zod0.ZodOptional<zod0.ZodBoolean>;
          defaultValue: zod0.ZodOptional<zod0.ZodUnion<readonly [zod0.ZodString, zod0.ZodArray<zod0.ZodString>]>>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>, zod0.ZodObject<{
        type: zod0.ZodLiteral<"button">;
        name: zod0.ZodString;
        options: zod0.ZodOptional<zod0.ZodObject<{
          label: zod0.ZodOptional<zod0.ZodString>;
          color: zod0.ZodOptional<zod0.ZodEnum<{
            [x: string]: string;
          }>>;
          maxCount: zod0.ZodOptional<zod0.ZodNumber>;
          resetCount: zod0.ZodOptional<zod0.ZodBoolean>;
          workflow: zod0.ZodNullable<zod0.ZodOptional<zod0.ZodObject<{
            id: zod0.ZodOptional<zod0.ZodString>;
            name: zod0.ZodOptional<zod0.ZodString>;
            isActive: zod0.ZodOptional<zod0.ZodBoolean>;
          }, zod_v4_core0.$strip>>>;
        }, zod_v4_core0.$strip>>;
        isPrimary: zod0.ZodOptional<zod0.ZodBoolean>;
      }, zod_v4_core0.$strip>], "type">>>;
      views: zod0.ZodOptional<zod0.ZodArray<zod0.ZodObject<{
        type: zod0.ZodOptional<zod0.ZodEnum<{
          grid: "grid";
          calendar: "calendar";
          kanban: "kanban";
          form: "form";
          gallery: "gallery";
          plugin: "plugin";
        }>>;
        name: zod0.ZodOptional<zod0.ZodString>;
      }, zod_v4_core0.$strip>>>;
    }, zod_v4_core0.$strip>, zod0.ZodObject<{
      ok: zod0.ZodLiteral<true>;
      data: any;
    }, zod_v4_core0.$strip>, _orpc_server0.MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
    getById: _orpc_server0.Procedure<_orpc_server0.MergedInitialContext<Record<never, never>, Record<never, never>, Record<never, never>>, Record<never, never>, zod0.ZodObject<{
      baseId: zod0.ZodString;
      tableId: zod0.ZodString;
    }, zod_v4_core0.$strip>, zod0.ZodObject<{
      ok: zod0.ZodLiteral<true>;
      data: any;
    }, zod_v4_core0.$strip>, _orpc_server0.MergedErrorMap<Record<never, never>, Record<never, never>>, Record<never, never>>;
  };
};
type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;
//#endregion
//#region src/handlers/tables/createTable.d.ts
declare const executeCreateTableEndpoint: (context: IExecutionContext, rawBody: unknown, commandBus: ICommandBus) => Promise<ICreateTableEndpointResult>;
//#endregion
//#region src/handlers/tables/getTableById.d.ts
declare const executeGetTableByIdEndpoint: (context: IExecutionContext, rawInput: unknown, queryBus: IQueryBus) => Promise<IGetTableByIdEndpointResult>;
//#endregion
export { IV2OrpcRouterOptions, V2OrpcRouter, createV2OrpcRouter, executeCreateTableEndpoint, executeGetTableByIdEndpoint };