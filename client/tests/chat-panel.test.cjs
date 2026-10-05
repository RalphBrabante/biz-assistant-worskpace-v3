const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function loadTypeScript(path, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, { module, exports: module.exports, ...globals });
  return module.exports;
}
const display = loadTypeScript('../src/app/core/chat-display.ts');

function setup(t) {
  const requests = [], timers = new Map(), intervals = new Map(); let serial = 0, effect;
  const sockets = new rx.Subject(), presenceEvents = new rx.Subject();
  let org = 'org-a', user = 'user-a', verified = true;
  function request(kind, args) { const stream = new rx.Subject(); requests.push({ kind, args, stream }); return stream; }
  const deps = {
    auth: { isAuthenticated: () => verified, currentUser: () => ({ id: user, firstName: 'Alice', email: 'alice@example.test', profileImageUrl: '/alice.jpg' }) },
    organizations: { getActiveOrganizationId: () => org },
    sockets: { chatChanged$: sockets, presenceChanged$: presenceEvents, setChatSilent(silent) { this.silent = silent; } },
    sound: { plays: 0, enabled: true, play() { this.plays++; }, toggle() { this.enabled = !this.enabled; } },
    chat: Object.fromEntries(['users', 'presence', 'unread', 'history', 'send', 'read'].map(kind => [kind, (...args) => request(kind, args)])),
  };
  const decorator = () => () => {};
  const module = { exports: {} };
  const mocks = { '@angular/core': { Component: decorator, ViewChild: decorator, HostListener: decorator, inject: key => deps[key], effect: callback => { effect = callback; } },
    '@angular/common': {}, '@angular/forms': {}, rxjs: rx, '../core/auth.service': { AuthService: 'auth' },
    '../core/chat.service': { ChatService: 'chat' }, '../core/organization-context.service': { OrganizationContextService: 'organizations' },
    '../core/socket-notifications.service': { SocketNotificationsService: 'sockets' },
    '../core/chat-sound.service': { ChatSoundService: 'sound' }, '../core/chat-display': display };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/shared/chat-panel.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, { module, exports: module.exports, require: key => mocks[key], Map, Date, crypto: { randomUUID: () => `request-${++serial}` },
    document: { visibilityState: 'visible' }, setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++serial; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) });
  const component = new module.exports.ChatPanelComponent(); effect();
  component.messageList = { nativeElement: { scrollTop: 0, scrollHeight: 100, clientHeight: 300 } };
  t.after(() => component.ngOnDestroy());
  const finish = (kind, response, index = -1) => {
    const req = requests.filter(req => req.kind === kind).at(index); req.stream.next(response); req.stream.complete(); return req;
  };
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const context = (nextOrg, nextUser = user, nextVerified = verified) => { org = nextOrg; user = nextUser; verified = nextVerified; effect(); };
  return { component, requests, sockets, finish, flush, context, intervals, sound: deps.sound, presenceEvents, socketService: deps.sockets };
}
const bob = { id: 'user-b', email: 'bob@example.test', firstName: 'Bob' };
function message(id, overrides = {}) { return { id, organizationId: 'org-a', senderUserId: 'user-b', recipientUserId: 'user-a', body: 'Hello', readAt: null, createdAt: `2026-10-05T01:00:${id.padStart(2, '0')}Z`, ...overrides }; }

