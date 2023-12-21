import type { OpenAPIV3 } from 'openapi-types';
import type { AnyZodObject, ZodSchema } from 'zod';
import type zodToJsonSchema from 'zod-to-json-schema';

type Modify<T, R> = Omit<T, keyof R> & R;

export type IParameter = OpenAPIV3.ParameterObject;
export type IParameters = (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[];
export type Zod2OpenAPIInitConfig = Pick<OpenAPIV3.Document, 'openapi' | 'info' | 'servers'>;
export type Zod2OpenAPIDocument = Partial<OpenAPIV3.Document>;
export type IZodToJsonSchemaConfig = Parameters<typeof zodToJsonSchema>[1];
export type ISchemaProps = Record<string, Omit<OpenAPIV3.BaseSchemaObject, 'required'>>;
export type IRequestBodyObject = Modify<
  OpenAPIV3.RequestBodyObject,
  {
    content: {
      [media: string]: {
        schema: ZodSchema;
      };
    };
  }
>;

export type IResponsesObject = {
  [code: string | number]: Modify<
    OpenAPIV3.ResponseObject,
    {
      content?: {
        [media: string]: {
          schema: ZodSchema;
        };
      };
    }
  >;
};

export type RouteConfig = {
  method:
    | 'get'
    | 'post'
    | 'put'
    | 'delete'
    | 'patch'
    | 'POST'
    | 'PUT'
    | 'DELETE'
    | 'PATCH'
    | 'PATCH';
  path: string;
  tags: string[];
  description: string;
  schemaProps?: ISchemaProps;
  request?: {
    params?: AnyZodObject;
    query?: AnyZodObject;
    body?: IRequestBodyObject;
  };
  responses?: IResponsesObject;
};
