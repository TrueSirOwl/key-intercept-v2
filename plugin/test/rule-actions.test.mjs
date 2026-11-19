// Rule actions: rules that change other settings (modes, groups, rules, ...) each time they match.
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
    slice("class NormalizedString", "function isLink"),
    slice("function shouldApply(", "function applyUWU")
].join("\n"));

// Stand-ins for the loopback: `stored` is what it holds, saveLocalConfig reloads like the real one.
const harness = new Function(`
    const LOG_PREFIX = "[test]";
    let interceptConfig;
    let activeLoopbackTransport = "desktop_http";
    let stored;
    const currentUser = () => ({ id: "1" });
    async function readDesktopLoopbackConfig() { return mergeLocalConfig(stored); }
    function readInAppLoopbackConfig() { return mergeLocalConfig(stored); }
    async function saveLocalConfig(userId, config) { stored = config; interceptConfig = mergeLocalConfig(config); return interceptConfig; }
    ${body}
    return {
        mergeLocalConfig, applyRuleAction, applyRules, applyHeldRuleActions, withoutDanglingRuleActions, parseDuration,
        load(config) { stored = config; interceptConfig = mergeLocalConfig(config); },
        get config() { return interceptConfig; },
        get stored() { return stored; },
        setStored(config) { stored = config; },
        saved: () => ruleActionSaveQueue
    };
`)();

const now = Date.parse("2026-11-07T12:00:00.000Z");
const iso = ms => new Date(ms).toISOString();
const farFuture = "9999-12-31T23:59:59.000Z";
const epoch = "1970-01-01T00:00:00.000Z";

// Rule ids: legacy rules get ids in list order, valid ids are kept, duplicates are renumbered.
{
    const merged = harness.mergeLocalConfig({
        rules: [
            { rule_regex: "a", group_id: 1 },
            { id: 5, rule_regex: "b", group_id: 1, actions: [{ target: "gag.timer", op: "add", value: "5m" }, { target: 3 }, null] },
            { id: 5, rule_regex: "c", group_id: 1 },
            { id: 0, rule_regex: "d", group_id: 1 }
        ],
        rules_groups: [{ id: 1 }]
    });
    assert.deepEqual(merged.rules.map(rule => rule.id), [6, 5, 7, 8]);
    assert.deepEqual(merged.rules[1].actions, [{ target: "gag.timer", op: "add", value: "5m" }], "malformed actions are dropped");
    assert.deepEqual(merged.rules[0].actions, [], "rules without actions get an empty list");
    const again = harness.mergeLocalConfig(JSON.parse(JSON.stringify(merged)));
    assert.deepEqual(again.rules, merged.rules, "ids and actions survive a save/load round trip");
}

assert.equal(harness.parseDuration("5m"), 300);
assert.equal(harness.parseDuration("1h 30m"), 5400);
assert.equal(harness.parseDuration(" 2d "), 172800);
assert.equal(harness.parseDuration("1.5h"), 5400);
assert.equal(harness.parseDuration("5"), null, "a number needs a unit");
assert.equal(harness.parseDuration("5 minutes"), null);

