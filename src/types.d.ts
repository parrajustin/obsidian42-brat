import type { PluginSettingTab } from "obsidian";
import type BratApi from "./utils/BratAPI";

declare global {
    interface Window {
        bratAPI?: BratApi;
    }
}

interface ExtendedPluginTab extends PluginSettingTab {
    name: string;
    id: string;
    versin: string;
}

declare module "obsidian" {
    interface App {
        setting: {
            pluginTabs: ExtendedPluginTab[];
            settingTabs: ExtendedPluginTab[];
            open: () => void;
            close: () => void;
            openTabById: (id: string) => void;
        };

        plugins: {
            manifests: Record<string, { id: string }>;
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
            updates: Record<string, unknown>;
            enablePlugin(pluginName: string): unknown;
            disablePlugin(pluginName: string): unknown;
            getPluginFolder(): string;
            loadManifest(path: string): Promise<void>;
            enablePluginAndSave(plugin: string): Promise<void>;
            disablePluginAndSave(plugin: string): void;
            getPlugin(plugin: string): Plugin | null;
            checkForUpdates(): Promise<void>;
            loadManifests(): Promise<void>;
        };
    }
}
