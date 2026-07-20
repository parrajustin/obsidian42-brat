/* eslint-disable @typescript-eslint/require-await -- the in-memory fake implements an async interface */
import { beforeEach, describe, expect, test } from "@jest/globals";
import BetaPlugins from "../src/features/BetaPlugins";
import { DEFAULT_SETTINGS } from "../src/settings";
import type ThePlugin from "../src/main";

/**
 * In-memory stand-in for Obsidian's DataAdapter, covering the subset of the
 * API used by the tarball install path.
 */
class FakeAdapter {
    public files = new Map<string, string | Uint8Array>();
    public folders = new Set<string>();

    public async exists(path: string): Promise<boolean> {
        if (this.files.has(path) || this.folders.has(path)) return true;
        const prefix = `${path}/`;
        for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
        for (const key of this.folders) if (key.startsWith(prefix)) return true;
        return false;
    }

    public async mkdir(path: string): Promise<void> {
        this.folders.add(path);
    }

    public async write(path: string, data: string): Promise<void> {
        this.files.set(path, data);
    }

    public async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
        this.files.set(path, new Uint8Array(data));
    }

    public async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return typeof value === "string" ? value : new TextDecoder().decode(value);
    }

    public async remove(path: string): Promise<void> {
        this.files.delete(path);
    }

    public async rmdir(path: string, recursive: boolean): Promise<void> {
        this.folders.delete(path);
        if (!recursive) return;
        const prefix = `${path}/`;
        for (const key of Array.from(this.files.keys()))
            if (key.startsWith(prefix)) this.files.delete(key);
        for (const key of Array.from(this.folders))
            if (key.startsWith(prefix)) this.folders.delete(key);
    }

    public async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = `${path}/`;
        const files: string[] = [];
        const folderSet = new Set<string>();
        for (const key of this.files.keys()) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf("/");
            if (slash === -1) files.push(key);
            else folderSet.add(prefix + rest.slice(0, slash));
        }
        for (const key of this.folders) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf("/");
            folderSet.add(prefix + (slash === -1 ? rest : rest.slice(0, slash)));
        }
        return { files, folders: Array.from(folderSet) };
    }

    public async copy(source: string, destination: string): Promise<void> {
        const value = this.files.get(source);
        if (value === undefined) throw new Error(`ENOENT: ${source}`);
        this.files.set(destination, value);
    }

    /** helper for assertions: file contents as a string */
    public text(path: string): string | undefined {
        const value = this.files.get(path);
        if (value === undefined) return undefined;
        return typeof value === "string" ? value : new TextDecoder().decode(value);
    }
}

const makePlugin = (adapter: FakeAdapter): ThePlugin =>
    ({
        app: { vault: { configDir: ".obsidian", adapter } },
        settings: { ...DEFAULT_SETTINGS },
        log: async (): Promise<void> => {
            // no-op for tests
        }
    }) as unknown as ThePlugin;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const PLUGIN_DIR = ".obsidian/plugins/test-plugin";

