/* Fleet Command — online play with a friend.
 *
 * Each player keeps one small "status" object: name, fleet, ready flag and
 * the list of actions they have taken. Players just keep sending their
 * latest status to each other; the deterministic engine does the rest.
 *
 * Two transports, picked automatically:
 *  - Claude artifact "room" (when the page runs inside claude.ai)
 *  - PeerJS / WebRTC (when the page is hosted anywhere else, e.g. GitHub Pages)
 */
(function (FC) {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  FC.newRoomCode = function () {
    var s = '';
    for (var k = 0; k < 5; k++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  };
  FC.cleanCode = function (s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  };

  var roomPromise = null;
  function claudeRoom() {
    if (!roomPromise) {
      roomPromise = (window.claude && typeof window.claude.use === 'function')
        ? window.claude.use('room').catch(function () { return null; })
        : Promise.resolve(null);
    }
    return roomPromise;
  }
  FC.claudeRoom = claudeRoom;

  // ---- Claude artifact room transport --------------------------------------------
  function RoomLink(room, code, isHost) {
    this.room = room; this.code = code; this.isHost = isHost;
    this.handlers = { data: [], status: [] };
    this.last = null;
  }
  RoomLink.prototype.start = function () {
    var self = this;
    return this.room.join('fc-' + this.code.toLowerCase()).then(function (r) {
      self.r = r;
      r.onConnection(function (c) { self.emit('status', c ? 'searching' : 'offline'); self.scan(); });
      r.onPeers(function () { self.scan(); }, function () { self.emit('status', 'offline'); });
      if (self.last) self.send(self.last);
    });
  };
  RoomLink.prototype.scan = function () {
    var self = this, found = null;
    (this.r ? this.r.peers() : []).forEach(function (p) {
      if (p.sameTab || !p.presence || !p.presence.fc) return;
      var d = p.presence.fc;
      if (d && d.v === 1 && !!d.h !== self.isHost) found = d;
    });
    if (found) { this.emit('status', 'connected'); this.emit('data', found); }
    else if (this.r && this.r.connected()) this.emit('status', 'searching');
  };
  RoomLink.prototype.send = function (obj) {
    this.last = obj;
    if (this.r) this.r.presence({ fc: obj }).catch(function (e) { console.warn('presence', e); });
  };
  RoomLink.prototype.close = function () { if (this.r) this.r.leave(); this.handlers = { data: [], status: [] }; };

  // ---- PeerJS transport ------------------------------------------------------------
  var peerLib = null;
  function loadPeerJS() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (!peerLib) {
      peerLib = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
        s.onload = function () { res(window.Peer); };
        s.onerror = function () { peerLib = null; rej(new Error('Could not load the networking library. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return peerLib;
  }

  function PeerLink(code, isHost) {
    this.code = code; this.isHost = isHost;
    this.handlers = { data: [], status: [] };
    this.last = null; this.conn = null; this.closed = false;
  }
  PeerLink.prototype.start = function () {
    var self = this;
    return loadPeerJS().then(function (Peer) {
      var id = 'fleetcmd-' + self.code.toLowerCase();
      self.peer = self.isHost ? new Peer(id) : new Peer();
      self.peer.on('error', function (e) {
        if (e.type === 'unavailable-id') self.emit('status', 'code-taken');
        else if (e.type === 'peer-unavailable') { self.emit('status', 'searching'); self.retry(); }
        else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') self.emit('status', 'offline');
        else console.warn('peer', e.type, e);
      });
      self.peer.on('disconnected', function () {
        if (self.closed) return;
        self.emit('status', 'offline');
        setTimeout(function () { if (!self.closed) try { self.peer.reconnect(); } catch (e) { /* ignore */ } }, 2000);
      });
      if (self.isHost) {
        self.peer.on('open', function () { self.emit('status', 'searching'); });
        self.peer.on('connection', function (c) { self.attach(c); });
      } else {
        self.peer.on('open', function () { self.dial(); });
      }
      self.beat = setInterval(function () { if (self.last) self.send(self.last); }, 2500);
    });
  };
  PeerLink.prototype.dial = function () {
    if (this.closed) return;
    this.emit('status', 'searching');
    this.attach(this.peer.connect('fleetcmd-' + this.code.toLowerCase(), { reliable: true }));
  };
  PeerLink.prototype.retry = function () {
    var self = this;
    if (this.isHost || this.retryT) return;
    this.retryT = setTimeout(function () { self.retryT = null; self.dial(); }, 3000);
  };
  PeerLink.prototype.attach = function (c) {
    var self = this;
    if (this.conn && this.conn !== c) { try { this.conn.close(); } catch (e) { /* ignore */ } }
    this.conn = c;
    c.on('open', function () { self.emit('status', 'connected'); if (self.last) c.send(self.last); });
    c.on('data', function (d) { if (d && d.v === 1) self.emit('data', d); });
    c.on('close', function () {
      if (self.conn !== c || self.closed) return;
      self.conn = null;
      self.emit('status', 'searching');
      self.retry();
    });
  };
  PeerLink.prototype.send = function (obj) {
    this.last = obj;
    if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) { /* ignore */ } }
  };
  PeerLink.prototype.close = function () {
    this.closed = true;
    clearInterval(this.beat); clearTimeout(this.retryT);
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.handlers = { data: [], status: [] };
  };

  [RoomLink, PeerLink].forEach(function (L) {
    L.prototype.on = function (ev, fn) { this.handlers[ev].push(fn); };
    L.prototype.emit = function (ev, v) { this.handlers[ev].forEach(function (fn) { fn(v); }); };
  });

  // Resolves a started link. kind is 'room' or 'peer'.
  FC.openLink = function (code, isHost) {
    return claudeRoom().then(function (room) {
      if (!room && window.claude) throw new Error('Online play is not available in this view. Sign in to claude.ai and open the page there, or use the hosted version.');
      var link = room ? new RoomLink(room, code, isHost) : new PeerLink(code, isHost);
      link.kind = room ? 'room' : 'peer';
      return link.start().then(function () { return link; });
    });
  };
})(window.FC = window.FC || {});
