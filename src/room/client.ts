import { create } from 'zustand';
import type { MediaTrack, RoomMessage, RoomSnapshot, RoomUser } from '../domain/media';
import { getSetting, setSetting } from '../lib/db';
import { normalizeMedia } from '../lib/api';
import { usePlaybackStore } from '../store/playback';

type RoomStatus = 'disconnected' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error';

// Every relayed message carries the server's `server_time` stamp. Clients and
// especially the host run on arbitrary local clocks, so comparing raw values
// against `Date.now()` lands guests at wrong positions. We can't ping the
// server, so instead we track the smallest observed one-way transit; the
// excess over that floor approximates true elapsed time no matter how skewed
// either clock is.
let transitFloor: number | undefined;
function elapsedSeconds(serverStampMs: number): number {
  const transit = Date.now() - serverStampMs;
  if (transitFloor === undefined || transit < transitFloor) transitFloor = transit;
  return Math.max(0, transit - transitFloor) / 1000;
}

let reconnectAttempts = 0;
let reconnectTimer: number | undefined;
const MAX_RECONNECT_ATTEMPTS = 8;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

interface RoomPreferences { username: string; server: string }
interface RoomState extends RoomPreferences {
  status: RoomStatus;
  role?: 'host' | 'guest';
  code: string;
  userId: string;
  users: RoomUser[];
  messages: RoomMessage[];
  requests: Array<{ id: string; username: string }>;
  allowParticipantControl: boolean;
  error?: string;
  socket?: WebSocket;
  suppressBroadcast: boolean;
  bootstrap: () => Promise<void>;
  setPreferences: (patch: Partial<RoomPreferences>) => Promise<void>;
  createRoom: () => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  approve: (id: string, approved: boolean) => void;
  sendChat: (message: string) => void;
  setParticipantControl: (enabled: boolean) => void;
  broadcastPlayback: (action: string) => void;
}

function send(socket: WebSocket | undefined, type: string, payload: unknown = {}): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try { socket.send(JSON.stringify({ type, payload })); return true; } catch { return false; }
}

function usersFrom(value: unknown): RoomUser[] {
  return list(value).map(record).map((item) => ({
    id: text(item.user_id ?? item.id),
    name: text(item.username ?? item.name) || 'Listener',
    host: Boolean(item.is_host ?? item.host),
    connected: item.is_connected !== false && item.connected !== false,
  })).filter((user) => user.id);
}

function tracksFrom(value: unknown): MediaTrack[] {
  return list(value).map((item) => normalizeMedia(item, 'song')).filter((item): item is MediaTrack => Boolean(item && 'source' in item));
}

function wireTrack(track: MediaTrack | null): RecordValue | undefined {
  if (!track || track.source === 'local') return undefined;
  return { id: track.id, title: track.title, artist: track.artist, album: track.album || '', duration: Math.round(track.durationSeconds || 0), thumbnail: track.artwork || '' };
}

// Applying remote state must never echo back as a broadcast. A counter (not a
// 250 ms flag window) scopes suppression to the synchronous application, so a
// host tapping pause+play right after a remote update still broadcasts both.
let applyingRemote = 0;
function applyRemote<T>(fn: () => T): T {
  applyingRemote += 1;
  if (applyingRemote === 1) useRoomStore.setState({ suppressBroadcast: true });
  try { return fn(); } finally {
    applyingRemote -= 1;
    if (applyingRemote === 0) useRoomStore.setState({ suppressBroadcast: false });
  }
}

let lastRoom: { code: string } | undefined;

function scheduleReconnect(): void {
  if (!lastRoom || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    useRoomStore.setState({ status: 'error', socket: undefined, error: 'The connection was lost and the room could not be rejoined. Start or join the room again.' });
    return;
  }
  reconnectAttempts += 1;
  const delay = Math.min(15_000, 750 * 2 ** reconnectAttempts);
  useRoomStore.setState({ status: 'reconnecting', socket: undefined, error: undefined });
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    if (lastRoom) connect('join_room', lastRoom.code, true);
  }, delay);
}

