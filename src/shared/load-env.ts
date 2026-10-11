import fs from "node:fs";
import path from "node:path";

/** Muat file .env ke process.env (tanpa dependency). Tidak menimpa env yang sudah ada. */
export function loadEnvFile(filePath?: string): string | null {
  const resolved = path.resolve(process.cwd(), filePath ?? ".env");
  if (!fs.existsSync(resolved)) return null;

  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return resolved;
}

// Side-effect: muat .env segera saat modul di-import
loadEnvFile();
