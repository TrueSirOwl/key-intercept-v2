import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = join(here, "..", "keyInterceptSelfHosted.tsx");
const source = await readFile(pluginPath, "utf8");

const requiredSnippets = [
    "function shouldApplyRules(config: Config): boolean {",
    "function shouldApplyGag(config: Config): boolean {",
    "function shouldApplyPet(config: Config): boolean {",
    "function shouldApplyBimbo(config: Config): boolean {",
    "function shouldApplyHorny(config: Config): boolean {",
    "function shouldApplyDrone(config: Config): boolean {",
    "function shouldApplyUWU(config: Config): boolean {",
    "function shouldApplyCensored(config: Config): boolean {",
    "applyStep(\"rules\", applyRules);",
    "applyStep(\"uwu\", applyUWU);",
    "applyStep(\"horny\", applyHorny);",
    "applyStep(\"pet\", applyPet);",
    "applyStep(\"bimbo\", applyBimbo);",
    "applyStep(\"censored\", applyCensored);",
    "applyStep(\"gag\", applyGag);",
    "const droneResult = applyDrone(msg, channelId);"
];

for (const snippet of requiredSnippets) {
    assert.ok(source.includes(snippet), `Missing expected plugin behavior snippet: ${snippet}`);
}

// @webpack/common exports stay undefined until Discord's webpack has loaded; touching one while
// the module loads throws and stops all of Vencord from starting.
const lazyWebpackCommon = "React|ReactDOM|Menu|UserStore";
const eagerUse = source.match(new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+[^=\\n]*=\\s*(?:${lazyWebpackCommon})\\.[^\\n]*`, "m"));
assert.equal(eagerUse, null, `Module-level use of a lazy @webpack/common export: ${eagerUse?.[0]}`);

console.log("plugin smoke test passed");