function connect(action: 'create_room' | 'join_room', code?: string, resume = false): void {
  const state = useRoomStore.getState();
  state.socket?.close();
  let socket: WebSocket;
  try { socket = new WebSocket(state.server); }
  catch { useRoomStore.setState({ status: 'error', error: 'The room server address is not valid.' }); return; }
  useRoomStore.setState({
    socket,
    status: resume ? 'reconnecting' : 'connecting',
    error: undefined,
    ...(resume ? {} : { role: undefined, code: code?.trim().toUpperCase() || '', userId: '', users: [], messages: [], requests: [], allowParticipantControl: false }),
  });
  // A join sits in 'waiting' until the host approves — forever, if the host is
  // away. Give up cleanly instead of leaving the guest on a dead-end spinner.
  let waitingTimeout: number | undefined;
  const timeout = window.setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      socket.close();
      useRoomStore.setState({ status: 'error', error: 'The room server did not respond.' });
    }
  }, 10_000);
  socket.addEventListener('open', () => {
    window.clearTimeout(timeout);
    send(socket, action, action === 'create_room'
      ? { username: state.username }
      : { username: state.username, room_code: code?.trim().toUpperCase() });
    if (action === 'join_room') {
      useRoomStore.setState({ status: 'waiting' });
      waitingTimeout = window.setTimeout(() => {
        if (useRoomStore.getState().status === 'waiting') {
          socket.close();
          useRoomStore.setState({ status: 'error', socket: undefined, error: 'The host is not responding right now. Check the code or try again in a moment.' });
        }
      }, 30_000);
    }
  });
  socket.addEventListener('message', (event) => {
    if (useRoomStore.getState().socket !== socket) return;
    handleMessage(event.data);
  });
  socket.addEventListener('error', () => useRoomStore.setState({ status: 'error', error: 'The room connection failed.' }));
  socket.addEventListener('close', () => {
    window.clearTimeout(timeout);
    window.clearTimeout(waitingTimeout);
    const room = useRoomStore.getState();
    if (room.socket !== socket) return;
    // Unexpected drop while in a room: try to rejoin with the same code
    // (covers host migration too — the server emits host_changed).
    if (room.status === 'connected' || room.status === 'reconnecting' || room.role) {
      scheduleReconnect();
      return;
    }
    if (room.status !== 'disconnected') useRoomStore.setState({ status: 'disconnected', socket: undefined });
  });
}

function applySnapshot(value: unknown): void {
  const snapshot = record(value);
  const tracks = tracksFrom(snapshot.queue);
  const current = record(snapshot.current_track);
  const currentId = text(current.id ?? snapshot.current_track_id);
  const playback = usePlaybackStore.getState();
  // The snapshot's stamps come from the server/host clock; measuring them
  // against the transit floor removes local clock skew from the math.
  if (typeof snapshot.server_time === 'number') elapsedSeconds(snapshot.server_time);
  playback.syncQueue(tracks, currentId || tracks[0]?.id);
  if (tracks.length && typeof snapshot.position === 'number') {
    const elapsed = snapshot.is_playing && typeof snapshot.last_update === 'number' ? elapsedSeconds(snapshot.last_update) : 0;
    usePlaybackStore.getState().seek(snapshot.position / 1000 + elapsed);
  }
  if (tracks.length && snapshot.is_playing) usePlaybackStore.getState().play();
  else usePlaybackStore.getState().pause();
  useRoomStore.setState((state) => ({
    code: text(snapshot.room_code) || state.code,
    users: Array.isArray(snapshot.users) ? usersFrom(snapshot.users) : state.users,
    allowParticipantControl: Boolean(snapshot.allow_participant_control ?? state.allowParticipantControl),
  }));
}

