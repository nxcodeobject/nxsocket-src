import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export function loadLiveKitConfig(): LiveKitConfig | null {
  const url = process.env.NXSOCKET_LIVEKIT_URL?.trim();
  const apiKey = process.env.NXSOCKET_LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.NXSOCKET_LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export class SfuLiveKitModule {
  readonly enabled: boolean;
  readonly url: string | null;
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;

  constructor(cfg: LiveKitConfig | null = loadLiveKitConfig()) {
    this.enabled = Boolean(cfg);
    this.url = cfg?.url ?? null;
    this.apiKey = cfg?.apiKey ?? null;
    this.apiSecret = cfg?.apiSecret ?? null;
  }

  statusPayload(): {
    type: "sfu.status";
    enabled: boolean;
    url?: string;
    provider: "livekit";
  } {
    return {
      type: "sfu.status",
      enabled: this.enabled,
      url: this.url || undefined,
      provider: "livekit",
    };
  }

  async createJoinToken(input: {
    room: string;
    identity: string;
    name: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
  }): Promise<{ url: string; token: string; room: string }> {
    if (!this.enabled || !this.url || !this.apiKey || !this.apiSecret) {
      throw new Error(
        "LiveKit belum dikonfigurasi. Set NXSOCKET_LIVEKIT_URL, NXSOCKET_LIVEKIT_API_KEY, NXSOCKET_LIVEKIT_API_SECRET. Lihat docs/sfu-livekit.md",
      );
    }
    const room = input.room.trim();
    if (!room) throw new Error("Room SFU kosong");
    const identity = (input.identity || "user").slice(0, 64);
    const name = (input.name || identity).slice(0, 64);

    // Pastikan room ada (opsional; gagal soft jika RoomService tidak reachable)
    try {
      const host = this.url.replace(/^ws/i, "http");
      const svc = new RoomServiceClient(host, this.apiKey, this.apiSecret);
      await svc.createRoom({ name: room, emptyTimeout: 60 * 30, maxParticipants: 50 });
    } catch (err) {
      console.warn(
        "[sfu] createRoom:",
        err instanceof Error ? err.message : err,
      );
    }

    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name,
      ttl: "6h",
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: input.canPublish !== false,
      canSubscribe: input.canSubscribe !== false,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { url: this.url, token, room };
  }
}
