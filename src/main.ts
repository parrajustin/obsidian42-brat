/* eslint-disable no-console */
import { Plugin } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { BratSettingsTab } from "./ui/SettingsTab";
import type { Settings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import BetaPlugins from "./features/BetaPlugins";
import { AddIcons } from "./ui/icons";
import { Logger } from "./utils/logging";
import PluginCommands from "./ui/PluginCommands";
import BratAPI from "./utils/BratAPI";
import { ToastMessage } from "./utils/notifications";
import AddNewPluginModal from "./ui/AddNewPluginModal";

export default class ThePlugin extends Plugin {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    APP_NAME = "BRAT";
    // eslint-disable-next-line @typescript-eslint/naming-convention
    APP_ID = "obsidian42-brat";
    settings: Settings = DEFAULT_SETTINGS;
    betaPlugins = new BetaPlugins(this);
    commands: PluginCommands = new PluginCommands(this);
    bratApi: BratAPI = new BratAPI(this);

    public onload() {
        console.log("loading " + this.APP_NAME);

        this.loadSettings()
            .then(() => {
                this.addSettingTab(new BratSettingsTab(this.app, this));

                AddIcons();
                this.showRibbonButton();
                this.registerObsidianProtocolHandler("brat", this.obsidianProtocolHandler);

                this.app.workspace.onLayoutReady(() => {
                    // let obsidian load and calm down before checking for updates
                    if (this.settings.updateAtStartup) {
                        // eslint-disable-next-line @typescript-eslint/no-misused-promises
                        setTimeout(async () => {
                            await this.betaPlugins.checkForPluginUpdatesAndInstallUpdates(false);
                        }, 60000);
                    }
                    setTimeout(() => {
                        window.bratAPI = this.bratApi;
                    }, 500);
                });
            })
            .catch((error: unknown) => {
                console.error("Failed to load settings:", error);
            });
    }

    public showRibbonButton(): void {
        this.addRibbonIcon("BratIcon", "BRAT", () => {
            this.commands.ribbonDisplayCommands();
        });
    }

    public async log(textToLog: string, verbose = false): Promise<void> {
        await Logger(this, textToLog, verbose);
    }

    public onunload(): void {
        console.log("unloading " + this.APP_NAME);
    }

    public async loadSettings(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Obsidian loadData is set to return Any
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    public async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    public obsidianProtocolHandler = (params: ObsidianProtocolData) => {
        if (
            (params.plugin === undefined || params.plugin === "") &&
            (params.theme === "" || params.theme === undefined)
        ) {
            ToastMessage(this, `Could not locate the repository from the URL.`, 10);
            return;
        }

        if (params.plugin !== undefined) {
            const modal = new AddNewPluginModal(this, this.betaPlugins);
            modal.address = params.plugin;
            modal.open();
            return;
        }
    };
}
