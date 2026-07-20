/* eslint-disable no-console */
import type ThePlugin from "../main";
import AddNewPluginModal from "../ui/AddNewPluginModal";
import {
    grabManifestJsonFromRepository,
    grabReleaseFileFromRepository,
    grabReleaseTarballFromRepository
} from "./githubUtils";
import { extractTarGz } from "../utils/tarball";
import type { StatusResult } from "standard-ts-lib/src/result";
import { Err, Ok } from "standard-ts-lib/src/result";
import type { StatusError } from "standard-ts-lib/src/status_error";
import { FailedPreconditionError } from "standard-ts-lib/src/status_error";
import { WrapPromise } from "standard-ts-lib/src/wrap_promise";
import type { PluginManifest } from "obsidian";
import { normalizePath, Notice, requireApiVersion, apiVersion } from "obsidian";
import { AddBetaPluginToList } from "../settings";
import { ToastMessage } from "../utils/notifications";
import { IsConnectedToInternet } from "../utils/internetconnection";

/**
 * all the files needed for a plugin based on the release files are hre
 */
interface ReleaseFiles {
    mainJs: string | null;
    manifest: string | null;
    styles: string | null;
    /**
     * full set of files from a packaged .tar.gz release asset, when the
     * release provides one. null means the classic fixed-file download was used
     */
    tarball: Map<string, Uint8Array> | null;
}

/**
 * Primary handler for adding, updating, deleting beta plugins tracked by this plugin
 */
export default class BetaPlugins {
    plugin: ThePlugin;

    constructor(plugin: ThePlugin) {
        this.plugin = plugin;
    }

    /**
     * opens the AddNewPluginModal to get info for  a new beta plugin
     * @param openSettingsTabAfterwards - will open settings screen afterwards. Used when this command is called from settings tab
     * @param useFrozenVersion - install the plugin using frozen version.
     */
    public displayAddNewPluginModal(
        openSettingsTabAfterwards = false,
        useFrozenVersion = false
    ): void {
        const newPlugin = new AddNewPluginModal(
            this.plugin,
            this,
            openSettingsTabAfterwards,
            useFrozenVersion
        );
        newPlugin.open();
    }

    /**
     * Validates that a GitHub repository is plugin
     *
     * @param repositoryPath - GithubUser/RepositoryName (example: TfThacker/obsidian42-brat)
     * @param getBetaManifest - test the beta version of the manifest, not at the root
     * @param false - [false description]
     * @param reportIssues - will display notices as it finds issues
     *
     * @returns the manifest file if found, or null if its incomplete
     */
    public async validateRepository(
        repositoryPath: string,
        getBetaManifest = false,
        reportIssues = false
    ): Promise<PluginManifest | null> {
        const noticeTimeout = 15;
        const manifestJson = await grabManifestJsonFromRepository(
            repositoryPath,
            !getBetaManifest,
            this.plugin.settings.debuggingMode,
            this.plugin.settings.personalAccessToken
        );
        if (!manifestJson) {
            // this is a plugin with a manifest json, try to see if there is a beta version
            if (reportIssues) {
                ToastMessage(
                    this.plugin,
                    `${repositoryPath}\nThis does not seem to be an obsidian plugin, as there is no manifest.json file.`,
                    noticeTimeout
                );
                console.error(
                    "BRAT: validateRepository",
                    repositoryPath,
                    getBetaManifest,
                    reportIssues
                );
            }
            return null;
        }
        // Test that the mainfest has some key elements, like ID and version
        if (!("id" in manifestJson)) {
            // this is a plugin with a manifest json, try to see if there is a beta version
            if (reportIssues)
                ToastMessage(
                    this.plugin,
                    `${repositoryPath}\nThe plugin id attribute for the release is missing from the manifest file`,
                    noticeTimeout
                );
            return null;
        }
        if (!("version" in manifestJson)) {
            // this is a plugin with a manifest json, try to see if there is a beta version
            if (reportIssues)
                ToastMessage(
                    this.plugin,
                    `${repositoryPath}\nThe version attribute for the release is missing from the manifest file`,
                    noticeTimeout
                );
            return null;
        }
        return manifestJson;
    }

