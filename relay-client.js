/* Small PeerJS-compatible adapter. Game messages are relayed by the Cloudflare Worker. */
(() => {
  "use strict";
  const handlers = (target) => {
    target._events = {};
    target.on = (name, fn) => { (target._events[name] ||= []).push(fn); return target; };
    target.emit = (name, value) => { for (const fn of target._events[name] || []) { try { fn(value); } catch (e) { console.error(e); } } };
  };
  const base = String(window.BLACKJACK_SIGNALING_URL || "").replace(/\/$/, "");
  class RelayConnection {
    constructor(peer, id, socket, incoming) {
      handlers(this); this.peer = id; this._peer = peer; this._socket = socket;
      this.open = !!incoming; this._incoming = !!incoming;
      if (incoming) queueMicrotask(() => this.emit("open"));
    }
    send(data) {
      if (!this.open) throw new Error("Connection is not open");
      const packet = this._incoming ? { _relay: "send", to: this.peer, data } : { _relay: "send", data };
      this._socket.send(JSON.stringify(packet));
    }
    _data(data) { this.emit("data", data); }
    _close() { if (!this.open) return; this.open = false; this.emit("close"); }
  }
  class RelayPeer {
    constructor(id) {
      handlers(this);
      if (!base || base.includes("YOUR-WORKER-NAME")) {
        queueMicrotask(() => this.emit("error", { type: "server-error", message: "Cloudflare signaling URL is not configured. Complete the Cloudflare deployment steps in README.md." }));
        return;
      }
      this.id = id || ("guest" + crypto.randomUUID().replace(/-/g, "").slice(0, 20));
      this.destroyed = false; this.connections = new Map();
      if (id) this._openSocket("host", id.slice("bjfriends".length));
      else queueMicrotask(() => { if (!this.destroyed) this.emit("open", this.id); });
    }
    _url(path, params) {
      const u = new URL(base);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws/" + path; u.search = new URLSearchParams(params).toString();
      return u.toString();
    }
    _openSocket(role, room, peerId) {
      try {
        const ws = new WebSocket(this._url(role, { room, ...(peerId ? { peer: peerId } : {}) }));
        this._socket = ws;
        ws.addEventListener("open", () => { if (this.destroyed) return ws.close(); this.emit("open", this.id); });
        ws.addEventListener("message", event => {
          let packet; try { packet = JSON.parse(event.data); } catch { return; }
          if (packet._relay === "connection" && role === "host") {
            const conn = new RelayConnection(this, packet.peer, ws, true);
            this.connections.set(packet.peer, conn); this.emit("connection", conn);
          } else if (packet._relay === "data") {
            if (role === "host") this.connections.get(packet.peer)?._data(packet.data);
            else this._activeConnection?._data(packet.data);
          } else if (packet._relay === "close" && role === "host") {
            const conn = this.connections.get(packet.peer); if (conn) { conn._close(); this.connections.delete(packet.peer); }
          } else if (packet._relay === "host-closed") {
            this._activeConnection?._close();
            this.emit("error", { type: "socket-closed", message: "The host closed the room." });
          }
        });
        ws.addEventListener("error", () => this.emit("error", { type: "network", message: "Could not connect to the Cloudflare signaling Worker. Check the configured URL and network permissions." }));
        ws.addEventListener("close", event => {
          if (role === "guest") this._activeConnection?._close();
          if (role === "host") { for (const conn of this.connections.values()) conn._close(); this.connections.clear(); }
          if (!this.destroyed && event.code !== 1000) this.emit("error", { type: "socket-closed", message: event.reason || "Signaling socket closed (" + event.code + ")." });
        });
      } catch (error) { this.emit("error", { type: "network", message: error.message }); }
    }
    connect(hostId) {
      const room = String(hostId).startsWith("bjfriends") ? hostId.slice("bjfriends".length) : "";
      const conn = new RelayConnection(this, hostId, null, false);
      this._activeConnection = conn;
      if (!base || base.includes("YOUR-WORKER-NAME")) {
        queueMicrotask(() => this.emit("error", { type: "server-error", message: "Cloudflare signaling URL is not configured. Complete the Cloudflare deployment steps in README.md." }));
        return conn;
      }
      try {
        const ws = new WebSocket(this._url("guest", { room, peer: this.id }));
        conn._socket = ws; this._socket = ws;
        ws.addEventListener("open", () => { conn.open = true; conn.emit("open"); });
        ws.addEventListener("message", event => {
          let packet; try { packet = JSON.parse(event.data); } catch { return; }
          if (packet._relay === "data") conn._data(packet.data);
          else if (packet._relay === "host-closed") conn._close();
        });
        ws.addEventListener("error", () => { const e = { type: "network", message: "Cannot connect to the signaling Worker. Verify its URL and that this network permits the connection." }; conn.emit("error", e); this.emit("error", e); });
        ws.addEventListener("close", event => { conn._close(); if (!this.destroyed && event.code !== 1000) conn.emit("error", { type: "socket-closed", message: event.reason || "Room connection closed (" + event.code + ")." }); });
      } catch (error) { queueMicrotask(() => conn.emit("error", { type: "network", message: error.message })); }
      return conn;
    }
    reconnect() { if (this.id && !this.destroyed) this._openSocket("host", this.id.slice("bjfriends".length)); }
    destroy() {
      this.destroyed = true;
      for (const conn of this.connections?.values() || []) conn._close();
      this._activeConnection?._close();
      if (this._socket && this._socket.readyState < 2) this._socket.close(1000, "Client left");
      this.emit("close");
    }
  }
  window.BlackjackRelay = RelayPeer;
})();
