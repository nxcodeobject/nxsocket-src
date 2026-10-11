import { createRequire } from "node:module";
import { getLocalAddresses } from "./net.js";
import type { ServerConfig } from "./types.js";

const require = createRequire(import.meta.url);
const qrcode = require("qrcode-terminal") as {
  generate: (text: string, opts?: { small?: boolean }) => void;
};

/** Cetak QR token saja di terminal. */
export function printTokenQr(token: string): void {
  console.log("");
  console.log("QR Token:");
  console.log(token);
  console.log("");
  qrcode.generate(token, { small: true });
  console.log("");
}

/** Cetak QR URL jaringan (demo telepon + token) untuk scan HP. */
export function printNetworkUrlQr(opts: {
  config: ServerConfig;
  token: string;
  page?: "demo" | "demo2" | "demo3" | "demo4" | "demo5" | "demo6" | "demo7";
  https?: boolean;
  ip?: string;
}): string | null {
  const ips = getLocalAddresses();
  const ip = opts.ip && ips.includes(opts.ip) ? opts.ip : ips[0] ?? "127.0.0.1";
  const useHttps = Boolean(opts.https);
  const page = opts.page ?? "demo3";

  // Demo telepon/video di HP wajib HTTPS
  if (!useHttps && (page === "demo2" || page === "demo3")) {
    return null;
  }

  const scheme = useHttps ? "https" : "http";
  const url = new URL(
    `${scheme}://${ip}:${opts.config.port}${opts.config.pathPrefix}/${page}`,
  );
  url.searchParams.set("token", opts.token);

  const link = url.toString();
  console.log("");
  console.log(
    useHttps
      ? `QR URL Jaringan HTTPS (scan HP → ${page} + token):`
      : "QR URL Jaringan (scan HP → buka demo + token):",
  );
  console.log(link);
  if (useHttps) {
    console.log("(Di HP: Advanced → Proceed jika muncul peringatan sertifikat)");
  }
  console.log("");
  qrcode.generate(link, { small: true });
  console.log("");
  return link;
}