test('opening loads only organization members and selecting a user loads their private history', t => {
  const e = setup(t); e.component.toggle(); e.finish('users', { data: [bob] }); e.component.select(bob);
  assert.equal(e.requests.filter(req => req.kind === 'users')[0].args[0], 'org-a');
  assert.deepEqual(e.requests.filter(req => req.kind === 'history')[0].args.slice(0, 2), ['org-a', 'user-b']);
  e.finish('history', { data: [message('1')], meta: { hasMore: true } }); e.flush();
  assert.equal(e.component.messages.length, 1); assert.equal(e.component.hasOlder, true);
  assert.equal(e.requests.filter(req => req.kind === 'read')[0].args[2], '1');
});
test('duplicate clicks are locked; failed sends preserve the draft and reuse the request ID', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob); e.component.draft = 'Hello';
  e.component.send(); e.component.send();
  const sent = e.requests.filter(req => req.kind === 'send'); assert.equal(sent.length, 1);
  sent[0].stream.error({ status: 0 }); assert.equal(e.component.draft, 'Hello'); assert.equal(e.component.sending, false);
  e.component.send(); const retry = e.requests.filter(req => req.kind === 'send')[1]; assert.equal(retry.args[3], sent[0].args[3]);
  retry.stream.next({ data: message('2', { senderUserId: 'user-a', recipientUserId: 'user-b' }) }); retry.stream.complete();
  assert.equal(e.component.draft, ''); assert.equal(e.component.messages.length, 1);
});
test('context or identity changes cancel requests, clear private data and reject stale responses', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob); e.component.draft = 'Private draft';
  const history = e.requests.find(req => req.kind === 'history');
  e.context('org-b'); assert.equal(history.stream.observers.length, 0);
  history.stream.next({ data: [message('1')] }); assert.equal(e.component.messages.length, 0);
  assert.equal(e.component.draft, ''); assert.equal(e.component.selected, undefined); assert.equal(e.component.open, false);
  e.context('org-b', 'another-user'); assert.equal(e.component.unreadTotal, 0);
});
test('live invalidations ignore other organizations and refresh via authenticated history', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob); e.finish('history', { data: [] });
  const before = e.requests.length; e.sockets.next({ organizationId: 'org-b' }); assert.equal(e.requests.length, before);
  e.sockets.next({ organizationId: 'org-a' }); assert.equal(e.requests.at(-1).kind, 'history');
  e.component.close(); const histories = e.requests.filter(req => req.kind === 'history').length;
  for (const tick of e.intervals.values()) tick();
  assert.equal(e.requests.filter(req => req.kind === 'history').length, histories);
});
test('history paging deduplicates messages and a removed membership clears displayed messages', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob);
  e.finish('history', { data: [message('2'), message('3')], meta: { hasMore: true } });
  e.component.loadMessages(true); e.finish('history', { data: [message('1'), message('2')], meta: { hasMore: false } });
  assert.equal(e.component.messages.map(row => row.id).join(','), '1,2,3');
  assert.equal(e.component.hasOlder, false);
  e.component.loadMessages(); e.requests.filter(req => req.kind === 'history').at(-1).stream.error({ status: 403, error: { message: 'Membership removed' } });
  assert.equal(e.component.messages.length, 0); assert.equal(e.component.error, 'Membership removed');
});
test('read acknowledgement never marks a message that arrived after the displayed boundary', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob);
  e.finish('history', { data: [message('1')] }); e.flush();
  e.component.loadMessages(); e.finish('history', { data: [message('1'), message('2')] });
  e.finish('read', {});
  assert.ok(e.component.messages[0].readAt); assert.equal(e.component.messages[1].readAt, null);
});
test('rapid member searches cancel obsolete results and cleanup stops subscriptions and polling', t => {
  const e = setup(t); e.component.toggle(); const old = e.requests.find(req => req.kind === 'users');
  e.component.search = 'Bob'; e.component.searchChanged(); assert.equal(old.stream.observers.length, 0);
  e.flush(); e.finish('users', { data: [bob] }); assert.equal(e.component.users[0].id, 'user-b');
  e.component.ngOnDestroy(); assert.equal(e.intervals.size, 0); assert.equal(e.sockets.observers.length, 0);
});

test('a sent message cannot move the history cursor past incoming messages that have not been fetched', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob);
  e.finish('history', { data: [message('1')] });
  e.component.draft = 'Reply'; e.component.send();
  e.finish('send', { data: message('3', { senderUserId: 'user-a', recipientUserId: 'user-b', body: 'Reply' }) });
  e.component.loadMessages();
  assert.equal(e.requests.filter(req => req.kind === 'history').at(-1).args[3], '1');
  e.finish('history', { data: [message('2'), message('3', { senderUserId: 'user-a', recipientUserId: 'user-b', body: 'Reply' })] });
  assert.equal(e.component.messages.map(row => row.id).join(','), '1,2,3');
});