    /**
     * Gets all the release files based on the version number in the manifest
     *
     * @param repositoryPath - path to the GitHub repository
     * @param manifest       - manifest file
     * @param getManifest    - grab the remote manifest file
     * @param specifyVersion - grab the specified version if set
     *
     * @returns all relase files as strings based on the ReleaseFiles interaface
     */
    public async getAllReleaseFiles(
        repositoryPath: string,
        manifest: PluginManifest,
        getManifest: boolean,
        specifyVersion = ""
    ): Promise<ReleaseFiles> {
        const version = specifyVersion === "" ? manifest.version : specifyVersion;

        // if we have version specified, we always want to get the remote manifest file.
        const reallyGetManifestOrNot = getManifest || specifyVersion !== "";

        console.log({ reallyGetManifestOrNot, version });

        // prefer a packaged .tar.gz release asset when the release has one
        const tarballFiles = await this.getReleaseTarballFiles(repositoryPath, version);
        if (tarballFiles !== null) return tarballFiles;

        return {
            tarball: null,
            mainJs: await grabReleaseFileFromRepository(
                repositoryPath,
                version,
                "main.js",
                this.plugin.settings.debuggingMode,
                this.plugin.settings.personalAccessToken
            ),
            manifest: reallyGetManifestOrNot
                ? await grabReleaseFileFromRepository(
                      repositoryPath,
                      version,
                      "manifest.json",
                      this.plugin.settings.debuggingMode,
                      this.plugin.settings.personalAccessToken
                  )
                : "",
            styles: await grabReleaseFileFromRepository(
                repositoryPath,
                version,
                "styles.css",
                this.plugin.settings.debuggingMode,
                this.plugin.settings.personalAccessToken
            )
        };
    }

    /**
     * Attempts to download and extract a packaged .tar.gz asset from the
     * release. Returns null if the release has no tarball asset or if the
     * archive does not contain at least main.js and manifest.json, in which
     * case the caller falls back to the classic fixed-file downloads.
     *
     * @param repositoryPath - path to the GitHub repository
     * @param version        - release tag to download
     *
     * @returns release files with the full tarball contents, or null
     */
    public async getReleaseTarballFiles(
        repositoryPath: string,
        version: string
    ): Promise<ReleaseFiles | null> {
        const debugLogging = this.plugin.settings.debuggingMode;
        const tarball = await grabReleaseTarballFromRepository(
            repositoryPath,
            version,
            this.plugin.settings.personalAccessToken
        );
        if (tarball.err) {
            if (debugLogging)
                console.log("BRAT: no usable release tarball", tarball.val.toString(false));
            return null;
        }

        const extracted = await extractTarGz(tarball.safeUnwrap());
        if (extracted.err) {
            if (debugLogging)
                console.log(
                    "BRAT: failed to extract release tarball",
                    extracted.val.toString(false)
                );
            return null;
        }
        const files = extracted.safeUnwrap();

        const mainJs = files.get("main.js");
        const manifest = files.get("manifest.json");
        if (mainJs === undefined || manifest === undefined) {
            if (debugLogging)
                console.log(
                    "BRAT: release tarball is missing main.js or manifest.json, falling back",
                    Array.from(files.keys())
                );
            return null;
        }

        const decoder = new TextDecoder();
        const styles = files.get("styles.css");
        return {
            mainJs: decoder.decode(mainJs),
            manifest: decoder.decode(manifest),
            styles: styles === undefined ? null : decoder.decode(styles),
            tarball: files
        };
    }

