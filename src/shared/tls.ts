import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getLocalAddresses } from "./net.js";

const require = createRequire(import.meta.url);
const selfsigned = require("selfsigned") as {
  generate: (
    attrs: Array<{ name: string; value: string }> | null,
    opts?: Record<string, unknown>,
  ) => Promise<{ private: string; cert: string; public?: string }>;
};

export type TlsMaterial = {
  key: string;
  cert: string;
  certPath: string;
  keyPath: string;
};

/** Buat / baca sertifikat self-signed untuk HTTPS (HP + mic). */
export async function ensureTlsCerts(dataDir: string): Promise<TlsMaterial> {
  const dir = path.join(dataDir, "certs");
  fs.mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, "dev-key.pem");
  const certPath = path.join(dir, "dev-cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath, "utf8");
    const cert = fs.readFileSync(certPath, "utf8");
    if (key.trim() && cert.trim()) {
      return { key, cert, keyPath, certPath };
    }
  }

  const alts = [...new Set(["localhost", "127.0.0.1", ...getLocalAddresses()])];
  const attrs = [{ name: "commonName", value: "NxSocket Dev" }];
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 1);

  const pems = await selfsigned.generate(attrs, {
    keyType: "rsa",
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      {
        name: "subjectAltName",
        altNames: alts.map((v) =>
          /^\d+\.\d+\.\d+\.\d+$/.test(v)
            ? { type: 7, ip: v }
            : { type: 2, value: v },
        ),
      },
    ],
  });

  if (!pems?.private || !pems?.cert) {
    throw new Error("Gagal membuat sertifikat self-signed (selfsigned.generate)");
  }

  fs.writeFileSync(keyPath, pems.private, "utf8");
  fs.writeFileSync(certPath, pems.cert, "utf8");

  return {
    key: pems.private,
    cert: pems.cert,
    keyPath,
    certPath,
  };
}
