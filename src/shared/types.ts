export type ServerConfig = {
  host: string;
  port: number;
  pathPrefix: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  dataDir: string;
  /** json | sqlite (default) | firebase */
  adapter: AdapterKind;
  /** Path ke service account Firebase (JSON) */
  firebaseCredentials?: string;
  /** Firebase database URL (Realtime Database), opsional */
  firebaseDatabaseURL?: string;
  /** Max pesan per jendela rate limit */
  rateLimitMax: number;
  /** Jendela rate limit (ms) */
  rateLimitWindowMs: number;
  /** Aktifkan HTTPS (self-signed) untuk akses HP / mic */
  https: boolean;
};

export type AdapterKind = "json" | "sqlite" | "firebase";

export type TokenScope =
  | "*"
  | "chat"
  | "call"
  | "presence"
  | "notify"
  | "monitor"
  | "track"
  | "ai"
  | "terminal"
  | "progress"
  | "job"
  | "sync"
  | "admin";

export type JobStatus = "queued" | "running" | "done" | "failed";

export type GatewayTokenRecord = {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  /** ISO expiry; null = tidak kedaluwarsa */
  expiresAt: string | null;
  /** Scope akses modul */
  scopes: TokenScope[];
  /** Room yang diizinkan; null = semua */
  allowedRooms: string[] | null;
};

export type SessionInfo = {
  id: string;
  tokenId: string;
  connectedAt: string;
  meta: Record<string, unknown>;
};

export type PresenceUser = {
  userId: string;
  name: string;
  status: "online" | "offline";
  rooms?: string[];
};

