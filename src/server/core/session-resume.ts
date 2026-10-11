import type { TokenScope } from "../../shared/types.js";
import type { ConnectionState } from "./connection.js";

export type ParkedSession = {
  sessionId: string;
  tokenId: string;
  displayName: string;
  rooms: string[];
  scopes: TokenScope[];
  parkedAt: number;
};

const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Menyimpan session yang disconnect sebentar agar bisa di-resume.
 */
export class SessionResumeStore {
  private readonly parked = new Map<string, ParkedSession>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  park(state: ConnectionState): void {
    this.parked.set(state.session.id, {
      sessionId: state.session.id,
      tokenId: state.session.tokenId,
      displayName: state.displayName,
      rooms: [...state.rooms],
      scopes: state.scopes,
      parkedAt: Date.now(),
    });
  }

  take(sessionId: string, tokenId: string): ParkedSession | null {
    this.sweep();
    const row = this.parked.get(sessionId);
    if (!row) return null;
    if (row.tokenId !== tokenId) return null;
    this.parked.delete(sessionId);
    return row;
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, row] of this.parked) {
      if (now - row.parkedAt > this.ttlMs) this.parked.delete(id);
    }
  }
}