function unread(id, createdAt = '2026-10-06T12:00:00Z', total = 0) {
  return { data: { total, counts: {}, latestIncoming: id ? { id, createdAt } : null } };
}
test('sounds are silent on initial load and chime once for new incoming messages even with the panel closed', t => {
  const e = setup(t); e.finish('unread', unread('1', undefined, 3));
  assert.equal(e.sound.plays, 0);
  e.sockets.next({ organizationId: 'org-b' }); assert.equal(e.requests.length, 1);
  e.sockets.next({ organizationId: 'org-a' }); e.finish('unread', unread('2'));
  assert.equal(e.component.open, false); assert.equal(e.sound.plays, 1);
  // Own sends and read receipts invalidate chat, but leave the latest incoming unchanged.
  e.sockets.next({ organizationId: 'org-a' }); e.finish('unread', unread('2'));
  assert.equal(e.sound.plays, 1);
  e.context('org-b'); e.finish('unread', unread('9')); assert.equal(e.sound.plays, 1);
});
test('membership changes and failed unread requests do not replay historical sounds', t => {
  const e = setup(t); e.finish('unread', unread('2'));
  for (const response of [unread('1'), unread(null), unread('2')]) {
    e.component.refreshUnread(); e.finish('unread', response);
  }
  e.component.refreshUnread(); e.requests.at(-1).stream.error({ status: 0 });
  e.component.refreshUnread(); e.finish('unread', unread('2'));
  assert.equal(e.sound.plays, 0);
  e.component.refreshUnread(); e.finish('unread', unread('3', '2026-10-06T12:01:00Z'));
  assert.equal(e.sound.plays, 1);
});
test('an invalidation during an unread request queues a refresh so incoming messages are not lost', t => {
  const e = setup(t); e.finish('unread', unread(null));
  e.sockets.next({ organizationId: 'org-a' });
  e.sockets.next({ organizationId: 'org-a' });
  assert.equal(e.requests.length, 2);
  e.finish('unread', unread(null)); assert.equal(e.requests.length, 3);
  e.finish('unread', unread('1')); assert.equal(e.sound.plays, 1);
});
test('member avatars prefer CDN photos, retry the original and fall back to initials and name', t => {
  const e = setup(t), member = { ...bob, lastName: 'Smith', profileImageCdnUrl: '/cdn.jpg', profileImageUrl: '/original.jpg' };
  assert.equal(e.component.photo(member), '/cdn.jpg');
  e.component.photoFailed(member, { target: { getAttribute: () => '/cdn.jpg' } });
  assert.equal(e.component.photo(member), '/original.jpg');
  e.component.photoFailed(member, { target: { getAttribute: () => '/original.jpg' } });
  assert.equal(e.component.photo(member), ''); assert.equal(e.component.initials(member), 'BS');
  assert.equal(e.component.name(member), 'Bob Smith');
  assert.equal(e.component.photo(bob), ''); assert.equal(e.component.initials(bob), 'B');
  assert.equal(display.chatInitials({ email: 'mary.smith@example.test' }), 'MS');
  assert.equal(display.chatInitials({ email: '', firstName: '  Mary Jane  ' }), 'MJ');
  assert.equal(display.chatInitials({ email: '' }), '?');
});
test('message times use relative minutes and hours before switching to date and local time after 24 hours', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const ago = seconds => new Date(now - seconds * 1000).toISOString();
  for (const [seconds, label] of [[0, 'Just now'], [59, 'Just now'], [60, '1 minute ago'], [120, '2 minutes ago'],
    [3600, '1 hour ago'], [7200, '2 hours ago'], [86399, '23 hours ago']]) {
    assert.equal(display.chatTimestamp(ago(seconds), now), label);
  }
  for (const seconds of [86400, 172800]) {
    assert.equal(display.chatTimestamp(ago(seconds), now), display.chatDateTime(ago(seconds)));
    assert.match(display.chatTimestamp(ago(seconds), now), /2026/);
    assert.match(display.chatTimestamp(ago(seconds), now), /\d+:\d{2}/);
  }
  assert.equal(display.chatTimestamp(ago(-60), now), 'Just now');
  assert.equal(display.chatTimestamp('invalid', now), '');
});

