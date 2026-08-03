import type { AsyncMethodReturns, Connection, Methods } from 'penpal';
import { connectToParent } from 'penpal';
import type { IBridgeListener, IChildBridgeMethods, IParentBridgeMethods } from './types';

type IListenerKeys = keyof IChildBridgeMethods;

type IListenerRecord = {
  [K in IListenerKeys]: IChildBridgeMethods[K][];
};

export class PluginBridge implements IBridgeListener {
  private connection: Connection<IParentBridgeMethods>;
  private bridge?: AsyncMethodReturns<IParentBridgeMethods>;

  private listeners: Partial<IListenerRecord> = {};

  constructor() {
    const methods: IChildBridgeMethods = {
      syncUIConfig: (uiConfig) => {
        this.listeners.syncUIConfig?.forEach((cb: IChildBridgeMethods['syncUIConfig']) =>
          cb(uiConfig)
        );
      },
      syncBasePermissions: (basePermissions) => {
        this.listeners.syncBasePermissions?.forEach(
          (cb: IChildBridgeMethods['syncBasePermissions']) => cb(basePermissions)
        );
      },
      syncSelection: (selection) => {
        this.listeners.syncSelection?.forEach((cb: IChildBridgeMethods['syncSelection']) =>
          cb(selection)
        );
      },
      syncUrlParams: (urlParams) => {
        this.listeners.syncUrlParams?.forEach((cb: IChildBridgeMethods['syncUrlParams']) =>
          cb(urlParams)
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

  on<T extends IListenerKeys>(event: T, callback: IChildBridgeMethods[T]) {
    const callbacks = this.listeners[event];
    if (callbacks?.some((cb) => cb === callback)) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.listeners[event] = callbacks ? [...callbacks, callback] : ([callback] as any);
  }

  removeListener<T extends IListenerKeys>(event: T, listener: IChildBridgeMethods[T]) {
    const callbacks = this.listeners[event];
    if (!callbacks) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.listeners[event] = callbacks.filter((cb) => cb !== listener) as any;
  }

  removeAllListeners<T extends IListenerKeys>(event?: T) {
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