// Each kind of target.
{
    const base = harness.mergeLocalConfig({
        config: { gag_end: epoch, uwu_end: iso(now + 600_000), horny_end: farFuture, pet_amount: 0.5, pet_type: 1 },
        drone_config: { drone_health: 100 },
        censored_words: ["Bad"],
        rules_groups: [{ id: 2, name: "Punish", enabled: false, timeout_end: farFuture }],
        rules: [{ id: 4, rule_regex: "x", rule_replacement: "y", chance_to_apply: 0.5, group_id: 2 }]
    });
    const run = (target, op, value) => harness.applyRuleAction(base, { target, op, value }, now);

    assert.equal(run("gag.timer", "add", "5m").config.gag_end, iso(now + 300_000), "add time to an off mode starts it");
    assert.equal(run("uwu.timer", "add", "5m").config.uwu_end, iso(now + 900_000), "add time extends a running mode");
    assert.equal(run("uwu.timer", "remove", "2m").config.uwu_end, iso(now + 480_000), "remove time shortens a running mode");
    assert.equal(run("uwu.timer", "remove", "1h").config.uwu_end, iso(now - 3_000_000), "removing more than is left ends it");
    assert.equal(run("gag.timer", "remove", "2m").config.gag_end, epoch, "removing time from an off mode leaves it off");
    assert.equal(run("horny.timer", "remove", "2m").config.horny_end, farFuture, "removing time from a permanent mode leaves it permanent");
    assert.equal(run("gag.timer", "permanent", null).config.gag_end, farFuture);
    assert.equal(run("uwu.timer", "off", null).config.uwu_end, epoch);
    assert.equal(run("gag.timer", "add", "soon"), base, "an unusable duration changes nothing");

    assert.equal(run("pet.amount", "increase", 0.2).config.pet_amount, 0.7);
    assert.equal(run("pet.amount", "increase", 0.8).config.pet_amount, 1, "percent stops at 100%");
    assert.equal(run("pet.amount", "decrease", 0.9).config.pet_amount, 0, "percent stops at 0%");
    const kitty = run("pet.type", "set", 2);
    assert.equal(kitty.config.pet_type, 2);
    assert.deepEqual(kitty.pet_words, ["meow", "mrow", "nya", "mreow", "mew"], "pet words follow the pet type");
    assert.equal(run("pet.type", "set", 99), base, "an unknown pet type changes nothing");
    assert.equal(run("drone.health", "decrease", 30).drone_config.drone_health, 70);
    assert.equal(run("drone.health", "set", 150).drone_config.drone_health, 100, "health stays within 0..100");
    assert.equal(run("bimbo.word_length", "decrease", 50).config.bimbo_word_length, 1, "word length stays at least 1");
    assert.equal(run("drone.speech_header", "set", "BEEP").drone_config.speech_header, "BEEP");
    assert.deepEqual(run("censored.words", "add", " cute ").censored_words, ["Bad", "cute"]);
    assert.deepEqual(run("censored.words", "add", "bad").censored_words, ["Bad"], "no duplicate words, ignoring case");
    assert.deepEqual(run("censored.words", "remove", "BAD").censored_words, []);
    assert.equal(run("debug.enabled", "enable", null).config.debug, true);
    assert.equal(base.config.debug_message, "(original message: {original})", "configs without a debug message get the default");
    assert.equal(run("debug.message", "set", "(was: {original})").config.debug_message, "(was: {original})");

    assert.equal(run("group.2.enabled", "enable", null).rules_groups[0].enabled, true);
    assert.equal(run("group.2.timer", "add", "10m").rules_groups[0].timeout_end, iso(now + 600_000));
    assert.equal(run("rule.4.enabled", "disable", null).rules[0].enabled, false);
    assert.equal(run("rule.4.chance", "decrease", 0.1).rules[0].chance_to_apply, 0.4);
    assert.equal(run("rule.4.replacement", "set", "z").rules[0].rule_replacement, "z");
    assert.equal(run("rule.9.enabled", "disable", null), base, "a removed rule is ignored");
    assert.equal(run("config.blocked_by_dom", "disable", null), base, "Sub Control can't be changed by rules");

    const withDangling = { ...base, rules: [{ ...base.rules[0], actions: [{ target: "group.2.enabled", op: "enable", value: null }, { target: "group.3.enabled", op: "enable", value: null }] }] };
    assert.deepEqual(harness.withoutDanglingRuleActions(withDangling).rules[0].actions.map(action => action.target), ["group.2.enabled"]);
}

