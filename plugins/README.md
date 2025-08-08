# Plugin Development Guide

## Table of Contents
1. [Overview](#overview)
2. [Plugin Structure](#plugin-structure)
3. [Creating a Plugin](#creating-a-plugin)
4. [Plugin Configuration](#plugin-configuration)
5. [Plugin Bridge](#plugin-bridge)
6. [Internationalization](#internationalization)
7. [Publishing](#publishing)

## Overview

Plugins are extensions that can be integrated into different positions within the application. All official plugins are managed within a single Next.js project (`plugins`), allowing for code sharing and simplified maintenance.

### Supported Positions

Plugins can be integrated into two main positions:

````typescript:packages/openapi/src/plugin/types.ts
export enum PluginPosition {
  Dashboard = 'dashboard',
  View = 'view',
}
````

## Plugin Structure

### Project Structure
The plugins project uses Next.js App Router structure:

````bash
plugins/
├── src/
│   ├── app/
│   │   ├── chart/              # Chart plugin
│   │   │   ├── components/
│   │   │   ├── page.tsx
│   │   │   └── favicon.ico
│   │   ├── sheet-form/         # Sheet Form plugin
│   │   │   ├── components/
│   │   │   ├── page.tsx
│   │   │   └── favicon.ico
│   ├── components/             # Shared components
│   ├── locales/               # i18n translations
│   │   ├── chart/
│   │   │   ├── en.json
│   │   │   └── zh.json
│   │   └── sheet-form/
│   │       ├── en.json
│   │       └── zh.json
│   └── types.ts
├── package.json
└── tsconfig.json
````

### Plugin Page Structure
Each plugin should have its own directory under `src/app/` with the following structure:

````typescript:plugins/src/app/chart/page.tsx
import type { Metadata } from 'next';
import { EnvProvider } from '../../components/EnvProvider';
import { I18nProvider } from '../../components/I18nProvider';
import QueryClientProvider from '../../components/QueryClientProvider';
import { PageType } from '../../components/types';
import enCommonJson from '../../locales/chart/en.json';
import zhCommonJson from '../../locales/chart/zh.json';
import { Pages } from './components/Pages';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = searchParams.lang;
  return {
    title: lang === 'zh' ? '图表' : 'Chart',
    icons: icon.src,
  };
}

export default async function Home(props: { searchParams: IPageParams }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <EnvProvider>
        <I18nProvider
          lang={props.searchParams.lang}
          resources={resources}
          defaultNS="common"
          pageType={PageType.Chart}
        >
          <QueryClientProvider>
            <Pages {...props.searchParams} />
          </QueryClientProvider>
        </I18nProvider>
      </EnvProvider>
    </main>
  );
}
````

## Creating a Plugin

### 1. Create Plugin Directory
Add a new directory under `src/app/` for your plugin:

````bash
src/app/my-plugin/
├── components/
├── page.tsx
└── favicon.ico
````

### 2. Configure Plugin
Create a plugin configuration file:

````typescript:apps/nestjs-backend/src/features/plugin/official/config/my-plugin.ts
import { PluginPosition } from '@teable/openapi';
import type { IOfficialPluginConfig } from './types';

export const myPluginConfig: IOfficialPluginConfig = {
  id: 'plg-my-plugin',
  name: 'My Plugin',
  description: 'Plugin description',
  detailDesc: `Detailed description with markdown support`,
  helpUrl: 'https://help.teable.ai',
  positions: [PluginPosition.Dashboard],
  i18n: {
    zh: {
      name: '我的插件',
      helpUrl: 'https://help.teable.cn',
      description: '插件描述',
      detailDesc: '详细描述',
    },
  },
  logoPath: 'static/plugin/my-plugin.png',
  pluginUserId: 'plgmypluginuser',
  avatarPath: 'static/plugin/my-plugin.png',
};
````

## Plugin Bridge

The Plugin Bridge enables communication between your plugin and the main application.

### Bridge Methods

````typescript:apps/nextjs-app/src/features/app/components/plugin/PluginRender.tsx
const methods: IParentBridgeMethods = {
  expandRecord: (recordIds) => {
    console.log('expandRecord', recordIds);
  },
  updateStorage: (storage) => {
    return updateDashboardPluginStorage(baseId, positionId, pluginInstallId, storage).then(
      (res) => res.data.storage ?? {}
    );
  },
  getAuthCode: () => {
    return pluginGetAuthCode(pluginId, baseId).then((res) => res.data);
  },
  expandPlugin: () => {
    onExpand?.();
  },
};
````

### Initializing the Bridge

````typescript:packages/sdk/src/plugin-bridge/bridge.ts
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
````

## Internationalization

Add translations for your plugin under `src/locales/[plugin-name]/`:

````json:plugins/src/locales/my-plugin/zh.json
{
  "title": "我的插件",
  "description": "插件描述",
  "actions": {
    "save": "保存",
    "cancel": "取消"
  }
}
````

## Publishing

1. **Development Status**: Plugins start in `developing` status
2. **Review Process**: Submit for review using the plugin management interface
3. **Publication**: Once approved, the plugin will be published and available in the plugin center

### Plugin Status Flow

````typescript:packages/openapi/src/plugin/types.ts
export enum PluginStatus {
  Developing = 'developing',
  Reviewing = 'reviewing',
  Published = 'published',
}
````

## Best Practices

1. **Code Sharing**: Utilize shared components and utilities from the plugins project
2. **Consistent UI**: Follow the design patterns used by other plugins
3. **Error Handling**: Implement proper error handling and display user-friendly messages
4. **Responsive Design**: Ensure your plugin works well in different container sizes
5. **Performance**: Optimize loading time and resource usage
6. **Security**: Never expose sensitive information in the client-side code
7. **Documentation**: Document your plugin's features and configuration options

For more detailed information and API references, please refer to our complete API documentation.

## Best Practices

1. **Error Handling**: Implement proper error handling and display user-friendly messages
2. **Responsive Design**: Ensure your plugin works well in different container sizes
3. **Performance**: Optimize loading time and resource usage
4. **Security**: Never expose sensitive information in the client-side code
5. **Documentation**: Provide clear documentation for your plugin's features and configuration options

For more detailed information and API references, please refer to our complete API documentation.
