import { spawnSync } from "node:child_process";
import { getLocalAddresses } from "./net.js";

/** Cetak tip akses HP + saran firewall Windows. */
export function printLanAccessTips(port: number, https: boolean): void {
  const scheme = https ? "https" : "http";
  const ips = getLocalAddresses();

  console.log("");
  if (https) {
    console.log("Akses dari HP (WiFi sama) — HTTPS:");
    if (ips.length === 0) {
      console.log("  (IP jaringan tidak terdeteksi)");
    } else {
      for (const ip of ips) {
        console.log(`  ${scheme}://${ip}:${port}/v1/demo3`);
      }
    }
    console.log("");
    console.log("Di HP: Advanced → Proceed (sertifikat self-signed), lalu izinkan mikrofon.");
  }

  if (process.platform === "win32") {
    console.log("");
    console.log("Jika HP tidak bisa buka halaman, izinkan firewall (Admin PowerShell):");
    console.log(
      `  netsh advfirewall firewall add rule name="NxSocket ${port}" dir=in action=allow protocol=TCP localport=${port}`,
    );
    const check = spawnSync(
      "netsh",
      ["advfirewall", "firewall", "show", "rule", `name=NxSocket ${port}`],
      { encoding: "utf8" },
    );
    const out = `${check.stdout ?? ""}${check.stderr ?? ""}`;
    if (
      /No rules match|tidak ada aturan|The requested operation requires elevation/i.test(out) ||
      check.status !== 0
    ) {
      console.log("  (Rule belum terdeteksi / butuh Admin — jalankan perintah di atas bila perlu)");
    } else {
      console.log(`  Rule "NxSocket ${port}" sudah ada.`);
    }
  }
}
