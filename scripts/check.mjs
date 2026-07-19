import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const roots = ["backend", "frontend/assets", "scripts"];
const files = [];

for (const root of roots) await collectJavaScript(root, files);

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) continue;
  process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  process.exit(result.status || 1);
}

console.log(`Syntax check passed (${files.length} files)`);

async function collectJavaScript(directory, target) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectJavaScript(path, target);
    else if (/\.(?:js|mjs)$/.test(entry.name) && entry.name !== "check.mjs") target.push(path);
  }
}
