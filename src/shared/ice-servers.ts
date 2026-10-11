/** ICE / TURN config untuk WebRTC (demo2 / demo3). */

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Prioritas:
 * 1. NXSOCKET_ICE_SERVERS — JSON array RTCIceServer
 * 2. NXSOCKET_TURN_URLS + USERNAME + CREDENTIAL (+ STUN default)
 * 3. STUN Google saja
 */
export function resolveIceServers(): IceServerConfig[] {
  const raw = process.env.NXSOCKET_ICE_SERVERS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as IceServerConfig[];
      }
    } catch {
      console.warn("[ice] NXSOCKET_ICE_SERVERS bukan JSON valid — fallback STUN/TURN env");
    }
  }

  const servers = [...DEFAULT_STUN];
  const turnUrls = process.env.NXSOCKET_TURN_URLS?.trim();
  const turnUser = process.env.NXSOCKET_TURN_USERNAME?.trim();
  const turnPass = process.env.NXSOCKET_TURN_CREDENTIAL?.trim();
  if (turnUrls && turnUser && turnPass) {
    const urls = turnUrls
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length) {
      servers.push({ urls, username: turnUser, credential: turnPass });
    }
  }
  return servers;
}

export function iceStatusLabel(servers: IceServerConfig[]): string {
  const hasTurn = servers.some((s) => {
    const u = s.urls;
    const list = Array.isArray(u) ? u : [u];
    return list.some((x) => /^turns?:/i.test(String(x)));
  });
  return hasTurn
    ? `ICE: STUN+TURN (${servers.length} server)`
    : `ICE: STUN only (${servers.length}) — set NXSOCKET_TURN_* untuk beda jaringan`;
}
