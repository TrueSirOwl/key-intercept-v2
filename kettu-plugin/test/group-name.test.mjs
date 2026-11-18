// Regression test: mergeLocalConfig used to rebuild rule groups without `name`, so every Kettu
// save/sync stripped group names and the desktop plugin showed them as reset.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, "..", "src", "index.js"), "utf8");
const slice = (from, to) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `source not found: ${from}`);
    return src.slice(start, end);
};
const body = [
    slice("const farFuture", "const permanentTimestamp"),
    slice("const petWordsByType", "function isDebugEnabled"),
    slice("function mergeScopeFilterItems", "function getPetWordsForType")
].join("\n");
const mergeLocalConfig = new Function(body + "; return mergeLocalConfig;")();

const merged = mergeLocalConfig({
    rules: [],
    rules_groups: [
        { id: 3, name: "Morning", timeout_end: "9999-12-31T23:59:59.000Z", enabled: true, order: 0 },
        { id: 7, name: "", timeout_end: "9999-12-31T23:59:59.000Z", enabled: true, order: 1 },
        { id: 9, timeout_end: "9999-12-31T23:59:59.000Z", enabled: true, order: 2 }
    ]
});
assert.equal(merged.rules_groups[0].name, "Morning", "name is kept");
assert.equal(merged.rules_groups[1].name, "", "an empty name stays empty while being edited");
assert.equal(merged.rules_groups[2].name, "Group 3", "a missing name falls back like the desktop plugin");

const roundTripped = mergeLocalConfig(JSON.parse(JSON.stringify(merged)));
assert.deepEqual(roundTripped.rules_groups.map(group => group.name), ["Morning", "", "Group 3"], "names survive a save/load round trip");

console.log("group name test passed");
