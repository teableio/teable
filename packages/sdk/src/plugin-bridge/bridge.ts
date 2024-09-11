import type { AsyncMethodReturns, Connection, Methods } from 'penpal';
import { connectToParent } from 'penpal';
import type { IBridgeListener, IChildBridgeMethods, IParentBridgeMethods } from './types';

export class PluginBridge implements IBridgeListener {
  private connection: Connection<IParentBridgeMethods>;
  private bridge?: AsyncMethodReturns<IParentBridgeMethods>;

  private listeners: Partial<
    Record<keyof IChildBridgeMethods, IChildBridgeMethods[keyof IChildBridgeMethods][]>
  > = {};

  constructor() {
    const methods: IChildBridgeMethods = {
      syncUIConfig: (uiConfig) => {
        this.listeners.syncUIConfig?.forEach((cb) => cb(uiConfig));
      },
      syncBasePermissions: (basePermissions) => {
        this.listeners.syncBasePermissions?.forEach((cb) =>
          (cb as IChildBridgeMethods['syncBasePermissions'])(basePermissions)
        );
      },
    };
    this.connection = connectToParent({
      // Methods child is exposing to parent.
      methods: methods as unknown as Methods,
    });
  }

  async init() {
    this.bridge = await this.connection.promise;
    return {
      ...this.bridge,
      on: this.on.bind(this),
      removeListener: this.removeListener.bind(this),
      removeAllListeners: this.removeAllListeners.bind(this),
      destroy: this.destroy.bind(this),
    };
  }

  on<T extends keyof IChildBridgeMethods>(event: T, callback: IChildBridgeMethods[T]) {
    const callbacks = this.listeners[event];
    if (callbacks?.some((cb) => cb === callback)) {
      return;
    }
    this.listeners[event] = callbacks ? [...callbacks, callback] : [callback];
  }

  removeListener<T extends keyof IChildBridgeMethods>(event: T, listener: IChildBridgeMethods[T]) {
    const callbacks = this.listeners[event];
    if (!callbacks) {
      return;
    }
    this.listeners[event] = callbacks.filter((cb) => cb !== listener);
  }

  removeAllListeners<T extends keyof IChildBridgeMethods>(event?: T) {
    if (!event) {
      this.listeners = {};
    } else {
      delete this.listeners[event];
    }
  }

  destroy() {
    this.connection.destroy();
  }
}

export const initializeBridge = async () => {
  if (typeof window === 'undefined') {
    return;
  }
  const pluginBridge = new PluginBridge();
  const bridge = await pluginBridge.init();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)._teable_plugin_bridge = bridge;
  return bridge;
};
