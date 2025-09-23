import type ThePlugin from "../main";
import { Notice, Platform } from "obsidian";

/**
 * Displays a notice to the user
 *
 * @param plugin              - Plugin object
 * @param msg                 - Text to display to the user
 * @param timeoutInSeconds    - Number of seconds to show the Toast message
 * @param contextMenuCallback - function to call if right mouse clicked
 */
export function ToastMessage(
    plugin: ThePlugin,
    msg: string,
    timeoutInSeconds = 10,
    contextMenuCallback?: () => void
): void {
    if (!plugin.settings.notificationsEnabled) return;
    let additionalInfo = "";
    if (contextMenuCallback !== undefined && Platform.isDesktop) {
        additionalInfo = "(click=dismiss, right-click=Info)";
    } else if (contextMenuCallback !== undefined) {
        additionalInfo = "(click=dismiss)";
    }
    const newNotice: Notice = new Notice(
        `BRAT\n${msg}\n${additionalInfo}`,
        timeoutInSeconds * 1000
    );
    if (contextMenuCallback)
        newNotice.messageEl.oncontextmenu = () => {
            contextMenuCallback();
        };
}
