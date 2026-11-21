// Kettu can load the plugin twice; only the newest copy may keep sendMessage patched, or every
// message is changed (and its rule actions saved) once per copy.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = (await readFile(join(here, "..", "src", "index.js"), "utf8")).replace(/^export .*$/gm, "");

const activePatches = new Set();
const MessageActions = { sendMessage() {} };
globalThis.fetch = () => Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}) });
globalThis.vendetta = {
    metro: {
        findByProps: (...names) => {
            if (names.includes("getCurrentUser")) return { getCurrentUser: () => ({ id: "1" }), getUser: () => null };
            if (names.includes("sendMessage")) return MessageActions;
            return null;
        },
        common: {}
    },
    patcher: {
        before: () => {
            const patch = {};
            activePatches.add(patch);
            return () => activePatches.delete(patch);
        }
    }
};
const loadCopy = () => new Function(`${source}\nreturn plugin;`)();

const first = loadCopy();
const second = loadCopy();
const quietLog = console.log;
console.log = () => {};
try {
    await first.onLoad();
    assert.equal(activePatches.size, 1, "the first copy patches sendMessage");
    await second.onLoad();
    assert.equal(activePatches.size, 1, "loading a second copy stops the first");

    // A copy replaced while it was still starting must not patch once it is ready.
    const third = loadCopy();
    const starting = third.onLoad();
    const fourth = loadCopy();
    await fourth.onLoad();
    await starting;
    assert.equal(activePatches.size, 1, "a copy replaced while starting stays off");

    fourth.onUnload();
    assert.equal(activePatches.size, 0, "unloading the active copy removes its patch");
    for (const copy of [first, second, third]) copy.onUnload();
} finally {
    console.log = quietLog;
}

console.log("single copy test passed");