function handleMessage(raw: unknown): void {
  let message: RecordValue;
  try { message = record(JSON.parse(String(raw))); } catch { return; }
  const type = text(message.type);
  const payload = record(message.payload);
  // Feed every server timestamp into the transit floor estimator.
  if (typeof payload.server_time === 'number') elapsedSeconds(payload.server_time);
  if (type === 'room_created') {
    useRoomStore.setState((state) => ({ status: 'connected', role: 'host', code: text(payload.room_code), userId: text(payload.user_id), users: [{ id: text(payload.user_id), name: state.username, host: true, connected: true }] }));
    lastRoom = { code: text(payload.room_code) };
    reconnectAttempts = 0;
    const room = useRoomStore.getState();
    room.broadcastPlayback('sync_queue');
    if (usePlaybackStore.getState().currentTrack) room.broadcastPlayback('change_track');
    if (usePlaybackStore.getState().isPlaying) room.broadcastPlayback('play');
  } else if (type === 'join_request') {
    useRoomStore.setState((state) => ({ requests: [...state.requests.filter((item) => item.id !== text(payload.user_id)), { id: text(payload.user_id), username: text(payload.username) || 'Listener' }] }));
  } else if (type === 'join_approved') {
    const code = text(payload.room_code) || useRoomStore.getState().code;
    useRoomStore.setState({ status: 'connected', role: 'guest', code, userId: text(payload.user_id), requests: [] });
    lastRoom = { code };
    reconnectAttempts = 0;
    applyRemote(() => applySnapshot(payload.state));
  } else if (type === 'join_rejected') {
    useRoomStore.setState({ status: 'error', error: text(payload.reason) || 'The host declined this request.' });
  } else if (type === 'sync_state') {
    applyRemote(() => applySnapshot(payload));
  } else if (type === 'user_joined' || type === 'user_reconnected') {
    const user = usersFrom([payload])[0];
    if (user) useRoomStore.setState((state) => ({ users: [...state.users.filter((item) => item.id !== user.id), user] }));
  } else if (type === 'user_left' || type === 'user_disconnected') {
    useRoomStore.setState((state) => ({ users: state.users.map((user) => user.id === text(payload.user_id) ? { ...user, connected: false } : user) }));
  } else if (type === 'chat_message') {
    const item: RoomMessage = { id: text(payload.id) || `${Date.now()}`, userId: text(payload.user_id), username: text(payload.username) || 'Listener', message: text(payload.message), sentAt: Number(payload.sent_at) || Date.now() };
    if (item.message) useRoomStore.setState((state) => ({ messages: [...state.messages, item].slice(-100) }));
  } else if (type === 'room_settings_changed') {
    useRoomStore.setState({ allowParticipantControl: Boolean(payload.allow_participant_control) });
  } else if (type === 'host_changed') {
    const hostId = text(payload.new_host_id);
    useRoomStore.setState((state) => ({ role: hostId === state.userId ? 'host' : 'guest', users: state.users.map((user) => ({ ...user, host: user.id === hostId })) }));
  } else if (type === 'kicked' || type === 'room_closed') {
    lastRoom = undefined;
    window.clearTimeout(reconnectTimer);
    useRoomStore.getState().socket?.close();
    useRoomStore.setState({ status: 'error', socket: undefined, code: '', error: text(payload.reason ?? payload.message) || (type === 'kicked' ? 'You were removed from this room.' : 'This room has closed.') });
  } else if (type === 'error') {
    useRoomStore.setState({ status: 'error', error: text(payload.message) || 'The room server returned an error.' });
  } else if (type === 'sync_playback') {
    const action = text(payload.action);
    applyRemote(() => {
      const playback = usePlaybackStore.getState();
      if (action === 'play') {
        if (typeof payload.position === 'number') {
          const transitSeconds = typeof payload.server_time === 'number' ? elapsedSeconds(payload.server_time) : 0;
          playback.seek(payload.position / 1000 + transitSeconds);
        }
        playback.play();
      } else if (action === 'pause') {
        if (typeof payload.position === 'number') playback.seek(payload.position / 1000);
        playback.pause();
      }
      else if (action === 'seek' && typeof payload.position === 'number') playback.seek(payload.position / 1000);
      else if (action === 'skip_next') playback.next();
      else if (action === 'skip_prev') playback.previous();
      else if (action === 'change_track') {
        const track = normalizeMedia(payload.track_info, 'song');
        if (track && 'source' in track) playback.playTrack(track, playback.queue, 'Listen together');
      } else if (action === 'sync_queue') {
        const tracks = tracksFrom(payload.queue);
        playback.syncQueue(tracks, text(payload.track_id));
      }
    });
  }
}