    /**
     * Writes the plugin release files to the local obsidian .plugins folder
     *
     * @param betaPluginId - the id of the plugin (not the repository path)
     * @param relFiles     - release file as strings, based on the ReleaseFiles interface
     *
     */
    public async writeReleaseFilesToPluginFolder(
        betaPluginId: string,
        relFiles: ReleaseFiles
    ): Promise<void> {
        if (relFiles.tarball !== null) {
            const swapped = await this.writeTarballFilesToPluginFolder(betaPluginId, relFiles);
            if (swapped) return;
            // staging failed validation - fall back to writing the classic three files
            if (this.plugin.settings.debuggingMode)
                console.log(
                    "BRAT: tarball staging failed, falling back to fixed-file install",
                    betaPluginId
                );
        }
        const pluginTargetFolderPath =
            normalizePath(this.plugin.app.vault.configDir + "/plugins/" + betaPluginId) + "/";
        const { adapter } = this.plugin.app.vault;
        if (
            !(await adapter.exists(pluginTargetFolderPath)) ||
            !(await adapter.exists(pluginTargetFolderPath + "manifest.json"))
        ) {
            // if plugin folder doesnt exist or manifest.json doesn't exist, create it and save the plugin files
            await adapter.mkdir(pluginTargetFolderPath);
        }
        await adapter.write(pluginTargetFolderPath + "main.js", relFiles.mainJs ?? "");
        await adapter.write(pluginTargetFolderPath + "manifest.json", relFiles.manifest ?? "");
        if (relFiles.styles !== null)
            await adapter.write(pluginTargetFolderPath + "styles.css", relFiles.styles);
    }