// Sending: actions fire per replaced match and get saved. Rule and group changes apply within the same
// message; mode changes wait until the message is done.
{
    harness.load({
        config: { gag_end: epoch },
        rules_groups: [
            { id: 1, name: "Triggers", enabled: true, timeout_end: farFuture, order: 0 },
            { id: 2, name: "Punish", enabled: false, timeout_end: farFuture, order: 1 }
        ],
        rules: [
            { id: 1, rule_regex: "sorry", rule_replacement: "$&", chance_to_apply: 1, order: 0, group_id: 1, actions: [
                { target: "gag.timer", op: "add", value: "5m" },
                { target: "group.2.enabled", op: "enable", value: null }
            ] },
            { id: 2, rule_regex: "once", rule_replacement: "ONCE", chance_to_apply: 1, order: 1, group_id: 1, actions: [
                { target: "rule.2.enabled", op: "disable", value: null }
            ] },
            { id: 3, rule_regex: "never", rule_replacement: "never", chance_to_apply: 0, order: 2, group_id: 1, actions: [
                { target: "drone.health", op: "decrease", value: 50 }
            ] },
            { id: 4, rule_regex: "hello", rule_replacement: "HI", chance_to_apply: 1, order: 0, group_id: 2, actions: [] }
        ]
    });
    // A remote editor changes something while the message is being sent; saving must not undo it.
    harness.setStored({ ...harness.stored, drone_config: { drone_term: "Unit" } });

    const before = Date.now();
    const output = harness.applyRules("sorry hello sorry, once once never");
    assert.equal(output, "sorry HI sorry, ONCE once never", "a group enabled by an earlier rule applies to the same message; a rule that disables itself stops at once");
    assert.equal(harness.config.config.gag_end, epoch, "the gag waits until the message that triggered it is done");
    harness.applyHeldRuleActions();
    const gagEnd = Date.parse(harness.config.config.gag_end);
    assert.ok(gagEnd >= before + 600_000 && gagEnd <= Date.now() + 600_000, "each replaced match fires the actions: two matches add 10 minutes");
    assert.equal(harness.config.drone_config.drone_health, 100, "a match whose chance roll fails fires nothing");

    const gagEndBeforeSave = harness.config.config.gag_end;
    await harness.saved();
    const saved = harness.mergeLocalConfig(harness.stored);
    assert.equal(saved.config.gag_end, gagEndBeforeSave, "the gag time was saved");
    assert.equal(harness.config.config.gag_end, gagEndBeforeSave, "reloading after the save kept the change");
    assert.equal(saved.rules_groups.find(group => group.id === 2).enabled, true, "the enabled group was saved");
    assert.equal(saved.rules.find(rule => rule.id === 2).enabled, false, "the self-disabled rule was saved");
    assert.equal(saved.drone_config.drone_term, "Unit", "the remote edit made meanwhile was kept");
}

// Each action can choose to trigger before the message (already changing it) or after it.
{
    harness.load({
        config: { gag_end: epoch },
        rules_groups: [
            { id: 1, name: "Triggers", enabled: true, timeout_end: farFuture, order: 0 },
            { id: 2, name: "Later", enabled: false, timeout_end: farFuture, order: 1 }
        ],
        rules: [
            { id: 1, rule_regex: "gag me", rule_replacement: "$&", chance_to_apply: 1, order: 0, group_id: 1, actions: [
                { target: "gag.timer", op: "add", value: "5m", after_message: false },
                { target: "group.2.enabled", op: "enable", value: null, after_message: true }
            ] },
            { id: 2, rule_regex: "hello", rule_replacement: "HI", chance_to_apply: 1, order: 0, group_id: 2, actions: [] }
        ]
    });
    assert.deepEqual(harness.config.rules[0].actions.map(action => action.after_message), [false, true], "the choice survives loading");
    assert.equal(harness.applyRules("gag me hello"), "gag me hello", "a group switched on after the message doesn't change it");
    assert.notEqual(harness.config.config.gag_end, epoch, "a gag set to trigger before the message applies at once");
    assert.equal(harness.config.rules_groups.find(group => group.id === 2).enabled, false);
    harness.applyHeldRuleActions();
    assert.equal(harness.config.rules_groups.find(group => group.id === 2).enabled, true, "the group switches on once the message is done");
    await harness.saved();
    assert.deepEqual(harness.mergeLocalConfig(harness.stored).rules[0].actions.map(action => action.after_message), [false, true], "the choice is saved");

    const malformed = harness.mergeLocalConfig({
        rules: [{ id: 1, rule_regex: "a", group_id: 1, actions: [{ target: "gag.timer", op: "add", value: "5m", after_message: "yes" }] }],
        rules_groups: [{ id: 1 }]
    });
    assert.equal("after_message" in malformed.rules[0].actions[0], false, "a malformed choice is dropped, leaving the default");
}

console.log("rule actions test passed");
