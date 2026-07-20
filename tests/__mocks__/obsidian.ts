/**
 * Minimal runtime mock of the obsidian module for jest. Only the values used
 * by the modules under test are provided. Type checking of tests still uses
 * the real obsidian type declarations.
 */
import { jest } from "@jest/globals";

export const apiVersion = "1.5.0";

export const normalizePath = (path: string): string =>
    path
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\/|\/$/g, "");

export const requireApiVersion = (): boolean => true;

export const request = jest.fn();
export const requestUrl = jest.fn();

export class Notice {
    public noticeEl: { onclick: (() => void) | null } = { onclick: null };

    constructor(
        public message?: string,
        public timeout?: number
    ) {}

    public hide(): void {
        // no-op for tests
    }
}

export class Modal {
    public contentEl: unknown = null;

    constructor(public app: unknown) {}

    public open(): void {
        // no-op for tests
    }

    public close(): void {
        // no-op for tests
    }
}

export class Setting {
    constructor(public containerEl: unknown) {}

    public addText(): this {
        return this;
    }

    public addToggle(): this {
        return this;
    }

    public addButton(): this {
        return this;
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors the obsidian API
export const Platform = {
    isDesktop: true,
    isDesktopApp: true,
    isMobile: false,
    isMobileApp: false
};