    /**
     * Primary function for adding a new beta plugin to Obsidian.
     * Also this function is used for updating existing plugins.
     *
     * @param repositoryPath    - path to GitHub repository formated as USERNAME/repository
     * @param updatePluginFiles - true if this is just an update not an install
     * @param seeIfUpdatedOnly  - if true, and updatePluginFiles true, will just check for updates, but not do the update. will report to user that there is a new plugin
     * @param reportIfNotUpdted - if true, report if an update has not succed
     * @param specifyVersion    - if not empty, need to install a specified version instead of the value in manifest-beta.json
     * @param forceReinstall    - if true, will force a reinstall of the plugin, even if it is already installed
     *
     * @returns true if succeeds
     */
    public async addPlugin(
        repositoryPath: string,
        updatePluginFiles = false,
        seeIfUpdatedOnly = false,
        reportIfNotUpdted = false,
        specifyVersion = "",
        forceReinstall = false,
        enableAfterInstall = this.plugin.settings.enableAfterInstall
    ): Promise<boolean> {
        if (this.plugin.settings.debuggingMode)
            console.log(
                "BRAT: addPlugin",
                repositoryPath,
                updatePluginFiles,
                seeIfUpdatedOnly,
                reportIfNotUpdted,
                specifyVersion,
                forceReinstall,
                enableAfterInstall
            );

        const noticeTimeout = 10;
        // attempt to get manifest-beta.json
        let primaryManifest = await this.validateRepository(repositoryPath, true, false);
        const usingBetaManifest = !!primaryManifest;
        // attempt to get manifest.json
        if (!usingBetaManifest)
            primaryManifest = await this.validateRepository(repositoryPath, false, true);

        if (primaryManifest === null) {
            const msg = `${repositoryPath}\nA manifest.json or manifest-beta.json file does not exist in the root directory of the repository. This plugin cannot be installed.`;
            await this.plugin.log(msg, true);
            ToastMessage(this.plugin, msg, noticeTimeout);
            return false;
        }

        if (!Object.hasOwn(primaryManifest, "version")) {
            const msg = `${repositoryPath}\nThe manifest${
                usingBetaManifest ? "-beta" : ""
            }.json file in the root directory of the repository does not have a version number in the file. This plugin cannot be installed.`;
            await this.plugin.log(msg, true);
            ToastMessage(this.plugin, msg, noticeTimeout);
            return false;
        }

        // Check manifest minAppVersion and current version of Obisidan, don't load plugin if not compatible
        if (!Object.hasOwn(primaryManifest, "minAppVersion")) {
            if (!requireApiVersion(primaryManifest.minAppVersion)) {
                const msg =
                    `Plugin: ${repositoryPath}\n\n` +
                    `The manifest${
                        usingBetaManifest ? "-beta" : ""
                    }.json for this plugin indicates that the Obsidian ` +
                    `version of the app needs to be ${primaryManifest.minAppVersion}, ` +
                    `but this installation of Obsidian is ${apiVersion}. \n\nYou will need to update your ` +
                    `Obsidian to use this plugin or contact the plugin developer for more information.`;
                await this.plugin.log(msg, true);
                ToastMessage(this.plugin, msg, 30);
                return false;
            }
        }

        // now the user must be able to access the repo

        interface ErrnoType {
            errno: number;
        }

        const getRelease = async () => {
            const rFiles = await this.getAllReleaseFiles(
                repositoryPath,
                primaryManifest,
                usingBetaManifest,
                specifyVersion
            );

            console.log("rFiles", rFiles);
            // if beta, use that manifest, or if there is no manifest in release, use the primaryManifest
            if (usingBetaManifest || rFiles.manifest === "")
                rFiles.manifest = JSON.stringify(primaryManifest);

            if (this.plugin.settings.debuggingMode)
                console.log("BRAT: rFiles.manifest", usingBetaManifest, rFiles);

            if (rFiles.mainJs === null) {
                const msg = `${repositoryPath}\nThe release is not complete and cannot be download. main.js is missing from the Release`;
                await this.plugin.log(msg, true);
                ToastMessage(this.plugin, msg, noticeTimeout);
                return null;
            }
            return rFiles;
        };

        if (!updatePluginFiles || forceReinstall) {
            const releaseFiles = await getRelease();
            if (releaseFiles === null) return false;
            await this.writeReleaseFilesToPluginFolder(primaryManifest.id, releaseFiles);
            if (!forceReinstall) AddBetaPluginToList(this.plugin, repositoryPath, specifyVersion);
            if (enableAfterInstall) {
                const { plugins } = this.plugin.app;
                const pluginTargetFolderPath = normalizePath(
                    plugins.getPluginFolder() + "/" + primaryManifest.id
                );
                await plugins.loadManifest(pluginTargetFolderPath);
                await plugins.enablePluginAndSave(primaryManifest.id);
            }
            await this.plugin.app.plugins.loadManifests();
            if (forceReinstall) {
                // reload if enabled
                await this.reloadPlugin(primaryManifest.id);
                await this.plugin.log(`${repositoryPath} reinstalled`, true);
                ToastMessage(
                    this.plugin,
                    `${repositoryPath}\nPlugin has been reinstalled and reloaded.`,
                    noticeTimeout
                );
            } else {
                const versionText = specifyVersion === "" ? "" : ` (version: ${specifyVersion})`;
                let msg = `${repositoryPath}${versionText}\nThe plugin has been registered with BRAT.`;
                if (!enableAfterInstall) {
                    msg += " You may still need to enable it the Community Plugin List.";
                }
                await this.plugin.log(msg, true);
                ToastMessage(this.plugin, msg, noticeTimeout);
            }
        } else {
            // test if the plugin needs to be updated
            // if a specified version is provided, then we shall skip the update
            const pluginTargetFolderPath =
                this.plugin.app.vault.configDir + "/plugins/" + primaryManifest.id + "/";
            let localManifestContents = "";
            try {
                localManifestContents = await this.plugin.app.vault.adapter.read(
                    pluginTargetFolderPath + "manifest.json"
                );
            } catch (e) {
                if ((e as ErrnoType).errno === -4058 || (e as ErrnoType).errno === -2) {
                    // file does not exist, try installing the plugin
                    await this.addPlugin(
                        repositoryPath,
                        false,
                        usingBetaManifest,
                        false,
                        specifyVersion
                    );
                    // even though failed, return true since install will be attempted
                    return true;
                } else
                    console.log(
                        "BRAT - Local Manifest Load",
                        primaryManifest.id,
                        JSON.stringify(e, null, 2)
                    );
            }

            if (
                specifyVersion !== "" ||
                this.plugin.settings.pluginSubListFrozenVersion
                    .map((x) => x.repo)
                    .includes(repositoryPath)
            ) {
                // skip the frozen version plugin
                ToastMessage(
                    this.plugin,
                    `The version of ${repositoryPath} is frozen, not updating.`,
                    3
                );
                return false;
            }

            const localManifestJson = (await JSON.parse(localManifestContents)) as PluginManifest;
            if (localManifestJson.version !== primaryManifest.version) {
                // manifest files are not the same, do an update
                const releaseFiles = await getRelease();
                if (releaseFiles === null) return false;

                if (seeIfUpdatedOnly) {
                    // dont update, just report it
                    const msg = `There is an update available for ${primaryManifest.id} from version ${localManifestJson.version} to ${primaryManifest.version}. `;
                    await this.plugin.log(
                        msg +
                            `[Release Info](https://github.com/${repositoryPath}/releases/tag/${primaryManifest.version})`,
                        true
                    );
                    ToastMessage(this.plugin, msg, 30, () => {
                        window.open(
                            `https://github.com/${repositoryPath}/releases/tag/${primaryManifest.version}`
                        );
                    });
                } else {
                    await this.writeReleaseFilesToPluginFolder(primaryManifest.id, releaseFiles);
                    await this.plugin.app.plugins.loadManifests();
                    await this.reloadPlugin(primaryManifest.id);
                    const msg = `${primaryManifest.id}\nPlugin has been updated from version ${localManifestJson.version} to ${primaryManifest.version}. `;
                    await this.plugin.log(
                        msg +
                            `[Release Info](https://github.com/${repositoryPath}/releases/tag/${primaryManifest.version})`,
                        true
                    );
                    ToastMessage(this.plugin, msg, 30, () => {
                        window.open(
                            `https://github.com/${repositoryPath}/releases/tag/${primaryManifest.version}`
                        );
                    });
                }
            } else if (reportIfNotUpdted)
                ToastMessage(this.plugin, `No update available for ${repositoryPath}`, 3);
        }
        return true;
    }

