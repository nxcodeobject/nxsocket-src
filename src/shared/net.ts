import os from "node:os";
import type { ServerConfig } from "./types.js";

export function getLocalAddresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

export function formatGatewayEndpoints(config: ServerConfig): string[] {
  const scheme = config.https ? "https" : "http";
  const base = `${config.pathPrefix}`;
  const lines = [`Lokal   : ${scheme}://127.0.0.1:${config.port}${base}`];

  for (const ip of getLocalAddresses()) {
    lines.push(`Jaringan: ${scheme}://${ip}:${config.port}${base}`);
  }

  return lines;
}
