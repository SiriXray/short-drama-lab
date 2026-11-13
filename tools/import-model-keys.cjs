"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createSettings } = require("../drama-settings");
const { MODELS } = require("../drama-video-models");

// Import only the explicitly named Python key assignments from the supplied API export.
function importKeys(sourceFile, root) {
  if (!sourceFile || !root || !fs.statSync(root).isDirectory()) throw new Error("Usage: node tools/import-model-keys.cjs <api-export.txt> <workspace-data-root>");
  const source = fs.readFileSync(sourceFile, "utf8");
  const wan = source.match(/\bDASHSCOPE_KEY\s*=\s*["'](sk-[A-Za-z0-9_-]+)["']/)?.[1];
  const minimax = source.match(/\bMINIMAX_KEY\s*=\s*["'](sk-[A-Za-z0-9_-]+)["']/)?.[1];
  if (!wan || !minimax) throw new Error("The export must contain DASHSCOPE_KEY and MINIMAX_KEY assignments; no settings were changed.");
  const settings = createSettings(path.resolve(root), {});
  const result = settings.update({ services: { wan: { baseUrl: MODELS.wan.baseUrl, apiKey: wan }, minimax: { baseUrl: MODELS.minimax.baseUrl, apiKey: minimax } } }, { hasMediaTasks: true });
  return { wanConfigured: result.services.wan.configured, minimaxConfigured: result.services.minimax.configured, restartRequired: true };
}
if (require.main === module) {
  try { console.log(JSON.stringify(importKeys(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { importKeys };