    /**
     * reloads a plugin (assuming it has been enabled by user)
     * pjeby, Thanks Bro https://github.com/pjeby/hot-reload/blob/master/main.js
     *
     * @param pluginName - name of plugin
     *
     */
    public async reloadPlugin(pluginName: string): Promise<void> {
        const { plugins } = this.plugin.app;
        try {
            await plugins.disablePlugin(pluginName);
            await plugins.enablePlugin(pluginName);
        } catch (e) {
            if (this.plugin.settings.debuggingMode) console.log("reload plugin", e);
        }
    }

    /**
     * updates a beta plugin
     *
     * @param repositoryPath - repository path on GitHub
     * @param onlyCheckDontUpdate - only looks for update
     *
     */
    public async updatePlugin(
        repositoryPath: string,
        onlyCheckDontUpdate = false,
        reportIfNotUpdted = false,
        forceReinstall = false
    ): Promise<boolean> {
        const result = await this.addPlugin(
            repositoryPath,
            true,
            onlyCheckDontUpdate,
            reportIfNotUpdted,
            "",
            forceReinstall
        );
        if (!result && !onlyCheckDontUpdate)
            ToastMessage(this.plugin, `${repositoryPath}\nUpdate of plugin failed.`);
        return result;
    }

    /**
     * walks through the list of plugins without frozen version and performs an update
     *
     * @param showInfo - should this with a started/completed message - useful when ran from CP
     *
     */
    public async checkForPluginUpdatesAndInstallUpdates(
        showInfo = false,
        onlyCheckDontUpdate = false
    ): Promise<void> {
        if (!(await IsConnectedToInternet())) {
            console.log("BRAT: No internet detected.");
            return;
        }
        let newNotice: Notice | undefined;
        const msg1 = `Checking for plugin updates STARTED`;
        await this.plugin.log(msg1, true);
        if (showInfo && this.plugin.settings.notificationsEnabled) {
            newNotice = new Notice(`BRAT\n${msg1}`, 30000);
        }

        const pluginSubListFrozenVersionNames = new Set(
            this.plugin.settings.pluginSubListFrozenVersion.map((f) => f.repo)
        );
        for (const bp of this.plugin.settings.pluginList) {
            if (pluginSubListFrozenVersionNames.has(bp)) {
                continue;
            }
            await this.updatePlugin(bp, onlyCheckDontUpdate);
        }
        const msg2 = `Checking for plugin updates COMPLETED`;
        await this.plugin.log(msg2, true);
        if (showInfo) {
            if (newNotice) {
                newNotice.hide();
            }
            ToastMessage(this.plugin, msg2, 10);
        }
    }

