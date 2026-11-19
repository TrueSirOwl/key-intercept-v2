// Changing the relay setting asks Discord (Vencord) to allow the relay and moves the loopback to it.
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
    slice("function isLoopbackHostname", "function isMobileRuntime"),
    slice("function relayBaseUrl", "async function pushRemoteConfig")
].join("\n"));

function setup({ allowed = false, transport = "desktop_http" } = {}) {
    const calls = [];
    const VencordNative = {
        csp: {
            isDomainAllowed: async (url, directives) => { calls.push(["isDomainAllowed", url, directives]); return allowed; },
            requestAddOverride: async (url, directives, caller) => { calls.push(["requestAddOverride", url, directives, caller]); return "ok"; }
        }
    };
    const fetch = async (url, init) => { calls.push(["fetch", url, init.method, init.headers["x-discord-user-id"], JSON.parse(init.body)]); return { ok: true, status: 204 }; };
    const applyRelaySetting = new Function("VencordNative", "fetch", `
        const LOG_PREFIX = "[test]";
        const LOOPBACK = "http://127.0.0.1:35491";
        const DISCORD_SECURE_ORIGINS = new Set(["https://discord.com"]);
        const window = { location: { origin: "https://discord.com" } };
        const activeLoopbackTransport = ${JSON.stringify(transport)};
        const currentUser = () => ({ id: "42" });
        const console = { info() {}, warn() {} };
        ${body}
        return applyRelaySetting;
    `)(VencordNative, fetch);
    return { applyRelaySetting, calls };
}

{
    const { applyRelaySetting, calls } = setup();
    await applyRelaySetting(" https://relay.example.org/ki-relay/ ");
    assert.deepEqual(calls, [
        ["isDomainAllowed", "https://relay.example.org/ki-relay", ["connect-src"]],
        ["requestAddOverride", "https://relay.example.org/ki-relay", ["connect-src"], "Key Intercept"],
        ["fetch", "http://127.0.0.1:35491/relay", "PUT", "42", { relay_url: "https://relay.example.org/ki-relay" }]
    ], "an unknown relay is asked for, then the loopback moves to it");
}
{
    const { applyRelaySetting, calls } = setup({ allowed: true });
    await applyRelaySetting("http://relay.example.org");
    assert.deepEqual(calls.map(call => call[0]), ["isDomainAllowed", "fetch"], "an allowed relay isn't asked for again");
    assert.equal(calls[1][4].relay_url, "https://relay.example.org", "plain http is upgraded like every other relay request");
}
{
    const { applyRelaySetting, calls } = setup();
    await applyRelaySetting("http://127.0.0.1:46001");
    assert.deepEqual(calls.map(call => call[0]), ["fetch"], "a local relay is already allowed by Vencord");
}
{
    const { applyRelaySetting, calls } = setup({ transport: "in_app_mobile" });
    await applyRelaySetting("https://relay.example.org");
    assert.deepEqual(calls.map(call => call[0]), ["isDomainAllowed", "requestAddOverride"], "without a desktop loopback there is nothing to move");
}
{
    const { applyRelaySetting, calls } = setup();
    await applyRelaySetting("not a url");
    await applyRelaySetting("");
    assert.deepEqual(calls, [], "an unfinished value does nothing");
}

console.log("relay setting test passed");
