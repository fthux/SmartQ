import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));
const envFile = join(root, ".env");

loadEnvFile(envFile);

function loadEnvFile(filePath) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const index = line.indexOf("=");
      if (index === -1) return;
      const key = line.slice(0, index).trim();
      const value = stripQuotes(line.slice(index + 1).trim());
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
