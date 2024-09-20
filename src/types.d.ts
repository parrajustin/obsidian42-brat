import type BratApi from './utils/BratAPI';

declare global {
  interface Window {
    bratAPI?: BratApi;
  }
}

declare module "obsidian" {
    interface App {
        setting: {
            settingTabs(settingTabs: any): unknown;
            close: () => void;
        };

        plugins: {
            enablePlugin(pluginName: string): unknown;
            disablePlugin(pluginName: string): unknown;
            manifests: Record<string, unknown>;
            plugins: {
                [key: string]: { manifest: PluginManifest } | undefined;
                // eslint-disable-next-line @typescript-eslint/naming-convention
                "obsidian-hover-editor":
                    | {
                          manifest: PluginManifest;
                          spawnPopover(
                              initiatingEl?: HTMLElement,
                              onShowCallback?: () => unknown
                          ): WorkspaceLeaf;
                      }
                    | undefined;
            };
            updates: {
                [key: string]: unknown;
            };
            getPluginFolder(): string;
            loadManifest(path: string): Promise<void>;
            enablePluginAndSave(plugin: string): void;
            disablePluginAndSave(plugin: string): void;
            getPlugin(plugin: string): Plugin | null;
            checkForUpdates(): Promise<void>;
            loadManifests(): Promise<void>;
        };
    }
}
