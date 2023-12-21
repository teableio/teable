import type { OpenAPIV3 } from 'openapi-types';
import type { ZodSchema } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type { z } from '../zod';
import { baseConfig } from './constant';
import type { IParameter, ISchemaProps } from './type';

export const parameterParser = (
  schema: ZodSchema,
  type: 'query' | 'path' = 'query',
  schemaProps?: ISchemaProps
) => {
  const schemaJsonContent = zod2JsonSchema(schema);
  const { properties, required } = schemaJsonContent;
  if (!properties) {
    return null;
  }
  const result = [] as IParameter[];
  Object.entries(properties).forEach(([key, value]) => {
    result.push({
      name: key,
      in: type,
      required: required?.includes(key),
      schema: value,
      description: (value as OpenAPIV3.SchemaObject)?.description,
      ...schemaProps?.[key],
    });
  });
  return result;
};

export const bodyParser = (schema: ZodSchema, schemaProps?: ISchemaProps) => {
  const result = zod2JsonSchema(schema);
  const { properties } = result;
  if (properties && schemaProps) {
    Object.entries(properties).forEach(([key, value]) => {
      if (schemaProps[key] && result.properties?.[key]) {
        result.properties[key] = {
          ...value,
          ...schemaProps[key],
        };
      }
    });
  }
  return result;
};

export const zod2JsonSchema = (zodSchema: z.ZodType): OpenAPIV3.SchemaObject => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return zodToJsonSchema(zodSchema, baseConfig) as any;
};