    /**
     * Removes the beta plugin from the list of beta plugins (does not delete them from disk)
     *
     * @param betaPluginID - repository path
     *
     */
    public deletePlugin(repositoryPath: string): void {
        const msg = `Removed ${repositoryPath} from BRAT plugin list`;
        void this.plugin.log(msg, true);
        this.plugin.settings.pluginList = this.plugin.settings.pluginList.filter(
            (b) => b !== repositoryPath
        );
        this.plugin.settings.pluginSubListFrozenVersion =
            this.plugin.settings.pluginSubListFrozenVersion.filter(
                (b) => b.repo !== repositoryPath
            );
        void this.plugin.saveSettings();
    }

    /**
     * Returns a list of plugins that are currently enabled or currently disabled
     *
     * @param enabled - true for enabled plugins, false for disabled plutings
     *
     * @returns manifests  of plugins
     */
    public getEnabledDisabledPlugins(enabled: boolean): PluginManifest[] {
        const pl = this.plugin.app.plugins;
        const manifests = Object.values(pl.manifests) as PluginManifest[];
        const enabledPlugins: PluginManifest[] = Object.values(pl.plugins)
            .filter((p) => p !== undefined)
            .map((p) => p.manifest);
        return enabled
            ? manifests.filter((manifest) =>
                  enabledPlugins.find((pluginName) => manifest.id === pluginName.id)
              )
            : manifests.filter(
                  (manifest) => !enabledPlugins.find((pluginName) => manifest.id === pluginName.id)
              );
    }

    /**
     * Writes a packaged tarball release into the plugin folder. The extracted
     * files are first staged into a temp folder and validated (main.js and
     * manifest.json must exist) before the existing plugin files are removed
     * and replaced. data.json is preserved so user settings survive the swap.
     *
     * @param betaPluginId - the id of the plugin (not the repository path)
     * @param relFiles     - release files including the extracted tarball map
     *
     * @returns true if the staged files were validated and swapped in
     */
    private async writeTarballFilesToPluginFolder(
        betaPluginId: string,
        relFiles: ReleaseFiles
    ): Promise<boolean> {
        if (relFiles.tarball === null) return false;
        const configDir = this.plugin.app.vault.configDir;
        const stagingFolderPath = normalizePath(`${configDir}/brat-staging/${betaPluginId}`);

        const swapResult = await this.stageValidateAndSwapTarball(
            betaPluginId,
            stagingFolderPath,
            relFiles.tarball,
            relFiles.manifest ?? ""
        );
        // always clean up the staging folder, even when the swap failed
        await this.removeFolderIfExists(stagingFolderPath);
        if (swapResult.err) {
            if (this.plugin.settings.debuggingMode)
                console.log(
                    "BRAT: tarball install failed",
                    betaPluginId,
                    swapResult.val.toString(false)
                );
            return false;
        }
        return true;
    }

