import { get } from 'lodash';
import type { OpenAPIV3 } from 'openapi-types';
import type z from 'zod';
import { defaultBaseOpenApi } from './constant';
import { zod2JsonSchema, parameterParser, bodyParser } from './parser';
import type {
  RouteConfig,
  Zod2OpenAPIDocument,
  Zod2OpenAPIInitConfig,
  IParameters,
  IRequestBodyObject,
} from './type';

export class Zod2OpenAPI {
  public router: RouteConfig[] = [];
  public result: Zod2OpenAPIDocument = {};
  constructor(config?: Zod2OpenAPIInitConfig) {
    this.router = [];
    this.result = {
      ...defaultBaseOpenApi,
      ...config,
    };
  }

  registerRoute = (router: RouteConfig) => {
    this.router.push(router);
    return router;
  };

  registerComponent = (key: string, value: unknown) => {
    const currentComponent = this.result.components || {};
    this.result.components = {
      ...currentComponent,
      [key]: value,
    };
  };

  genOpenApiContent() {
    const { router, result } = this;
    //   const { method, path, description, request, responses, tags, schemaProps } = item;
    //   const accumulatedInfo = result.paths?.[path] || {};
    //   const parameters = [] as IParameters;
    //   const requestBody: OpenAPIV3.RequestBodyObject = {
    //     content: {},
    //   };
    //   const responseData = {} as OpenAPIV3.ResponsesObject;

    //   if (request) {
    //     Object.entries(request).forEach(([requestType, value]) => {
    //       switch (requestType) {
    //         case 'params': {
    //           const result = parameterParser(value as z.ZodType, 'path', schemaProps);
    //           result && parameters.push(...result);
    //           break;
    //         }
    //         case 'query': {
    //           const result = parameterParser(value as z.ZodType, 'query', schemaProps);
    //           result && parameters.push(...result);
    //           break;
    //         }
    //         case 'body': {
    //           const bodyValue = value as IRequestBodyObject;
    //           const contentType = Object.keys(bodyValue.content)[0];
    //           const schema = bodyValue.content[contentType].schema;
    //           const schemaContent = bodyParser(schema, schemaProps);
    //           const content = {
    //             schema: schemaContent,
    //           };
    //           // openapi 3.0 get description in parameter from outer not in schema
    //           requestBody.content[contentType] = {
    //             ...content,
    //           };
    //           break;
    //         }
    //         default:
    //           break;
    //       }
    //     });
    //   }

    //   if (responses) {
    //     Object.entries(responses).forEach(([key, value]) => {
    //       const responseValue = value;

    //       if (responseValue.content) {
    //         const contentType = Object.keys(responseValue.content)[0];
    //         const schema = responseValue.content[contentType].schema;
    //         const schemaContent = zod2JsonSchema(schema);
    //         const content = {
    //           schema: schemaContent,
    //         };
    //         responseData[key] = {
    //           ...responseValue,
    //           content: {
    //             [contentType]: {
    //               ...content,
    //             },
    //           },
    //         };
    //       } else {
    //         responseData[key] = {
    //           ...responseValue,
    //           content: {},
    //         };
    //       }
    //     });
    //   }

    //   const curInfo = {
    //     [method]: {
    //       tags,
    //       description,
    //       security: [
    //         {
    //           bearerAuth: [],
    //         },
    //       ],
    //       parameters,
    //       requestBody: Object.keys(requestBody.content).length ? requestBody : undefined,
    //       responses: responseData,
    //     },
    //   };

    //   result.paths = {
    //     ...result.paths,
    //     [path]: {
    //       ...accumulatedInfo,
    //       ...curInfo,
    //     },
    //   };
    // });
    return router.reduce<Zod2OpenAPIDocument>(
      (accResult, currentRouter) => {
        const { method, path, description, request, responses, tags, schemaProps } = currentRouter;
        const parameters = [] as IParameters;
        const requestBody: OpenAPIV3.RequestBodyObject = {
          content: {},
        };
        const responseData = {} as OpenAPIV3.ResponsesObject;

        if (request) {
          Object.entries(request).forEach(([requestType, value]) => {
            switch (requestType) {
              case 'params': {
                const result = parameterParser(value as z.ZodType, 'path', schemaProps);
                result && parameters.push(...result);
                break;
              }
              case 'query': {
                const result = parameterParser(value as z.ZodType, 'query', schemaProps);
                result && parameters.push(...result);
                break;
              }
              case 'body': {
                const bodyValue = value as IRequestBodyObject;
                const contentType = Object.keys(bodyValue.content)[0];
                const schema = bodyValue.content[contentType].schema;
                const schemaContent = bodyParser(schema, schemaProps);
                const content = {
                  schema: schemaContent,
                };
                // openapi 3.0 get description in parameter from outer not in schema
                requestBody.content[contentType] = {
                  ...content,
                };
                break;
              }
              default:
                break;
            }
          });
        }

        if (responses) {
          Object.entries(responses).forEach(([key, value]) => {
            const responseValue = value;

            if (responseValue.content) {
              const contentType = Object.keys(responseValue.content)[0];
              const schema = responseValue.content[contentType].schema;
              const schemaContent = zod2JsonSchema(schema);
              const content = {
                schema: schemaContent,
              };
              responseData[key] = {
                ...responseValue,
                content: {
                  [contentType]: {
                    ...content,
                  },
                },
              };
            } else {
              responseData[key] = {
                ...responseValue,
                content: {},
              };
            }
          });
        }

        const curInfo = {
          [method]: {
            tags,
            description,
            security: [
              {
                bearerAuth: [],
              },
            ],
            parameters,
            requestBody: Object.keys(requestBody.content).length ? requestBody : undefined,
            responses: responseData,
          },
        };

        accResult.paths = {
          ...accResult.paths,
          [path]: {
            ...get(accResult, `paths.${path}`, {}),
            ...curInfo,
          },
        };
        return accResult;
      },
      {
        ...result,
      }
    );
  }

  genOpenApiJson() {
    const result = this.genOpenApiContent();
    return JSON.stringify(result, null, 2);
  }
}
