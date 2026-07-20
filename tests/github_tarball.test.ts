/* eslint-disable @typescript-eslint/naming-convention -- tag_name mirrors the GitHub API */
/* eslint-disable camelcase */
import type { jest } from "@jest/globals";
import { describe, expect, test } from "@jest/globals";
import { request, requestUrl } from "obsidian";
import { grabReleaseTarballFromRepository } from "../src/features/githubUtils";

// the obsidian module is mapped to tests/__mocks__/obsidian.ts where these are jest.fn()
const requestMock = request as unknown as ReturnType<typeof jest.fn>;
const requestUrlMock = requestUrl as unknown as ReturnType<typeof jest.fn>;

const RELEASES = JSON.stringify([
    {
        url: "https://api.github.com/repos/user/repo/releases/1",
        tag_name: "1.0.0",
        assets: [
            { name: "main.js", url: "https://api.github.com/assets/1" },
            { name: "plugin-package.tar.gz", url: "https://api.github.com/assets/2" }
        ]
    },
    {
        url: "https://api.github.com/repos/user/repo/releases/2",
        tag_name: "0.9.0",
        assets: []
    }
]);

describe("grabReleaseTarballFromRepository", () => {
    test("downloads the .tar.gz asset of the matching release", async () => {
        requestMock.mockImplementation(() => Promise.resolve(RELEASES));
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        requestUrlMock.mockImplementation(() =>
            Promise.resolve({ status: 200, arrayBuffer: bytes })
        );

        const result = await grabReleaseTarballFromRepository("user/repo", "1.0.0");
        expect(result.ok).toBe(true);
        expect(new Uint8Array(result.unsafeUnwrap())).toEqual(new Uint8Array([1, 2, 3]));

        const downloadArgs = requestUrlMock.mock.calls[0]![0] as {
            url: string;
            headers: Record<string, string>;
        };
        expect(downloadArgs.url).toBe("https://api.github.com/assets/2");
        // eslint-disable-next-line @typescript-eslint/dot-notation
        expect(downloadArgs.headers["Accept"]).toBe("application/octet-stream");
    });

    test("sends the personal access token when provided", async () => {
        requestMock.mockImplementation(() => Promise.resolve(RELEASES));
        requestUrlMock.mockImplementation(() =>
            Promise.resolve({ status: 200, arrayBuffer: new ArrayBuffer(0) })
        );

        await grabReleaseTarballFromRepository("user/repo", "1.0.0", "token123");
        const listArgs = requestMock.mock.calls[0]![0] as { headers: Record<string, string> };
        const downloadArgs = requestUrlMock.mock.calls[0]![0] as {
            headers: Record<string, string>;
        };
        // eslint-disable-next-line @typescript-eslint/dot-notation
        expect(listArgs.headers["Authorization"]).toBe("Token token123");
        // eslint-disable-next-line @typescript-eslint/dot-notation
        expect(downloadArgs.headers["Authorization"]).toBe("Token token123");
    });

    test("returns Err when the tag has no release", async () => {
        requestMock.mockImplementation(() => Promise.resolve(RELEASES));
        const result = await grabReleaseTarballFromRepository("user/repo", "9.9.9");
        expect(result.err).toBe(true);
    });

    test("returns Err when the release has no .tar.gz asset", async () => {
        requestMock.mockImplementation(() => Promise.resolve(RELEASES));
        const result = await grabReleaseTarballFromRepository("user/repo", "0.9.0");
        expect(result.err).toBe(true);
    });

    test("returns Err when the releases request fails", async () => {
        requestMock.mockImplementation(() => Promise.reject(new Error("network down")));
        const result = await grabReleaseTarballFromRepository("user/repo", "1.0.0");
        expect(result.err).toBe(true);
    });

    test("returns Err when the releases response is not JSON", async () => {
        requestMock.mockImplementation(() => Promise.resolve("<!doctype html>"));
        const result = await grabReleaseTarballFromRepository("user/repo", "1.0.0");
        expect(result.err).toBe(true);
    });

    test("returns Err when the asset download fails", async () => {
        requestMock.mockImplementation(() => Promise.resolve(RELEASES));
        requestUrlMock.mockImplementation(() => Promise.reject(new Error("404")));
        const result = await grabReleaseTarballFromRepository("user/repo", "1.0.0");
        expect(result.err).toBe(true);
    });
});
