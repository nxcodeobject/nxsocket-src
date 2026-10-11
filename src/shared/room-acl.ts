/**
 * ACL room: daftar room yang diizinkan per token.
 * - null / kosong / ["*"] = semua room
 */
export function normalizeAllowedRooms(input?: string[] | string | null): string[] | null {
  if (!input) return null;
  const raw = Array.isArray(input) ? input : input.split(",");
  const rooms = raw.map((r) => r.trim()).filter(Boolean);
  if (rooms.length === 0 || rooms.includes("*")) return null;
  return rooms;
}

export function canJoinRoom(allowedRooms: string[] | null | undefined, room: string): boolean {
  if (!allowedRooms || allowedRooms.length === 0) return true;
  if (allowedRooms.includes("*")) return true;
  return allowedRooms.includes(room);
}
