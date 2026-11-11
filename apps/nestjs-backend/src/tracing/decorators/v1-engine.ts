/* eslint-disable @typescript-eslint/naming-convention */
import { annotateSpan, Span } from './span';

export const TEABLE_V1_ENGINE_ATTRIBUTE = 'teable.v1.engine';

/** Marks execution, never routing intent. Labels use the declaring class so
 * inherited EE methods retain a stable identity independent of DI wrappers. */
export function V1Engine(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const engine = `${target.constructor.name}.${String(propertyKey)}`;
    const attributes = { [TEABLE_V1_ENGINE_ATTRIBUTE]: engine };
    if (annotateSpan(descriptor.value as object, attributes)) return;
    return Span(engine, { attributes })(target, propertyKey, descriptor);
  };
}

/** Own public methods only. Inherited implementations keep their base label;
 * overrides must opt in independently, so a v2 override cannot inherit a tag. */
export function V1EngineService(methods: readonly string[]): ClassDecorator {
  return (target) => {
    for (const method of methods) {
      const descriptor = Object.getOwnPropertyDescriptor(target.prototype, method);
      if (!descriptor || typeof descriptor.value !== 'function') {
        throw new Error(`Missing v1 execution boundary: ${target.name}.${method}`);
      }
      V1Engine()(target.prototype, method, descriptor);
      Object.defineProperty(target.prototype, method, descriptor);
    }
  };
}