    /**
     * Stages the extracted tarball files into the staging folder, validates
     * that main.js and manifest.json exist, then removes the existing plugin
     * files and copies the staged files into place. data.json is preserved so
     * user settings survive the swap. The caller cleans up the staging folder.
     */
    private async stageValidateAndSwapTarball(
        betaPluginId: string,
        stagingFolderPath: string,
        tarballFiles: Map<string, Uint8Array>,
        manifestContents: string
    ): Promise<StatusResult<StatusError>> {
        const { adapter } = this.plugin.app.vault;
        const pluginTargetFolderPath = normalizePath(
            `${this.plugin.app.vault.configDir}/plugins/${betaPluginId}`
        );

        // stage the extracted files into a clean temp folder
        const cleared = await this.removeFolderIfExists(stagingFolderPath);
        if (cleared.err) return cleared;
        for (const [name, content] of tarballFiles) {
            const filePath = normalizePath(`${stagingFolderPath}/${name}`);
            const folderReady = await this.ensureFolderExists(
                filePath.slice(0, filePath.lastIndexOf("/"))
            );
            if (folderReady.err) return folderReady;
            const written = await WrapPromise(
                adapter.writeBinary(filePath, content.buffer as ArrayBuffer),
                `BRAT: failed to stage ${name}`
            );
            if (written.err) return written;
        }
        // the caller may have replaced the manifest with the beta manifest,
        // so the staged manifest.json is written from the release files
        const manifestWritten = await WrapPromise(
            adapter.write(normalizePath(`${stagingFolderPath}/manifest.json`), manifestContents),
            "BRAT: failed to stage manifest.json"
        );
        if (manifestWritten.err) return manifestWritten;

        // validate the staged release before touching the plugin folder
        for (const requiredFile of ["main.js", "manifest.json"]) {
            const exists = await WrapPromise(
                adapter.exists(normalizePath(`${stagingFolderPath}/${requiredFile}`)),
                `BRAT: failed to check staged ${requiredFile}`
            );
            if (exists.err) return exists;
            if (!exists.safeUnwrap()) {
                return Err(
                    FailedPreconditionError(
                        `BRAT: staged tarball is missing ${requiredFile} for ${betaPluginId}`
                    )
                );
            }
        }

        // remove the existing plugin files, keeping data.json (user settings)
        const targetExists = await WrapPromise(
            adapter.exists(pluginTargetFolderPath),
            "BRAT: failed to check plugin folder"
        );
        if (targetExists.err) return targetExists;
        if (targetExists.safeUnwrap()) {
            const listing = await WrapPromise(
                adapter.list(pluginTargetFolderPath),
                "BRAT: failed to list plugin folder"
            );
            if (listing.err) return listing;
            for (const file of listing.safeUnwrap().files) {
                if (file.endsWith("/data.json")) continue;
                const removed = await WrapPromise(
                    adapter.remove(file),
                    `BRAT: failed to remove ${file}`
                );
                if (removed.err) return removed;
            }
            for (const folder of listing.safeUnwrap().folders) {
                const removed = await WrapPromise(
                    adapter.rmdir(folder, true),
                    `BRAT: failed to remove folder ${folder}`
                );
                if (removed.err) return removed;
            }
        } else {
            const created = await this.ensureFolderExists(pluginTargetFolderPath);
            if (created.err) return created;
        }

        // copy the validated files into place
        for (const name of tarballFiles.keys()) {
            const targetPath = normalizePath(`${pluginTargetFolderPath}/${name}`);
            const folderReady = await this.ensureFolderExists(
                targetPath.slice(0, targetPath.lastIndexOf("/"))
            );
            if (folderReady.err) return folderReady;
            const copied = await WrapPromise(
                adapter.copy(normalizePath(`${stagingFolderPath}/${name}`), targetPath),
                `BRAT: failed to copy ${name} into plugin folder`
            );
            if (copied.err) return copied;
        }
        return Ok();
    }

    /**
     * Creates the folder and any missing parent folders.
     */
    private async ensureFolderExists(folderPath: string): Promise<StatusResult<StatusError>> {
        const { adapter } = this.plugin.app.vault;
        const parts = folderPath.split("/");
        let current = "";
        for (const part of parts) {
            current = current === "" ? part : `${current}/${part}`;
            const exists = await WrapPromise(
                adapter.exists(current),
                `BRAT: failed to check folder ${current}`
            );
            if (exists.err) return exists;
            if (!exists.safeUnwrap()) {
                const made = await WrapPromise(
                    adapter.mkdir(current),
                    `BRAT: failed to create folder ${current}`
                );
                if (made.err) return made;
            }
        }
        return Ok();
    }

    /**
     * Recursively removes the folder if it exists.
     */
    private async removeFolderIfExists(folderPath: string): Promise<StatusResult<StatusError>> {
        const { adapter } = this.plugin.app.vault;
        const exists = await WrapPromise(
            adapter.exists(folderPath),
            `BRAT: failed to check folder ${folderPath}`
        );
        if (exists.err) return exists;
        if (exists.safeUnwrap()) {
            const removed = await WrapPromise(
                adapter.rmdir(folderPath, true),
                `BRAT: failed to remove folder ${folderPath}`
            );
            if (removed.err) return removed;
        }
        return Ok();
    }
}