export type ClientMessage =
  | { type: "ping"; ts?: number }
  | { type: "identify"; name: string; phone?: string }
  | { type: "join"; room: string }
  | { type: "leave"; room: string }
  | { type: "broadcast"; room: string; event: string; data?: unknown }
  | { type: "resume"; sessionId: string }
  | { type: "call.ring"; room: string; mode?: "video" | "audio"; name?: string }
  | { type: "meeting.enter"; room: string; title?: string; asHost?: boolean }
  | { type: "meeting.admit"; room: string; sessionId: string }
  | { type: "meeting.admitAll"; room: string }
  | { type: "meeting.kick"; room: string; sessionId: string }
  | { type: "meeting.setLocked"; room: string; locked: boolean }
  | { type: "meeting.raiseHand"; room: string; raised: boolean }
  | {
      type: "meeting.setMedia";
      room: string;
      mic?: boolean;
      cam?: boolean;
      screen?: boolean;
    }
  | { type: "meeting.leave"; room: string }
  | { type: "meeting.end"; room: string }
  | { type: "sfu.createToken"; room: string; name?: string }
  | {
      type: "push.subscribe";
      subscription: {
        endpoint: string;
        expirationTime?: number | null;
        keys: { p256dh: string; auth: string };
      };
      rooms?: string[];
      page?: "demo2" | "demo3" | "demo8" | "demo9" | "demo10";
    }
  | { type: "push.unsubscribe"; endpoint: string }
  | {
      type: "fcm.register";
      token: string;
      platform?: "android" | "ios" | "unknown";
      phone?: string;
      rooms?: string[];
    }
  | { type: "fcm.unregister"; token: string }
  | { type: "fcm.setRooms"; rooms: string[]; token?: string }
  | { type: "presence.subscribe"; scope: "global" | "room"; room?: string }
  | { type: "presence.unsubscribe"; scope: "global" | "room"; room?: string }
  | { type: "chat.send"; room: string; text: string; to?: string }
  | { type: "chat.typing"; room: string; typing: boolean }
  | { type: "chat.getHistory"; room: string; limit?: number }
  | {
      type: "chat.read";
      room: string;
      messageIds?: string[];
      /** Tandai semua pesan peer di room dengan ts ≤ upToTs sebagai dibaca. */
      upToTs?: string;
    }
  | { type: "feed.join"; room: string }
  | { type: "feed.list"; room: string; limit?: number }
  | { type: "feed.post"; room: string; text?: string; image?: string | null }
  | {
      type: "feed.comment";
      room: string;
      postId: string;
      text: string;
      parentId?: string | null;
    }
  | { type: "feed.like"; room: string; postId: string }
  | { type: "feed.delete"; room: string; postId: string }
  | { type: "feed.share"; room: string; postId: string; text?: string }
  | { type: "feed.follow"; targetFrom: string; targetName: string }
  | { type: "group.create"; name: string }
  | { type: "group.join"; code: string }
  | { type: "group.leave"; groupId: string }
  | { type: "group.kick"; groupId: string; memberKey: string }
  | { type: "group.invite"; groupId: string; peerName: string }
  | { type: "group.sync" }
  | { type: "group.dm"; peerName: string }
  | { type: "blocks.sync"; phone: string; blocked: string[] }
  | {
      type: "notification.send";
      title: string;
      body: string;
      data?: unknown;
      room?: string;
      to?: string;
    }
  | { type: "monitoring.subscribe" }
  | { type: "monitoring.unsubscribe" }
  | { type: "monitoring.get" }
  | { type: "tracking.subscribe"; target: string }
  | { type: "tracking.unsubscribe"; target: string }
  | { type: "tracking.update"; target: string; lat: number; lng: number; meta?: unknown }
  | { type: "ai.start"; prompt: string; streamId?: string }
  | { type: "ai.cancel"; streamId: string }
  | { type: "terminal.exec"; command: string; execId?: string; cwd?: string }
  | { type: "terminal.cancel"; execId: string }
  | {
      type: "agent.run";
      tool: "info" | "claude" | "cursor";
      prompt?: string;
      cwd?: string;
      execId?: string;
    }
  | { type: "agent.cancel"; execId: string }
  | { type: "webrtc.signal"; room: string; signal: "offer" | "answer" | "ice" | "ring" | "hangup" | "reject" | "mute"; payload: unknown; to?: string }
  | { type: "progress.subscribe"; id: string }
  | { type: "progress.unsubscribe"; id: string }
  | {
      type: "progress.update";
      id: string;
      percent: number;
      loaded?: number;
      total?: number;
      meta?: unknown;
    }
  | { type: "progress.done"; id: string; ok?: boolean; meta?: unknown }
  | { type: "job.subscribe"; jobId: string }
  | { type: "job.unsubscribe"; jobId: string }
  | { type: "job.create"; name: string; jobId?: string; data?: unknown }
  | {
      type: "job.set";
      jobId: string;
      status?: JobStatus;
      progress?: number;
      result?: unknown;
      error?: string;
      name?: string;
    }
  | { type: "job.run"; name: string; jobId?: string; steps?: number }
  | { type: "sync.subscribe"; channel: string }
  | { type: "sync.unsubscribe"; channel: string }
  | { type: "sync.set"; channel: string; key: string; value: unknown }
  | { type: "sync.delete"; channel: string; key: string };