export const useRoomStore = create<RoomState>((set, get) => ({
  username: 'Listener',
  server: 'wss://metroserverx.meowery.eu/ws',
  status: 'disconnected',
  code: '',
  userId: '',
  users: [],
  messages: [],
  requests: [],
  allowParticipantControl: false,
  suppressBroadcast: false,
  bootstrap: async () => {
    const prefs = await getSetting<RoomPreferences>('room', { username: 'Listener', server: 'wss://metroserverx.meowery.eu/ws' });
    set(prefs);
  },
  setPreferences: async (patch) => {
    const prefs = { username: patch.username ?? get().username, server: patch.server ?? get().server };
    set(prefs);
    await setSetting('room', prefs);
  },
  createRoom: () => connect('create_room'),
  joinRoom: (code) => connect('join_room', code),
  leaveRoom: () => {
    lastRoom = undefined;
    reconnectAttempts = 0;
    window.clearTimeout(reconnectTimer);
    send(get().socket, 'leave_room');
    get().socket?.close();
    set({ status: 'disconnected', socket: undefined, role: undefined, code: '', userId: '', users: [], messages: [], requests: [], error: undefined });
  },
  approve: (id, approved) => {
    send(get().socket, approved ? 'approve_join' : 'reject_join', { user_id: id, ...(approved ? {} : { reason: 'The host declined the request.' }) });
    set((state) => ({ requests: state.requests.filter((request) => request.id !== id) }));
  },
  sendChat: (message) => { if (message.trim()) send(get().socket, 'chat', { message: message.trim().slice(0, 500) }); },
  setParticipantControl: (enabled) => {
    set({ allowParticipantControl: enabled });
    send(get().socket, 'update_room_settings', { allow_participant_control: enabled });
  },
  broadcastPlayback: (action) => {
    const room = get();
    if (room.suppressBroadcast || room.status !== 'connected' || (room.role !== 'host' && !room.allowParticipantControl)) return;
    const playback = usePlaybackStore.getState();
    if (playback.currentTrack?.source === 'local' && (action === 'change_track' || action === 'sync_queue' || action === 'play')) {
      set({ error: 'Local files cannot be shared with a room. Guests remain paused until you choose an online track.' });
      send(room.socket, 'playback_action', { action: 'pause', position: Math.round(playback.position * 1000), server_time: Date.now() });
      return;
    }
    if (room.error) set({ error: undefined });
    send(room.socket, 'playback_action', {
      action,
      track_id: playback.currentTrack?.id,
      track_info: wireTrack(playback.currentTrack),
      position: Math.round(playback.position * 1000),
      queue: action === 'sync_queue' ? playback.queue.map(wireTrack).filter(Boolean) : undefined,
      server_time: Date.now(),
    });
  },
}));

export function roomSnapshot(): RoomSnapshot | null {
  const room = useRoomStore.getState();
  if (!room.role || !room.code) return null;
  const playback = usePlaybackStore.getState();
  return { code: room.code, role: room.role, userId: room.userId, users: room.users, allowParticipantControl: room.allowParticipantControl, queue: playback.queue, currentTrackId: playback.currentTrack?.id, positionMs: playback.position * 1000, playing: playback.isPlaying };
}
