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
    },
    {
        name: "(Work) Person Image Renderer",
        repo: "parrajustin/obsidian-person-image",
        localName: "obsidian-person-image",
        desc: "Adds a preview of a person base64 url encoded image in note prop: 'Profile Picture'."
    },
    {
        name: "Advanced Command URI",
        repo: "parrajustin/obsidian-advanced-uri",
        localName: "obsidian-advanced-uri",
        desc: "Control obsidian through command uris."
    },
    {
        name: "Ledger",
        repo: "parrajustin/obsidian-finance",
        localName: "ledger-obsidian",
        desc: "Plain text accounting."
    }
];
export const FIXED_PLUGIN_REPOS = new Set(FIXED_PLUGINS.map((x) => x.repo));