test('the member sidebar groups verified presence and keeps offline members available for conversation', t => {
  const e = setup(t); e.component.toggle();
  const users = [bob, { id: 'user-c', email: 'c@example.test' }, { id: 'user-d', email: 'd@example.test' }, { id: 'user-e', email: 'e@example.test' }];
  e.finish('users', { data: users }); e.finish('presence', { data: [
    { userId: bob.id, status: 'online' }, { userId: 'user-c', status: 'away' }, { userId: 'user-d', status: 'silent' },
  ] });
  assert.equal(e.component.memberGroups.map(group => group.label).join(','), 'Online,Away,Silent,Offline');
  assert.equal(e.component.status(users[3]), 'offline');
  e.component.select(users[3]); assert.equal(e.component.users.length, 4);
  assert.equal(e.component.selected.id, 'user-e');
  assert.equal(e.component.sender(message('1')).id, 'user-e');
  assert.equal(e.component.photo(e.component.sender(message('2', { senderUserId: 'user-a' }))), '/alice.jpg');
});
test('presence invalidations are organization scoped and stale results cannot survive an organization switch', t => {
  const e = setup(t); e.component.toggle(); e.finish('presence', { data: [{ userId: bob.id, status: 'online' }] });
  const before = e.requests.length;
  e.presenceEvents.next({ organizationId: 'org-b' }); assert.equal(e.requests.length, before);
  e.presenceEvents.next({ organizationId: 'org-a' }); const pending = e.requests.at(-1);
  e.context('org-b'); pending.stream.next({ data: [{ userId: bob.id, status: 'online' }] });
  assert.equal(e.component.presenceAvailable, false); assert.equal(e.component.status(bob), 'unknown');
  e.component.toggleSound(); assert.equal(e.socketService.silent, true);
  e.component.ngOnDestroy(); assert.equal(e.presenceEvents.observers.length, 0);
});
test('reply sends preserve the selected target and retry ID on failure, then clear the quote on success', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob);
  e.component.startReply(message('1')); e.component.draft = 'Answer'; e.component.send();
  const first = e.requests.filter(req => req.kind === 'send').at(-1);
  assert.equal(first.args[4], '1');
  e.component.cancelReply(); assert.equal(e.component.reply.id, '1');
  first.stream.error({ status: 0 }); assert.equal(e.component.reply.id, '1'); assert.equal(e.component.draft, 'Answer');
  e.component.send(); const retry = e.requests.filter(req => req.kind === 'send').at(-1);
  assert.equal(retry.args[3], first.args[3]); assert.equal(retry.args[4], '1');
  e.finish('send', { data: message('2', { senderUserId: 'user-a', recipientUserId: bob.id, replyToMessageId: '1', replyTo: message('1') }) });
  assert.equal(e.component.reply, undefined); assert.equal(e.component.messages[0].replyTo.id, '1');
});
test('changing or cancelling a reply after a failed send starts a new request; switching conversations clears the reply', t => {
  const e = setup(t); e.component.toggle(); e.component.select(bob); e.component.startReply(message('1')); e.component.draft = 'Answer';
  e.component.send(); const first = e.requests.filter(req => req.kind === 'send').at(-1); first.stream.error({ status: 0 });
  e.component.cancelReply(); e.component.send(); const next = e.requests.filter(req => req.kind === 'send').at(-1);
  assert.notEqual(next.args[3], first.args[3]); assert.equal(next.args[4], null); next.stream.error({ status: 0 });
  e.component.startReply(message('1')); e.component.select({ id: 'user-c', email: 'c@example.test' });
  assert.equal(e.component.reply, undefined); assert.equal(e.component.draft, '');
});

