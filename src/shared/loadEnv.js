import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const valueRaw = trimmed.slice(equalIndex + 1).trim();
    if (!key) continue;

    const unquoted =
      (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
      (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
        ? valueRaw.slice(1, -1)
        : valueRaw;

    if (process.env[key] === undefined) {
      process.env[key] = unquoted;
    }
  }
}

