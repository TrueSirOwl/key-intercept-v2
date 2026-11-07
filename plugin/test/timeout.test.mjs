// Regression test: adding time to a permanent timeout used to push year 9999 further out,
// so a new rule group (which starts permanent) never showed a countdown.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, "..", "keyInterceptSelfHosted.tsx"), "utf8");
const body = stripTypeScriptTypes(src.slice(src.indexOf("function extendTimeout"), src.indexOf("function formatTimeoutStatus")));
assert.ok(body.length > 0, "extendTimeout source not found");

const permanentTimestamp = Date.parse("9999-12-31T23:59:59.000Z");
const extendTimeout = new Function("permanentTimestamp", body + "; return extendTimeout;")(permanentTimestamp);
const now = Date.parse("2026-11-07T12:00:00.000Z");
const plusMinute = "2026-11-07T12:01:00.000Z";

assert.equal(extendTimeout("9999-12-31T23:59:59.000Z", now, 60), plusMinute, "permanent starts from now");
assert.equal(extendTimeout("2026-11-07T12:05:00.000Z", now, 60), "2026-11-07T12:06:00.000Z", "running timeout is extended");
assert.equal(extendTimeout("2026-11-07T11:00:00.000Z", now, 60), plusMinute, "expired starts from now");
assert.equal(extendTimeout("1970-01-01T00:00:00.000Z", now, 60), plusMinute, "off starts from now");
assert.equal(extendTimeout("garbage", now, 60), plusMinute, "invalid starts from now");

console.log("timeout test passed");
