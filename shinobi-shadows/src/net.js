// Online co-op for two players over a direct WebRTC connection (PeerJS).
// The host's free PeerJS cloud account only introduces the two browsers; game
// data then flows peer to peer. The host runs the guards; each player runs their
// own shinobi and sends its state to the other.
//
// Add ?net=local to the URL to connect two tabs in the same browser instead
// (handy for testing without the internet).

const PREFIX = 'shinobi-shadows-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L or O: easy to read out loud

function randomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

let peerLib = null;
function loadPeerJS() {
  if (window.peerjs) return Promise.resolve(window.peerjs.Peer);
  if (peerLib) return peerLib;
  peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => resolve(window.peerjs.Peer);
    s.onerror = () => { peerLib = null; reject(new Error('Could not load the networking library')); };
    document.head.appendChild(s);
  });
  return peerLib;
}

/** Same-browser transport over a BroadcastChannel (?net=local). */
class LocalLink {
  constructor(code, role) {
    this.ch = new BroadcastChannel(PREFIX + code);
    this.role = role;
    this.onmessage = null;
    this.onopen = null;
    this.onclose = null;
    this.open = false;
    this.ch.onmessage = (e) => {
      const { from, msg } = e.data;
      if (from === role) return;
      if (msg.t === '__hello') {
        if (!this.open) { this.open = true; this.ch.postMessage({ from: role, msg: { t: '__hello' } }); this.onopen?.(); }
        return;
      }
      if (msg.t === '__bye') { this.open = false; this.onclose?.(); return; }
      this.onmessage?.(msg);
    };
    if (role === 'guest') {
      const hello = () => { if (!this.open) { this.ch.postMessage({ from: role, msg: { t: '__hello' } }); setTimeout(hello, 400); } };
      hello();
    }
  }
  send(msg) { this.ch.postMessage({ from: this.role, msg }); }
  close() { try { this.send({ t: '__bye' }); this.ch.close(); } catch { /* already closed */ } }
}

export class Net {
  /** handlers: { onConnect(), onMessage(msg), onDisconnect(reason), onStatus(text) } */
  constructor(handlers) {
    this.h = handlers;
    this.role = null; // 'host' | 'guest'
    this.code = null;
    this.peer = null;
    this.conn = null;
    this.connected = false;
    this.local = new URLSearchParams(location.search).get('net') === 'local';
    this.sent = 0;
  }

  get isHost() { return this.role === 'host'; }
  get isGuest() { return this.role === 'guest'; }

  status(text) { this.h.onStatus?.(text); }

  async host() {
    this.role = 'host';
    if (this.local) {
      this.code = randomCode();
      this.attachLocal(new LocalLink(this.code, 'host'));
      return this.code;
    }
    const Peer = await loadPeerJS();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode();
      try {
        await new Promise((resolve, reject) => {
          const peer = new Peer(PREFIX + code, { debug: 0 });
          const fail = (err) => { peer.destroy(); reject(err); };
          peer.once('open', () => { peer.off('error', fail); this.peer = peer; resolve(); });
          peer.once('error', fail);
        });
        this.code = code;
        break;
      } catch (err) {
        if (err?.type !== 'unavailable-id') throw friendly(err);
      }
    }
    if (!this.peer) throw new Error('Could not create a room, try again');
    this.peer.on('connection', (conn) => {
      if (this.conn) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
      this.attach(conn);
    });
    this.peer.on('disconnected', () => { if (!this.closed) this.peer.reconnect(); });
    this.peer.on('error', (err) => { if (!this.connected) this.status(friendly(err).message); });
    return this.code;
  }

  async join(code) {
    this.role = 'guest';
    this.code = code.toUpperCase().replace(/[^A-Z]/g, '');
    if (this.code.length !== 4) throw new Error('Room codes are 4 letters');
    if (this.local) {
      this.attachLocal(new LocalLink(this.code, 'guest'));
      return this.waitOpen();
    }
    const Peer = await loadPeerJS();
    await new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      peer.once('open', () => { this.peer = peer; resolve(); });
      peer.once('error', (err) => { peer.destroy(); reject(friendly(err)); });
    });
    this.peer.on('error', (err) => { if (!this.connected) this.failJoin?.(friendly(err)); });
    this.attach(this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' }));
    return this.waitOpen();
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      if (this.connected) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('No answer from that room. Check the code, and that your partner is still hosting.')), 15000);
      this.failJoin = (err) => { clearTimeout(timer); reject(err); };
      this.joined = () => { clearTimeout(timer); resolve(); };
    });
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.opened());
    conn.on('data', (msg) => this.receive(msg));
    conn.on('close', () => this.lost('Your partner disconnected'));
    conn.on('error', () => this.lost('The connection dropped'));
    // ICE failure (e.g. a strict mobile network) shows up on the peer connection.
    const watch = () => {
      const pc = conn.peerConnection;
      if (!pc) { setTimeout(watch, 200); return; }
      pc.addEventListener('iceconnectionstatechange', () => {
        if (pc.iceConnectionState === 'failed') this.lost('Could not reach your partner (network blocked the connection)');
      });
    };
    watch();
  }

  attachLocal(link) {
    this.conn = link;
    link.onopen = () => this.opened();
    link.onmessage = (msg) => this.receive(msg);
    link.onclose = () => this.lost('Your partner disconnected');
  }

  opened() {
    if (this.connected) return;
    this.connected = true;
    this.lastHeard = performance.now();
    // Keep-alive on a timer rather than the render loop, which stops when the tab is hidden.
    this.pinger = setInterval(() => this.tick(), 1000);
    this.joined?.();
    this.h.onConnect?.();
  }

  receive(msg) {
    this.lastHeard = performance.now();
    if (msg.t === 'full') { this.failJoin?.(new Error('That room already has two players')); return; }
    if (msg.t === 'ping') return;
    this.h.onMessage?.(msg);
  }

  send(msg) {
    if (!this.connected || !this.conn) return;
    try { this.conn.send(msg); } catch { /* channel closing */ }
  }

  /** Keeps the link alive and notices a partner who has gone silent. */
  tick() {
    if (!this.connected) return;
    this.send({ t: 'ping' });
    if (performance.now() - this.lastHeard > (this.local ? 90000 : 20000)) this.lost('Lost contact with your partner');
  }

  lost(reason) {
    if (this.closed) return;
    const was = this.connected;
    this.connected = false;
    this.close();
    if (was) this.h.onDisconnect?.(reason);
    else this.failJoin?.(new Error(reason));
  }

  close() {
    this.closed = true;
    this.connected = false;
    clearInterval(this.pinger);
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null;
    this.peer = null;
  }
}

function friendly(err) {
  const type = err?.type;
  if (type === 'peer-unavailable') return new Error('No room with that code. Check it with your partner.');
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return new Error('Could not reach the matchmaking server. Check your connection.');
  if (type === 'browser-incompatible') return new Error('This browser does not support online play.');
  return err instanceof Error ? err : new Error(String(err?.message || err));
}
