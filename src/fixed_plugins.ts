export interface FixedPlugins {
    name: string;
    repo: string;
    localName: string;
    desc: string;
}

export const FIXED_PLUGINS: FixedPlugins[] = [
    {
        name: "Firebase Syncing",
        repo: "parrajustin/obsidian-drive-sync",
        localName: "obsidian-firebase-sync",
        desc: "Adds syncing of obsidian files through firebase."
    },
    {
        name: "Plugin Updater",
        repo: "parrajustin/obsidian42-brat",
        localName: "obsidian42-brat",
        desc: "Adds a util to do auto updating of plugins."
    }
];
export const FIXED_PLUGIN_REPOS = new Set(FIXED_PLUGINS.map((x) => x.repo));
