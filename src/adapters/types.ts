import type { AdapterKind, GatewayTokenRecord } from "../shared/types.js";

export type ChatDeliveryStatus = "sent" | "delivered" | "read";

export type ChatRecord = {
  id: string;
  room: string;
  text: string;
  from: string;
  name: string;
  to?: string;
  ts: string;
  status?: ChatDeliveryStatus;
  readAt?: string;
};

export type AdapterOptions = {
  dataDir: string;
  firebaseCredentials?: string;
  firebaseDatabaseURL?: string;
};

export interface DataAdapter {
  readonly kind: AdapterKind;
  init(): Promise<void>;
  close(): Promise<void>;

  /** Baca ulang token dari storage (penting untuk CLI regenerate saat server jalan). */
  reloadTokens(): Promise<void>;
  listTokens(includeRevoked?: boolean): GatewayTokenRecord[];
  findTokenByValue(token: string): GatewayTokenRecord | undefined;
  findTokenById(id: string): GatewayTokenRecord | undefined;
  upsertToken(record: GatewayTokenRecord): Promise<void>;
  replaceTokens(records: GatewayTokenRecord[]): Promise<void>;

  saveChat(message: ChatRecord): Promise<void>;
  listChat(room: string, limit?: number): Promise<ChatRecord[]>;
  /** Update status pesan; kembalikan jumlah baris yang berubah. */
  updateChatStatus?(
    ids: string[],
    status: ChatDeliveryStatus,
    meta?: { readAt?: string },
  ): Promise<number>;
  /**
   * Tandai pesan di room sebagai read (hanya yang from !== readerSessionId).
   * Kembalikan record yang baru diubah ke read.
   */
  markChatRead?(
    room: string,
    readerSessionId: string,
    opts?: { messageIds?: string[]; upToTs?: string },
  ): Promise<ChatRecord[]>;
}
