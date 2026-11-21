// Saving an edit to someone else's config: a newer version made meanwhile (e.g. by a rule action on
// their phone) is merged with the edit instead of being overwritten.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, "..", "keyInterceptSelfHosted.tsx"), "utf8");
const slice = (from, to) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `source not found: ${from}`);
    return src.slice(start, end);
};
const body = stripTypeScriptTypes([
    slice("const farFuture", "function cloneDefaultConfig"),
    slice("function mergeScopeFilterItems", "function getSharedScopeList"),
    slice("function assignRuleIds", "function configLogSummary"),
    slice("function parseNumericInput", "function isDebugEnabled"),
    slice("function extendTimeout", "function getProfileUserId"),
    slice("function parseErrorStatusCode", "function formatConfigAccessError"),
    slice("type RemoteConfigState", "async function requestRemoteAccess")
].join("\n"));

// The relay: `relay` holds the target's config and revision; pushes check expected_revision like it does.
const harness = new Function(`
    const LOG_PREFIX = "[test]";
    let interceptConfig;
    let relay;
    const pushes = [];
    async function pushRemoteConfig(relayUrl, editorId, targetUserId, config, expectedRevision) {
        pushes.push(expectedRevision);
        if (relay.revision !== null && Number.isFinite(expectedRevision) && expectedRevision !== relay.revision) {
            throw new Error("Relay update failed: 409 (revision mismatch)");
        }
        relay = { config, revision: relay.revision === null ? null : relay.revision + 1 };
        return relay.revision;
    }
    async function readRemoteConfig() { return { config: mergeLocalConfig(relay.config), revision: relay.revision }; }
    ${body}
    return {
        mergeLocalConfig, mergeConfigEdits, pushRemoteConfigEdits,
        set relay(next) { relay = next; },
        get relay() { return relay; },
        pushes
    };
`)();

const farFuture = "9999-12-31T23:59:59.000Z";
const base = harness.mergeLocalConfig({
    config: { pet_amount: 0.2 },
    drone_config: { drone_term: "Unit" },
    censored_words: ["bad"],
    rules_groups: [{ id: 1, name: "Triggers", enabled: true, timeout_end: farFuture }],
    rules: [
        { id: 1, rule_regex: "aaa", rule_replacement: "$&", chance_to_apply: 1, group_id: 1, actions: [{ target: "rule.3.chance", op: "decrease", value: 0.3 }] },
        { id: 3, rule_regex: "zzz", rule_replacement: "$&", chance_to_apply: 1, group_id: 1 }
    ]
});
const edit = (config, change) => {
    const copy = structuredClone(config);
    change(copy);
    return harness.mergeLocalConfig(copy);
};
const rule = (config, id) => config.rules.find(candidate => candidate.id === id);

// The merge on its own.
{
    const theirs = edit(base, c => { rule(c, 3).chance_to_apply = 0.7; c.config.pet_amount = 0.5; });
    const mine = edit(base, c => { rule(c, 3).rule_regex = "zzz+"; c.drone_config.drone_term = "Drone"; c.censored_words = ["bad", "worse"]; });
    const merged = harness.mergeConfigEdits(base, mine, theirs);
    assert.equal(rule(merged, 3).chance_to_apply, 0.7, "their change to a rule is kept");
    assert.equal(rule(merged, 3).rule_regex, "zzz+", "my change to the same rule is kept");
    assert.equal(merged.config.pet_amount, 0.5);
    assert.equal(merged.drone_config.drone_term, "Drone");
    assert.deepEqual(merged.censored_words, ["bad", "worse"]);

    assert.deepEqual(harness.mergeConfigEdits(base, base, theirs), theirs, "no edit: theirs as is");
    assert.deepEqual(harness.mergeConfigEdits(base, mine, base), mine, "nothing changed elsewhere: my edit as is");

    const bothChanged = harness.mergeConfigEdits(base, edit(base, c => { rule(c, 3).chance_to_apply = 0.9; }), theirs);
    assert.equal(rule(bothChanged, 3).chance_to_apply, 0.9, "the same value changed on both sides: the edit wins");

    const removedHere = harness.mergeConfigEdits(base, edit(base, c => { c.rules = c.rules.filter(r => r.id !== 3); }), theirs);
    assert.equal(rule(removedHere, 3), undefined, "a rule I removed stays removed");
    const addedThere = edit(base, c => { c.rules.push({ ...rule(c, 3), id: 4, rule_regex: "new" }); });
    assert.equal(rule(harness.mergeConfigEdits(base, mine, addedThere), 4).rule_regex, "new", "a rule added elsewhere is kept");
    const removedThere = edit(base, c => { c.rules = c.rules.filter(r => r.id !== 1); });
    assert.equal(rule(harness.mergeConfigEdits(base, mine, removedThere), 1), undefined, "a rule removed elsewhere and not edited here stays removed");
}

// Saving: a rule action on the phone lowered rule 3's chance after the editor loaded the config.
{
    harness.relay = { config: base, revision: 10 };
    const known = { userId: "2", base, config: base, revision: 10 };
    harness.relay = { config: edit(base, c => { rule(c, 3).chance_to_apply = 0.7; }), revision: 11 };
    const mine = edit(base, c => { c.config.pet_amount = 0.4; });
    const saved = await harness.pushRemoteConfigEdits("relay", "1", mine, known, "mobile");
    assert.deepEqual(harness.pushes.splice(0), [10, 11], "refused at the old revision, saved at the new one");
    assert.equal(rule(harness.relay.config, 3).chance_to_apply, 0.7, "the phone's change survives the save");
    assert.equal(harness.relay.config.config.pet_amount, 0.4, "the edit is saved");
    assert.equal(saved.revision, 12);

    // The next edit (made before the editor showed the merged result) builds on the saved version.
    const next = edit(mine, c => { c.drone_config.drone_term = "Drone"; });
    await harness.pushRemoteConfigEdits("relay", "1", next, saved, "mobile");
    assert.deepEqual(harness.pushes.splice(0), [12], "no conflict this time");
    assert.equal(rule(harness.relay.config, 3).chance_to_apply, 0.7, "a later edit doesn't undo the phone's change either");
    assert.equal(harness.relay.config.drone_config.drone_term, "Drone");
}

// A PC target has no revision: saved unchecked, as before.
{
    harness.relay = { config: base, revision: null };
    const mine = edit(base, c => { c.config.pet_amount = 0.4; });
    await harness.pushRemoteConfigEdits("relay", "1", mine, { userId: "2", base: mine, config: mine, revision: null }, "auto");
    assert.deepEqual(harness.pushes.splice(0), [undefined]);
    assert.equal(harness.relay.config.config.pet_amount, 0.4);
}

console.log("remote edit test passed");
