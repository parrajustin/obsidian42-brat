import { describe, expect, test } from "@jest/globals";
import { gzipSync } from "zlib";
import { extractTarGz, gunzip, untar } from "../src/utils/tarball";

const BLOCK_SIZE = 512;

interface TarFileSpec {
    name: string;
    content: string;
    typeflag?: string;
}

/** builds a minimal ustar formatted archive for testing */
const buildTar = (files: TarFileSpec[]): Uint8Array => {
    const encoder = new TextEncoder();
    const blocks: Uint8Array[] = [];
    for (const file of files) {
        const data = encoder.encode(file.content);
        const header = new Uint8Array(BLOCK_SIZE);
        header.set(encoder.encode(file.name), 0);
        header.set(encoder.encode("0000644\0"), 100); // mode
        header.set(encoder.encode("0000000\0"), 108); // uid
        header.set(encoder.encode("0000000\0"), 116); // gid
        header.set(encoder.encode(`${data.length.toString(8).padStart(11, "0")}\0`), 124);
        header.set(encoder.encode("00000000000\0"), 136); // mtime
        header.set(encoder.encode("        "), 148); // checksum placeholder
        header[156] = (file.typeflag ?? "0").charCodeAt(0);
        header.set(encoder.encode("ustar\0"), 257);
        header.set(encoder.encode("00"), 263);
        let checksum = 0;
        for (const byte of header) checksum += byte;
        header.set(encoder.encode(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);
        blocks.push(header);
        const dataBlocks = new Uint8Array(Math.ceil(data.length / BLOCK_SIZE) * BLOCK_SIZE);
        dataBlocks.set(data);
        blocks.push(dataBlocks);
    }
    blocks.push(new Uint8Array(BLOCK_SIZE * 2)); // end of archive marker
    const total = blocks.reduce((sum, b) => sum + b.length, 0);
    const archive = new Uint8Array(total);
    let offset = 0;
    for (const block of blocks) {
        archive.set(block, offset);
        offset += block.length;
    }
    return archive;
};

const toTarGz = (files: TarFileSpec[]): ArrayBuffer => {
    const gzipped = gzipSync(buildTar(files));
    return gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength);
};

describe("gunzip", () => {
    test("returns Err for data that is not gzip", async () => {
        const result = await gunzip(new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer);
        expect(result.err).toBe(true);
    });

    test("round-trips gzipped data", async () => {
        const original = new TextEncoder().encode("hello world");
        const gzipped = gzipSync(original);
        const result = await gunzip(
            gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength)
        );
        expect(result.ok).toBe(true);
        expect(new TextDecoder().decode(result.unsafeUnwrap())).toBe("hello world");
    });
});

describe("untar", () => {
    test("parses regular files", () => {
        const result = untar(
            buildTar([
                { name: "main.js", content: "console.log('hi');" },
                { name: "manifest.json", content: `{"id":"test"}` }
            ])
        );
        expect(result.ok).toBe(true);
        const entries = result.unsafeUnwrap();
        expect(entries.map((e) => e.name)).toEqual(["main.js", "manifest.json"]);
        expect(new TextDecoder().decode(entries[0]!.data)).toBe("console.log('hi');");
    });

    test("supports GNU long names", () => {
        const longName = `${"very-long-directory-name/".repeat(6)}main.js`;
        const result = untar(
            buildTar([
                { name: "././@LongLink", content: longName, typeflag: "L" },
                { name: "truncated-name", content: "js" }
            ])
        );
        expect(result.ok).toBe(true);
        const entries = result.unsafeUnwrap();
        expect(entries.map((e) => e.name)).toEqual([longName]);
    });

    test("supports pax path records", () => {
        const result = untar(
            buildTar([
                {
                    name: "PaxHeader/override.js",
                    content: "23 path=pax/override.js\n",
                    typeflag: "x"
                },
                { name: "override.js", content: "js" }
            ])
        );
        expect(result.ok).toBe(true);
        expect(result.unsafeUnwrap().map((e) => e.name)).toEqual(["pax/override.js"]);
    });

    test("skips directory entries", () => {
        const result = untar(
            buildTar([
                { name: "folder/", content: "", typeflag: "5" },
                { name: "folder/main.js", content: "js" }
            ])
        );
        expect(result.ok).toBe(true);
        expect(result.unsafeUnwrap().map((e) => e.name)).toEqual(["folder/main.js"]);
    });
});

describe("extractTarGz", () => {
    test("returns Err for corrupt archives", async () => {
        const result = await extractTarGz(new Uint8Array([9, 9, 9, 9, 9]).buffer as ArrayBuffer);
        expect(result.err).toBe(true);
    });

    test("extracts a flat archive", async () => {
        const result = await extractTarGz(
            toTarGz([
                { name: "main.js", content: "js" },
                { name: "manifest.json", content: "{}" },
                { name: "styles.css", content: "css" }
            ])
        );
        expect(result.ok).toBe(true);
        const files = result.unsafeUnwrap();
        expect(Array.from(files.keys()).sort()).toEqual(["main.js", "manifest.json", "styles.css"]);
        expect(new TextDecoder().decode(files.get("styles.css"))).toBe("css");
    });

    test("strips a single top-level directory", async () => {
        const result = await extractTarGz(
            toTarGz([
                { name: "my-plugin/main.js", content: "js" },
                { name: "my-plugin/manifest.json", content: "{}" },
                { name: "my-plugin/assets/logo.svg", content: "<svg/>" }
            ])
        );
        expect(result.ok).toBe(true);
        const files = result.unsafeUnwrap();
        expect(files.has("main.js")).toBe(true);
        expect(files.has("manifest.json")).toBe(true);
        expect(files.has("assets/logo.svg")).toBe(true);
    });

    test("drops unsafe entry names", async () => {
        const result = await extractTarGz(
            toTarGz([
                { name: "main.js", content: "js" },
                { name: "../escape.js", content: "bad" },
                { name: "/absolute.js", content: "bad" }
            ])
        );
        expect(result.ok).toBe(true);
        expect(Array.from(result.unsafeUnwrap().keys())).toEqual(["main.js"]);
    });

    test("keeps paths intact when files are already at the root", async () => {
        const result = await extractTarGz(
            toTarGz([
                { name: "main.js", content: "js" },
                { name: "lib/helper.js", content: "helper" }
            ])
        );
        expect(result.ok).toBe(true);
        const files = result.unsafeUnwrap();
        expect(files.has("main.js")).toBe(true);
        expect(files.has("lib/helper.js")).toBe(true);
    });
});
