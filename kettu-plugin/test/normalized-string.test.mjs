// Regression test: "Normalize regex" rules used to loop forever (freezing Discord) when the
// regex could match empty text or the replacement contained another match.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, "..", "src", "index.js"), "utf8");
const body = src.slice(src.indexOf("function NormalizedString"), src.indexOf("function mergeScopeFilterItems"));
assert.ok(body.length > 0, "NormalizedString source not found");

// [input, regex source, replacement, expected]
const cases = [
    ["I love café", "cafe", "tea", "I love tea"],
    ["aaa b", "a", "aa", "aaaaaa b"],
    ["ab", "x?", "-", "-a-b-"],
    ["", "x?", "-", "-"],
    ["cat cat", "cat", "cats", "cats cats"],
    ["😀 a😀", "a", "b", "😀 b😀"]
];

// Run in a worker: a synchronous infinite loop can only be stopped from another thread.
const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const NormalizedString = new Function(workerData.body + "; return NormalizedString;")();
    parentPort.postMessage(workerData.cases.map(([input, regex, replacement]) =>
        new NormalizedString(input).replace(new RegExp(regex, "gi"), () => replacement)));
`, { eval: true, workerData: { body, cases } });

const results = await Promise.race([
    new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("NormalizedString.replace hung")), 5000))
]).finally(() => worker.terminate());

cases.forEach(([input, regex, , expected], i) => {
    assert.equal(results[i], expected, `/${regex}/ on ${JSON.stringify(input)}`);
});

console.log("normalized string test passed");
