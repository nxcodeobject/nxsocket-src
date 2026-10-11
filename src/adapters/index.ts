import type { AdapterKind } from "../shared/types.js";
import { FirebaseAdapter } from "./firebase.js";
import { JsonAdapter } from "./json.js";
import { SqliteAdapter } from "./sqlite.js";
import type { AdapterOptions, DataAdapter } from "./types.js";

export async function createAdapter(
  kind: AdapterKind,
  options: AdapterOptions,
): Promise<DataAdapter> {
  let adapter: DataAdapter;

  switch (kind) {
    case "sqlite":
      adapter = new SqliteAdapter(options);
      break;
    case "firebase":
      adapter = new FirebaseAdapter(options);
      break;
    case "json":
    default:
      adapter = new JsonAdapter(options);
      break;
  }

  await adapter.init();
  return adapter;
}

export type { DataAdapter, ChatRecord, ChatDeliveryStatus, AdapterOptions } from "./types.js";
export { JsonAdapter } from "./json.js";
export { SqliteAdapter } from "./sqlite.js";
export { FirebaseAdapter } from "./firebase.js";
