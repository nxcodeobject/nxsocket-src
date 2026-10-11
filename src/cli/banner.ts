/**
 * Banner ASCII CLI NxSocket (ansi_shadow).
 * Env: NXSOCKET_NO_BANNER=1 untuk mematikan.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** NXSOCKET — huruf besar semua, gaya ansi_shadow */
const NXSOCKET = [
  "███╗   ██╗██╗  ██╗███████╗ ██████╗  ██████╗██╗  ██╗███████╗████████╗",
  "████╗  ██║╚██╗██╔╝██╔════╝██╔═══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝",
  "██╔██╗ ██║ ╚███╔╝ ███████╗██║   ██║██║     █████╔╝ █████╗     ██║   ",
  "██║╚██╗██║ ██╔██╗ ╚════██║██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   ",
  "██║ ╚████║██╔╝ ██╗███████║╚██████╔╝╚██████╗██║  ██╗███████╗   ██║   ",
  "╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ",
];

const BRAND_ORANGE = "\x1b[1m\x1b[38;2;232;149;111m";
const RESET = "\x1b[0m";
const BANNER_MIN_COLS = 72;

function brand(text: string): string {
  return `${BRAND_ORANGE}${text}${RESET}`;
}

export function printNxsocketBanner(): void {
  if (process.env.NXSOCKET_NO_BANNER === "1" || process.env.CI === "true") return;

  const cols = process.stdout.columns || 80;
  console.log("");
  if (cols >= BANNER_MIN_COLS) {
    for (const line of NXSOCKET) {
      console.log(brand(line));
    }
    console.log("");
  }
  console.log(brand(`NXSOCKET v${readVersion()}`));
  console.log("");
}
