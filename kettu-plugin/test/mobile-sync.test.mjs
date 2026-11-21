// Relay sync on the phone: a reply that arrives after a newer local save must not overwrite it.
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
    slice("const farFuture", "function isDebugEnabled"),
    slice("function mergeScopeFilterItems", "function applyRawJsonConfigPatch"),
    slice("function syncInAppLoopback", "function ensureMobileRelayPresence")
].join("\n");

// `state` is the phone's stored state; `reply` is what the relay answers, delivered when `respond` is called.
const harness = new Function(`
    let state;
    let respond;
    const debugLog = () => {};
    const relayBaseUrl = url => url;
    const validateDiscordId = value => /^[0-9]+$/.test(value);
    const readMobileState = () => state;
    const writeMobileState = next => { state = next; return next; };
    const fetch = () => new Promise(resolve => { respond = payload => resolve({ status: 200, ok: true, json: () => Promise.resolve(payload) }); });
    ${body}
    return {
        mergeLocalConfig, syncInAppLoopback,
        set state(next) { state = next; },
        get state() { return state; },
        respond: payload => respond(payload)
    };
`)();

const withChance = (chance, revision) => ({
    owner_discord_id: "1",
    revision,
    last_writer_id: "1",
    allowed_editors: ["2"],
    config: harness.mergeLocalConfig({
        rules_groups: [{ id: 1 }],
        rules: [{ id: 3, rule_regex: "z", group_id: 1, chance_to_apply: chance }]
    })
});
const chanceOf = state => state.config.rules[0].chance_to_apply;

{
    // The sync asks at revision 10; a rule action then saves 70% as revision 11 before the reply
    // (an edit from elsewhere, also revision 11, still at 100%) arrives.
    harness.state = withChance(1, 10);
    const sync = harness.syncInAppLoopback("relay", "1");
    harness.state = withChance(0.7, 11);
    harness.respond({ ...withChance(1, 11), last_writer_id: "2" });
    await sync;
    assert.equal(chanceOf(harness.state), 0.7, "a reply no newer than the local state is ignored");
    assert.equal(harness.state.revision, 11);
}

{
    harness.state = withChance(0.7, 11);
    const sync = harness.syncInAppLoopback("relay", "1");
    harness.respond({ ...withChance(0.4, 12), allowed_editors: ["2", "3"], last_writer_id: "2" });
    assert.ok(await sync, "an applied reply is returned");
    assert.equal(chanceOf(harness.state), 0.4, "a newer relay state is taken over");
    assert.equal(harness.state.revision, 12);
    assert.deepEqual(harness.state.allowed_editors, ["2", "3"]);
    assert.equal(harness.state.last_writer_id, "2");
}

console.log("mobile-sync tests passed");