export type ServerMessage =
  | { type: "welcome"; sessionId: string; serverTime: string }
  | { type: "pong"; ts: number }
  | { type: "error"; code: string; message: string }
  | { type: "identified"; name: string }
  | { type: "joined"; room: string; peers?: number; peerIds?: string[] }
  | { type: "left"; room: string }
  | { type: "event"; room: string; event: string; data?: unknown; from: string }
  | { type: "resumed"; sessionId: string; rooms: string[] }
  | { type: "call.ringing"; room: string; peers: number }
  | {
      type: "call.incoming";
      room: string;
      name: string;
      mode: "video" | "audio";
      from: string;
    }
  | {
      type: "meeting.state";
      room: string;
      title: string;
      hostId: string;
      locked: boolean;
      participants: Array<{
        sessionId: string;
        name: string;
        status: "waiting" | "in";
        hand: boolean;
        mic: boolean;
        cam: boolean;
        screen: boolean;
      }>;
    }
  | { type: "meeting.admitted"; room: string }
  | { type: "meeting.kicked"; room: string }
  | { type: "meeting.ended"; room: string }
  | {
      type: "sfu.status";
      enabled: boolean;
      url?: string;
      provider: "livekit";
    }
  | {
      type: "sfu.token";
      url: string;
      token: string;
      room: string;
    }
  | { type: "push.vapid"; publicKey: string; enabled: boolean }
  | { type: "push.subscribed"; endpoint: string }
  | { type: "push.unsubscribed"; endpoint: string }
  | { type: "fcm.status"; enabled: boolean; devices?: number }
  | { type: "fcm.registered"; token: string }
  | { type: "fcm.unregistered"; token: string }
  | {
      type: "profile.hint";
      name?: string;
      lastRoom?: string;
      updatedAt?: string;
    }
  | { type: "presence.update"; user: PresenceUser; room?: string }
  | { type: "presence.snapshot"; scope: "global" | "room"; room?: string; users: PresenceUser[] }
  | {
      type: "chat.message";
      room: string;
      text: string;
      from: string;
      name: string;
      to?: string;
      ts: string;
      id?: string;
      /** sent = 1 centang; delivered = terkirim ke peer; read = 2 centang */
      status?: "sent" | "delivered" | "read";
    }
  | {
      type: "chat.history";
      room: string;
      messages: Array<{
        id?: string;
        room: string;
        text: string;
        from: string;
        name: string;
        to?: string;
        ts: string;
        status?: "sent" | "delivered" | "read";
        readAt?: string;
      }>;
    }
  | {
      type: "chat.typing";
      room: string;
      from: string;
      name: string;
      typing: boolean;
    }
  | {
      type: "chat.receipt";
      room: string;
      messageId: string;
      status: "delivered" | "read";
      ts: string;
    }
  | {
      type: "chat.read";
      room: string;
      reader: string;
      readerName: string;
      messageIds: string[];
      ts: string;
    }
  | {
      type: "feed.snapshot";
      room: string;
      posts: Array<{
        id: string;
        room: string;
        from: string;
        name: string;
        authorTokenId?: string;
        text: string;
        image?: string;
        shared?: {
          id: string;
          from: string;
          name: string;
          text: string;
          image?: string;
        };
        ts: string;
        likes: Array<{ from: string; name: string }>;
        comments: Array<{
          id: string;
          postId: string;
          parentId: string | null;
          from: string;
          name: string;
          text: string;
          ts: string;
        }>;
      }>;
    }
  | {
      type: "feed.post.created";
      room: string;
      post: {
        id: string;
        room: string;
        from: string;
        name: string;
        authorTokenId?: string;
        text: string;
        image?: string;
        shared?: {
          id: string;
          from: string;
          name: string;
          text: string;
          image?: string;
        };
        ts: string;
        likes: Array<{ from: string; name: string }>;
        comments: Array<{
          id: string;
          postId: string;
          parentId: string | null;
          from: string;
          name: string;
          text: string;
          ts: string;
        }>;
      };
    }
  | {
      type: "feed.post.deleted";
      room: string;
      postId: string;
    }
  | {
      type: "feed.comment.created";
      room: string;
      postId: string;
      comment: {
        id: string;
        postId: string;
        parentId: string | null;
        from: string;
        name: string;
        text: string;
        ts: string;
      };
    }
  | {
      type: "feed.like.updated";
      room: string;
      postId: string;
      likes: Array<{ from: string; name: string }>;
    }
  | {
      type: "feed.follows";
      following: Array<{ from: string; name: string }>;
    }
  | {
      type: "feed.notify";
      room: string;
      kind: "comment" | "reply" | "post" | "share";
      postId: string;
      from: string;
      name: string;
      text: string;
      ts: string;
    }
  | {
      type: "group.list";
      groups: Array<{
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      }>;
    }
  | {
      type: "group.created";
      group: {
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      };
    }
  | {
      type: "group.joined";
      group: {
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      };
    }
  | {
      type: "group.updated";
      group: {
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      };
    }
  | { type: "group.kicked"; groupId: string; name: string }
  | { type: "group.dm"; room: string; peerName: string }
  | {
      type: "group.invite.queued";
      groupId: string;
      peerName: string;
      code: string;
      group: {
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      };
    }
  | {
      type: "group.invite.delivered";
      groupId: string;
      invitedByName?: string;
      peerName?: string;
      group: {
        id: string;
        name: string;
        code: string;
        ownerKey: string;
        room: string;
        createdAt: string;
        members: Array<{ key: string; name: string; joinedAt: string }>;
      };
    }
  | { type: "blocks.synced"; phone: string; count: number }
  | {
      type: "ice.config";
      iceServers: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
      label: string;
    }
  | {
      type: "notification";
      title: string;
      body: string;
      data?: unknown;
      from?: string;
      room?: string;
      ts: string;
    }
  | {
      type: "monitoring.stats";
      connections: number;
      rooms: number;
      roomList: string[];
      cpuLoad: number[];
      memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
      freemem: number;
      totalmem: number;
      uptimeSec: number;
      ts: string;
    }
  | {
      type: "tracking.update";
      target: string;
      lat: number;
      lng: number;
      meta?: unknown;
      from: string;
      ts: string;
    }
  | {
      type: "tracking.snapshot";
      target: string;
      positions: Array<{ lat: number; lng: number; meta?: unknown; from: string; ts: string }>;
    }
  | { type: "ai.status"; mode: "provider" | "demo"; url?: string; model?: string; keys?: number }
  | { type: "ai.chunk"; streamId: string; index: number; text: string }
  | { type: "ai.done"; streamId: string; reason: "completed" | "cancelled" }
  | { type: "terminal.started"; execId: string; command: string }
  | { type: "terminal.output"; execId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "terminal.exit"; execId: string; code: number | null }
  | {
      type: "agent.status";
      cwd: string;
      roots: string[];
      tools: { claude: boolean; cursor: boolean; claudePath?: string; cursorPath?: string };
    }
  | {
      type: "webrtc.signal";
      room: string;
      signal: "offer" | "answer" | "ice" | "ring" | "hangup" | "reject" | "mute";
      payload: unknown;
      from: string;
      to?: string;
    }
  | {
      type: "progress.snapshot";
      id: string;
      current: {
        id: string;
        percent: number;
        loaded?: number;
        total?: number;
        meta?: unknown;
        from: string;
        ts: string;
        done?: boolean;
        ok?: boolean;
      } | null;
    }
  | {
      type: "progress.update";
      id: string;
      percent: number;
      loaded?: number;
      total?: number;
      meta?: unknown;
      from: string;
      ts: string;
    }
  | {
      type: "progress.done";
      id: string;
      ok: boolean;
      meta?: unknown;
      from: string;
      ts: string;
    }
  | {
      type: "job.snapshot";
      jobId: string;
      job: {
        jobId: string;
        name: string;
        status: JobStatus;
        progress: number;
        result?: unknown;
        error?: string;
        from: string;
        createdAt: string;
        updatedAt: string;
      } | null;
    }
  | {
      type: "job.update";
      jobId: string;
      name: string;
      status: JobStatus;
      progress: number;
      result?: unknown;
      error?: string;
      from: string;
      ts: string;
    }
  | { type: "sync.snapshot"; channel: string; data: Record<string, unknown> }
  | {
      type: "sync.update";
      channel: string;
      key: string;
      value: unknown;
      from: string;
      ts: string;
    }
  | {
      type: "sync.delete";
      channel: string;
      key: string;
      from: string;
      ts: string;
    };
