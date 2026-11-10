export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "blackjack-signaling", transport: "websocket-relay" });
    }
    const match = url.pathname.match(/^\/ws\/(host|guest)$/);
    if (!match) return new Response("Not found", { status: 404 });
    const room = (url.searchParams.get("room") || "").toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room)) return new Response("Invalid room code", { status: 400 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const id = env.ROOMS.idFromName(room);
    return env.ROOMS.get(id).fetch(request);
  }
};

export class Room {
  constructor(state) {
    this.state = state;
    this.host = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.pathname.split("/").pop();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const peer = role === "guest" ? (url.searchParams.get("peer") || "") : "";
    if (role === "guest" && !/^[a-z0-9_-]{5,40}$/i.test(peer)) {
      return new Response("Invalid guest id", { status: 400 });
    }
    const sockets = this.state.getWebSockets();
    const host = sockets.find(ws => ws.deserializeAttachment()?.role === "host" && ws.readyState === WebSocket.OPEN);
    if (role === "host" && host && host.readyState === WebSocket.OPEN) {
      return new Response("Room already has a host", { status: 409 });
    }
    if (role === "guest") {
      if (!host || host.readyState !== WebSocket.OPEN) return new Response("Host is offline", { status: 404 });
      const guests = sockets.filter(ws => ws.deserializeAttachment()?.role === "guest" && ws.readyState === WebSocket.OPEN);
      if (guests.length >= 5) return new Response("Room is full", { status: 409 });
      if (guests.some(ws => ws.deserializeAttachment()?.peer === peer)) return new Response("Guest id already connected", { status: 409 });
    }
    server.serializeAttachment({ role, peer });
    this.state.acceptWebSocket(server);
    if (role === "guest") {
      try { host.send(JSON.stringify({ _relay: "connection", peer })); }
      catch { server.close(1011, "Host unavailable"); }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const meta = ws.deserializeAttachment() || {};
    let packet;
    try { packet = JSON.parse(message); } catch { return; }
    const sockets = this.state.getWebSockets();
    if (meta.role === "guest") {
      const host = sockets.find(s => s.deserializeAttachment()?.role === "host" && s.readyState === WebSocket.OPEN);
      if (host) host.send(JSON.stringify({ _relay: "data", peer: meta.peer, data: packet }));
      return;
    }
    if (meta.role !== "host" || packet?._relay !== "send") return;
    const guests = sockets.filter(s => s.deserializeAttachment()?.role === "guest" && s.readyState === WebSocket.OPEN);
    if (packet.to) {
      const target = guests.find(s => s.deserializeAttachment()?.peer === packet.to);
      if (target) target.send(JSON.stringify({ _relay: "data", data: packet.data }));
    } else {
      for (const guest of guests) guest.send(JSON.stringify({ _relay: "data", data: packet.data }));
    }
  }

  webSocketClose(ws, code, reason) {
    const meta = ws.deserializeAttachment() || {};
    if (meta.role === "host") {
      for (const guest of this.state.getWebSockets()) {
        if (guest !== ws && guest.readyState === WebSocket.OPEN) {
          try { guest.send(JSON.stringify({ _relay: "host-closed" })); } catch {}
          guest.close(1001, "Host left the room");
        }
      }
    } else if (meta.role === "guest") {
      const host = this.state.getWebSockets().find(s => s.deserializeAttachment()?.role === "host" && s.readyState === WebSocket.OPEN);
      if (host) {
        try { host.send(JSON.stringify({ _relay: "close", peer: meta.peer, code, reason })); } catch {}
      }
    }
  }

  webSocketError(ws) {
    try { ws.close(1011, "WebSocket error"); } catch {}
  }
}
