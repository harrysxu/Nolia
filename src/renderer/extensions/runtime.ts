import type { ReactNode } from "react";

import type { ExtensionContributions, ExtensionManifest, ExtensionPermission, PluginDescriptor } from "../../shared/extensions";
import type { FileBinaryReadResponse } from "../../shared/types";

export interface Disposable {
  dispose: () => void;
}

export type PluginRenderResult = ReactNode | HTMLElement | string | null | undefined;
export type PluginRenderProvider<TContext> = (context: TContext) => PluginRenderResult | Promise<PluginRenderResult>;

export interface PluginSidebarPanelContext {
  workspace?: {
    workspaceId: string;
    name: string;
    rootPath: string;
  };
  activeDocument?: {
    pathRel: string;
    title: string;
    dirty: boolean;
  };
}

export interface PluginFileViewerContext {
  workspaceId?: string;
  pathRel: string;
  name: string;
  size: number;
  category?: string;
  url?: string;
  readText: () => Promise<string>;
  readBinary: () => Promise<FileBinaryReadResponse>;
  openExternal: () => Promise<void>;
  revealInFinder: () => Promise<void>;
}

export interface PluginFileEditorContext extends PluginFileViewerContext {
  initialText: string;
  initialBytes?: ArrayBuffer;
  baseHash?: string;
  dirty: boolean;
  updateText: (content: string, options?: { dirty?: boolean }) => void;
  updateBinary: (data: ArrayBuffer | ArrayBufferView, options?: { dirty?: boolean }) => void;
  setDirty: (dirty: boolean) => void;
  save: (content?: string) => Promise<void>;
  writeText: (content: string) => Promise<void>;
  saveBinary: (data?: ArrayBuffer | ArrayBufferView) => Promise<void>;
  writeBinary: (data: ArrayBuffer | ArrayBufferView) => Promise<void>;
}

export interface PluginHostApi {
  ui: {
    registerContributions: (contributions: ExtensionContributions) => Disposable;
    registerCommand: (id: string, handler: () => void | Promise<void>) => Disposable;
    registerSidebarPanel: (id: string, render: PluginRenderProvider<PluginSidebarPanelContext>) => Disposable;
    registerFileViewer: (id: string, render: PluginRenderProvider<PluginFileViewerContext>) => Disposable;
    registerFileEditor: (id: string, render: PluginRenderProvider<PluginFileEditorContext>) => Disposable;
  };
  workspace: {
    getActiveWorkspace: () => { workspaceId: string; name: string; rootPath: string } | undefined;
    readFile: (pathRel: string) => Promise<string>;
    writeFile: (pathRel: string, content: string) => Promise<void>;
    readBinaryFile: (pathRel: string) => Promise<FileBinaryReadResponse>;
    writeBinaryFile: (pathRel: string, data: ArrayBuffer | ArrayBufferView) => Promise<void>;
  };
  permissions: {
    has: (permission: ExtensionPermission) => boolean;
  };
  network: {
    request: (url: string, options?: RequestInit) => Promise<Response>;
  };
}

export interface RendererExtensionContext {
  manifest: ExtensionManifest;
  permissions: string[];
  subscriptions: Disposable[];
  api: PluginHostApi;
}

export interface RendererPluginModule {
  activate?: (context: RendererExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export interface RendererPluginHost {
  registerContributions: (pluginId: string, contributions: ExtensionContributions) => Disposable;
  registerCommand: (pluginId: string, id: string, handler: () => void | Promise<void>) => Disposable;
  registerSidebarPanel: (pluginId: string, id: string, render: PluginRenderProvider<PluginSidebarPanelContext>) => Disposable;
  registerFileViewer: (pluginId: string, id: string, render: PluginRenderProvider<PluginFileViewerContext>) => Disposable;
  registerFileEditor: (pluginId: string, id: string, render: PluginRenderProvider<PluginFileEditorContext>) => Disposable;
  getActiveWorkspace: () => { workspaceId: string; name: string; rootPath: string } | undefined;
  readWorkspaceFile: (pluginId: string, pathRel: string) => Promise<string>;
  writeWorkspaceFile: (pluginId: string, pathRel: string, content: string) => Promise<void>;
  readWorkspaceBinaryFile: (pluginId: string, pathRel: string) => Promise<FileBinaryReadResponse>;
  writeWorkspaceBinaryFile: (pluginId: string, pathRel: string, data: ArrayBuffer | ArrayBufferView) => Promise<void>;
  hasPermission: (pluginId: string, permission: ExtensionPermission) => boolean;
  requestNetwork: (pluginId: string, url: string, options?: RequestInit) => Promise<Response>;
}

export async function activateRendererPlugin(descriptor: PluginDescriptor, host: RendererPluginHost): Promise<Disposable> {
  if (!descriptor.manifest || !descriptor.rendererUrl) {
    return emptyDisposable;
  }
  const module = (await import(/* @vite-ignore */ descriptor.rendererUrl)) as RendererPluginModule;
  const subscriptions: Disposable[] = [];
  const context: RendererExtensionContext = {
    manifest: descriptor.manifest,
    permissions: descriptor.manifest.permissions ?? [],
    subscriptions,
    api: {
      ui: {
        registerContributions: (contributions) => {
          const disposable = host.registerContributions(descriptor.pluginId, contributions);
          subscriptions.push(disposable);
          return disposable;
        },
        registerCommand: (id, handler) => {
          const disposable = host.registerCommand(descriptor.pluginId, id, handler);
          subscriptions.push(disposable);
          return disposable;
        },
        registerSidebarPanel: (id, render) => {
          const disposable = host.registerSidebarPanel(descriptor.pluginId, id, render);
          subscriptions.push(disposable);
          return disposable;
        },
        registerFileViewer: (id, render) => {
          const disposable = host.registerFileViewer(descriptor.pluginId, id, render);
          subscriptions.push(disposable);
          return disposable;
        },
        registerFileEditor: (id, render) => {
          const disposable = host.registerFileEditor(descriptor.pluginId, id, render);
          subscriptions.push(disposable);
          return disposable;
        }
      },
      workspace: {
        getActiveWorkspace: host.getActiveWorkspace,
        readFile: (pathRel) => host.readWorkspaceFile(descriptor.pluginId, pathRel),
        writeFile: (pathRel, content) => host.writeWorkspaceFile(descriptor.pluginId, pathRel, content),
        readBinaryFile: (pathRel) => host.readWorkspaceBinaryFile(descriptor.pluginId, pathRel),
        writeBinaryFile: (pathRel, data) => host.writeWorkspaceBinaryFile(descriptor.pluginId, pathRel, data)
      },
      permissions: {
        has: (permission) => host.hasPermission(descriptor.pluginId, permission)
      },
      network: {
        request: (url, options) => host.requestNetwork(descriptor.pluginId, url, options)
      }
    }
  };
  await module.activate?.(context);
  return {
    dispose: () => {
      for (const subscription of [...subscriptions].reverse()) {
        subscription.dispose();
      }
      void module.deactivate?.();
    }
  };
}

const emptyDisposable: Disposable = {
  dispose: () => undefined
};