function soundSetup(options = {}) {
  const listeners = new Map(), storage = new Map(options.muted ? [['teamChatSound', 'off']] : []), tones = [];
  let now = 1000, closed = false, contexts = 0;
  const audio = {
    state: 'running', currentTime: 1, destination: {},
    resume: async () => {}, close: async () => { closed = true; },
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createOscillator: () => {
      const tone = { frequency: { setValueAtTime(value) { tone.frequencyValue = value; } }, connect() {}, disconnect() {}, start() { tones.push(tone); }, stop() {} };
      return tone;
    },
  };
  const window = {
    AudioContext: options.unsupported ? undefined : function () { contexts++; return audio; },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
  };
  const localStorage = { getItem: key => { if (options.blockedStorage) throw Error('Storage blocked'); return storage.get(key); },
    setItem: (key, value) => { if (options.blockedStorage) throw Error('Storage blocked'); storage.set(key, value); } };
  const { ChatSoundService } = loadTypeScript('../src/app/core/chat-sound.service.ts', {
    require: () => ({ Injectable: () => () => {} }), window, localStorage, Date: class extends Date { static now() { return now; } },
  });
  return { sound: new ChatSoundService(), listeners, storage, tones, audio, tick: () => { now += 1000; },
    get contexts() { return contexts; }, get closed() { return closed; } };
}
test('notification audio waits for browser interaction, respects mute and throttles bursts', () => {
  const e = soundSetup(); e.sound.play(); assert.equal(e.contexts, 0); assert.equal(e.tones.length, 0);
  e.listeners.get('pointerdown')(); assert.equal(e.listeners.size, 0);
  e.sound.play(); assert.equal(e.tones.length, 2); assert.equal(e.tones[0].frequencyValue, 660);
  e.sound.play(); assert.equal(e.tones.length, 2);
  e.tick(); e.sound.toggle(); e.sound.play(); assert.equal(e.tones.length, 2);
  assert.equal(e.storage.get('teamChatSound'), 'off');
  e.sound.toggle(); e.sound.play(); assert.equal(e.tones.length, 4);
  e.tones.forEach(tone => tone.onended()); e.sound.ngOnDestroy(); assert.equal(e.closed, true);
});
test('persisted mute, unavailable audio and disabled storage keep chat usable', () => {
  const muted = soundSetup({ muted: true }); muted.listeners.get('keydown')(); muted.sound.play();
  assert.equal(muted.contexts, 0); muted.sound.ngOnDestroy();
  const unsupported = soundSetup({ unsupported: true }); unsupported.listeners.get('pointerdown')();
  assert.doesNotThrow(() => unsupported.sound.play()); unsupported.sound.ngOnDestroy();
  const blocked = soundSetup({ blockedStorage: true }); assert.doesNotThrow(() => blocked.sound.toggle());
  blocked.sound.ngOnDestroy(); assert.equal(blocked.listeners.size, 0);
});

function socketSetup() {
  let now = 1000;
  const listeners = new Map(), intervals = new Map(), emitted = [], sockets = [];
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  function io() {
    const handlers = new Map(), socket = { connected: true, on: (name, fn) => handlers.set(name, fn),
      emit: (name, data) => emitted.push({ name, data }), disconnect() { this.connected = false; }, handlers };
    sockets.push(socket); return socket;
  }
  const { SocketNotificationsService } = loadTypeScript('../src/app/core/socket-notifications.service.ts', {
    require: name => name === '@angular/core' ? { Injectable: () => () => {} } : name === 'socket.io-client' ? { io } : rx,
    window, document, Date: class extends Date { static now() { return now; } },
    setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
  });
  const service = new SocketNotificationsService(); service.connect('token', 'org-a'); sockets[0].handlers.get('connect')();
  return { service, sockets, emitted, intervals, listeners, document, advance: ms => { now += ms; } };
}
test('socket heartbeats report online, idle/hidden away and silent, then clean up on reconnect and destroy', () => {
  const e = socketSetup(); assert.equal(e.emitted.at(-1).data.status, 'online');
  assert.deepEqual(Object.keys(e.emitted.at(-1).data), ['status']);
  e.advance(300000); for (const tick of e.intervals.values()) tick(); assert.equal(e.emitted.at(-1).data.status, 'away');
  e.listeners.get('pointerdown')(); assert.equal(e.emitted.at(-1).data.status, 'online');
  e.document.visibilityState = 'hidden'; e.listeners.get('visibilitychange')(); assert.equal(e.emitted.at(-1).data.status, 'away');
  e.service.setChatSilent(true); assert.equal(e.emitted.at(-1).data.status, 'silent');
  e.service.connect('another-token', 'org-b'); assert.equal(e.sockets[0].connected, false); assert.equal(e.intervals.size, 1);
  e.service.ngOnDestroy(); assert.equal(e.intervals.size, 0); assert.equal(e.listeners.size, 0);
});
test('presence socket invalidations carry organization metadata without exposing private content', () => {
  const e = socketSetup(), events = []; const sub = e.service.presenceChanged$.subscribe(event => events.push(event));
  e.sockets[0].handlers.get('chat.presence.changed')({ organizationId: 'org-a' });
  e.sockets[0].handlers.get('chat.presence.changed')(null); assert.equal(events.length, 1);
  assert.equal(events[0].organizationId, 'org-a'); sub.unsubscribe(); e.service.ngOnDestroy();
});
