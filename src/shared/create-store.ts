import { createAdapter } from "../adapters/index.js";
import { loadConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import type { ServerConfig } from "./types.js";

export async function createTokenStore(
  overrides: Partial<ServerConfig> = {},
): Promise<{ store: TokenStore; config: ServerConfig; close: () => Promise<void> }> {
  const config = loadConfig(overrides);
  const adapter = await createAdapter(config.adapter, {
    dataDir: config.dataDir,
    firebaseCredentials: config.firebaseCredentials,
    firebaseDatabaseURL: config.firebaseDatabaseURL,
  });
  return {
    store: new TokenStore(adapter),
    config,
    close: () => adapter.close(),
  };
}
