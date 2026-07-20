/**
 * Minimal tar.gz extraction support. Runs on both desktop and mobile, so it
 * uses the web-native DecompressionStream instead of node's zlib and a small
 * hand-rolled tar parser instead of node-only libraries.
 *
 * All fallible operations return Result types instead of throwing, per the
 * standard-ts-lib conventions.
 */
import type { Result } from "standard-ts-lib/src/result";
import { Ok } from "standard-ts-lib/src/result";
import type { StatusError } from "standard-ts-lib/src/status_error";
import { WrapPromise } from "standard-ts-lib/src/wrap_promise";
import { WrapToResult } from "standard-ts-lib/src/wrap_to_result";

export interface TarEntry {
    name: string;
    data: Uint8Array;
}

/**
 * Decompresses a gzip stream using the browser/electron native DecompressionStream
 */
export const gunzip = (data: ArrayBuffer): Promise<Result<Uint8Array, StatusError>> =>
    WrapPromise(
        (async () => {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
            const buffer = await new Response(stream).arrayBuffer();
            return new Uint8Array(buffer);
        })(),
        "tarball.gunzip: failed to decompress gzip data"
    );

const BLOCK_SIZE = 512;

const readString = (block: Uint8Array, offset: number, length: number): string => {
    let end = offset;
    const max = offset + length;
    while (end < max && block[end] !== 0) end++;
    return new TextDecoder().decode(block.subarray(offset, end));
};

const readOctal = (block: Uint8Array, offset: number, length: number): number => {
    const str = readString(block, offset, length).trim();
    return str === "" ? 0 : parseInt(str, 8);
};

/**
 * Parses an uncompressed tar archive. Supports ustar name+prefix, GNU long
 * names (typeflag L) and pax extended headers (typeflag x) with a path record.
 */
export const untar = (data: Uint8Array): Result<TarEntry[], StatusError> =>
    WrapToResult(() => {
        const entries: TarEntry[] = [];
        let offset = 0;
        let overrideName: string | null = null;

        while (offset + BLOCK_SIZE <= data.length) {
            const block = data.subarray(offset, offset + BLOCK_SIZE);
            // two consecutive zero blocks mark the end of the archive; a single
            // zeroed name field is enough to stop parsing
            if (block.every((byte) => byte === 0)) break;

            const size = readOctal(block, 124, 12);
            const typeflag = String.fromCharCode(block[156] ?? 0);
            const dataBlocks = Math.ceil(size / BLOCK_SIZE);
            const fileData = data.subarray(offset + BLOCK_SIZE, offset + BLOCK_SIZE + size);

            let name = readString(block, 0, 100);
            const prefix = readString(block, 345, 155);
            if (prefix !== "") name = `${prefix}/${name}`;
            if (overrideName !== null) {
                name = overrideName;
                overrideName = null;
            }

            if (typeflag === "L") {
                // GNU long name: data block holds the real name of the next entry
                overrideName = new TextDecoder().decode(fileData).replace(/\0+$/, "");
            } else if (typeflag === "x" || typeflag === "g") {
                // pax extended header: look for a "path=" record for the next entry
                const pax = new TextDecoder().decode(fileData);
                for (const line of pax.split("\n")) {
                    const paxPath = /^\d+ path=(.*)$/.exec(line)?.[1];
                    if (paxPath !== undefined && paxPath !== "" && typeflag === "x")
                        overrideName = paxPath;
                }
            } else if (typeflag === "0" || typeflag === "\0" || typeflag === "") {
                // regular file
                entries.push({ name, data: fileData.slice() });
            }
            // directories (5), links (1,2) and other types are skipped

            offset += BLOCK_SIZE + dataBlocks * BLOCK_SIZE;
        }
        return entries;
    }, "tarball.untar: failed to parse tar archive");

/**
 * Normalizes an entry name: strips a leading "./" and rejects unsafe paths
 * (absolute or containing "..") by returning null.
 */
const sanitizeEntryName = (name: string): string | null => {
    let clean = name.replace(/\\/g, "/");
    while (clean.startsWith("./")) clean = clean.slice(2);
    if (clean === "" || clean.startsWith("/") || clean.includes("..")) return null;
    return clean;
};

/**
 * Builds the file map from tar entries, dropping unsafe paths. If the archive
 * nests everything inside a single top-level directory (a common packaging
 * layout), that directory is stripped so main.js and manifest.json end up at
 * the root of the map.
 */
const buildFileMap = (entries: TarEntry[]): Map<string, Uint8Array> => {
    let files = new Map<string, Uint8Array>();
    for (const entry of entries) {
        const name = sanitizeEntryName(entry.name);
        if (name !== null) files.set(name, entry.data);
    }

    if (!files.has("main.js")) {
        const topDirs = new Set<string>();
        for (const name of files.keys()) {
            const slash = name.indexOf("/");
            topDirs.add(slash === -1 ? "" : name.slice(0, slash));
        }
        if (topDirs.size === 1 && !topDirs.has("")) {
            const stripped = new Map<string, Uint8Array>();
            for (const [name, content] of files) {
                stripped.set(name.slice(name.indexOf("/") + 1), content);
            }
            files = stripped;
        }
    }
    return files;
};

/**
 * Extracts a .tar.gz archive into a map of file path -> contents.
 */
export const extractTarGz = async (
    data: ArrayBuffer
): Promise<Result<Map<string, Uint8Array>, StatusError>> => {
    const gunzipped = await gunzip(data);
    if (gunzipped.err) return gunzipped;
    const entries = untar(gunzipped.safeUnwrap());
    if (entries.err) return entries;
    return Ok(buildFileMap(entries.safeUnwrap()));
};