describe("writeReleaseFilesToPluginFolder with a tarball", () => {
    let adapter: FakeAdapter;
    let betaPlugins: BetaPlugins;

    beforeEach(() => {
        adapter = new FakeAdapter();
        betaPlugins = new BetaPlugins(makePlugin(adapter));
        // an existing install with user settings and stale files
        adapter.files.set(`${PLUGIN_DIR}/main.js`, "old main");
        adapter.files.set(`${PLUGIN_DIR}/manifest.json`, "old manifest");
        adapter.files.set(`${PLUGIN_DIR}/data.json`, "user settings");
        adapter.files.set(`${PLUGIN_DIR}/stale.txt`, "stale");
        adapter.files.set(`${PLUGIN_DIR}/sub/nested.js`, "nested");
    });

    test("replaces the plugin folder with the tarball contents", async () => {
        const manifest = `{"id":"test-plugin","version":"2.0.0"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "new main",
            manifest,
            styles: "new styles",
            tarball: new Map([
                ["main.js", encode("new main")],
                ["manifest.json", encode(manifest)],
                ["styles.css", encode("new styles")],
                ["assets/logo.svg", encode("<svg/>")]
            ])
        });

        expect(adapter.text(`${PLUGIN_DIR}/main.js`)).toBe("new main");
        expect(adapter.text(`${PLUGIN_DIR}/manifest.json`)).toBe(manifest);
        expect(adapter.text(`${PLUGIN_DIR}/styles.css`)).toBe("new styles");
        expect(adapter.text(`${PLUGIN_DIR}/assets/logo.svg`)).toBe("<svg/>");
    });

    test("preserves data.json and removes stale files and folders", async () => {
        const manifest = `{"id":"test-plugin","version":"2.0.0"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "new main",
            manifest,
            styles: null,
            tarball: new Map([
                ["main.js", encode("new main")],
                ["manifest.json", encode(manifest)]
            ])
        });

        expect(adapter.text(`${PLUGIN_DIR}/data.json`)).toBe("user settings");
        expect(adapter.files.has(`${PLUGIN_DIR}/stale.txt`)).toBe(false);
        expect(adapter.files.has(`${PLUGIN_DIR}/sub/nested.js`)).toBe(false);
    });

    test("uses the manifest provided by the caller over the packaged one", async () => {
        const betaManifest = `{"id":"test-plugin","version":"3.0.0-beta"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "new main",
            manifest: betaManifest,
            styles: null,
            tarball: new Map([
                ["main.js", encode("new main")],
                ["manifest.json", encode(`{"id":"test-plugin","version":"2.0.0"}`)]
            ])
        });

        expect(adapter.text(`${PLUGIN_DIR}/manifest.json`)).toBe(betaManifest);
    });

    test("cleans up the staging folder", async () => {
        const manifest = `{"id":"test-plugin","version":"2.0.0"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "new main",
            manifest,
            styles: null,
            tarball: new Map([
                ["main.js", encode("new main")],
                ["manifest.json", encode(manifest)]
            ])
        });

        const staged = Array.from(adapter.files.keys()).filter((key) =>
            key.startsWith(".obsidian/brat-staging")
        );
        expect(staged).toEqual([]);
        expect(adapter.folders.has(".obsidian/brat-staging/test-plugin")).toBe(false);
    });

    test("installs into a plugin folder that does not exist yet", async () => {
        const manifest = `{"id":"fresh-plugin","version":"1.0.0"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("fresh-plugin", {
            mainJs: "main",
            manifest,
            styles: null,
            tarball: new Map([
                ["main.js", encode("main")],
                ["manifest.json", encode(manifest)]
            ])
        });

        expect(adapter.text(".obsidian/plugins/fresh-plugin/main.js")).toBe("main");
        expect(adapter.text(".obsidian/plugins/fresh-plugin/manifest.json")).toBe(manifest);
    });

    test("falls back to fixed-file install when the tarball is missing main.js", async () => {
        const manifest = `{"id":"test-plugin","version":"2.0.0"}`;
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "fallback main",
            manifest,
            styles: null,
            // safety net: a tarball map without main.js fails staged validation
            tarball: new Map([["manifest.json", encode(manifest)]])
        });

        // the classic path wrote the fixed files and the swap never happened
        expect(adapter.text(`${PLUGIN_DIR}/main.js`)).toBe("fallback main");
        expect(adapter.text(`${PLUGIN_DIR}/manifest.json`)).toBe(manifest);
        expect(adapter.text(`${PLUGIN_DIR}/stale.txt`)).toBe("stale");
        const staged = Array.from(adapter.files.keys()).filter((key) =>
            key.startsWith(".obsidian/brat-staging")
        );
        expect(staged).toEqual([]);
    });

    test("writes only the fixed files when there is no tarball", async () => {
        await betaPlugins.writeReleaseFilesToPluginFolder("test-plugin", {
            mainJs: "classic main",
            manifest: "classic manifest",
            styles: "classic styles",
            tarball: null
        });

        expect(adapter.text(`${PLUGIN_DIR}/main.js`)).toBe("classic main");
        expect(adapter.text(`${PLUGIN_DIR}/manifest.json`)).toBe("classic manifest");
        expect(adapter.text(`${PLUGIN_DIR}/styles.css`)).toBe("classic styles");
        // the classic path does not delete anything
        expect(adapter.text(`${PLUGIN_DIR}/stale.txt`)).toBe("stale");
    });
});
