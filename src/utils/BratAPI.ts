import type ThePlugin from "../main";

// This module is for API access for use in debuging console

export default class BratAPI {
    plugin: ThePlugin;

    constructor(plugin: ThePlugin) {
        this.plugin = plugin;
    }

    console = (logDescription: string, ...outputs: (string | number | boolean)[]): void => {
        console.log("BRAT: " + logDescription, ...outputs);
    };
}
