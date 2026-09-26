import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useRoomStore } from '../room/client';
import { usePlaybackStore } from '../store/playback';
import { Artwork, PageHeader } from '../components/primitives';
import { Icon } from '../components/Icon';

export function RoomPage() {
  const { roomCode = '' } = useParams();
  const room = useRoomStore();
  const track = usePlaybackStore((state) => state.currentTrack);
  const [username, setUsername] = useState(room.username);
  const [server, setServer] = useState(room.server);
  const [code, setCode] = useState(roomCode.toUpperCase());
  const [message, setMessage] = useState('');
  const connected = room.status === 'connected';
  const persistPreferences = async () => room.setPreferences({ username: username.trim() || 'Listener', server: server.trim() });
  const start = async (action: 'create' | 'join') => {
    await persistPreferences();
    action === 'create' ? useRoomStore.getState().createRoom() : useRoomStore.getState().joinRoom(code);
  };
  const sendMessage = (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    room.sendChat(message); setMessage('');
  };

  return <div className="page room-page">
    <PageHeader title="Listen together" description="Share one queue, one playhead, and the same moment." />
    <section className={`room-hero glass-surface ${connected ? 'is-connected' : ''}`}><span className="room-orbit"><Icon name="users" size={25} /></span><div><h2>{connected ? (room.role === 'host' ? 'Your listening room' : 'You’re in the room') : 'Music is better shared'}</h2><p>{connected ? `${room.users.filter((user) => user.connected).length} listening now` : 'Create a room or join with a short code. The host stays in control.'}</p></div><span className="connection-state"><i />{room.status === 'connecting' ? 'Connecting' : room.status === 'waiting' ? 'Waiting for host' : connected ? 'Connected' : 'Not connected'}</span></section>

    {!connected ? <>
      <div className="room-connect-grid">
        <section className="room-card"><span><Icon name="plus" /></span><h2>Start a room</h2><p>You choose the music and approve who joins.</p><label>Display name<input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} /></label><button className="primary-button" onClick={() => void start('create')} disabled={room.status === 'connecting'}>{room.status === 'connecting' ? 'Connecting…' : 'Create room'}</button></section>
        <section className="room-card"><span><Icon name="users" /></span><h2>Join a room</h2><p>Enter the code from your friend. They may need to approve you.</p><label>Display name<input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} /></label><label>Room code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={12} placeholder="AB12CD" /></label><button className="secondary-button" onClick={() => void start('join')} disabled={!code.trim() || room.status === 'connecting'}>Join room</button></section>
      </div>
      <details className="connection-settings"><summary>Connection settings</summary><label>Room server<input value={server} onChange={(event) => setServer(event.target.value)} onBlur={() => void persistPreferences()} spellCheck={false} /></label><p>Aurora uses this WebSocket server only to relay room state and chat.</p></details>
      {room.error && <div className="room-error" role="alert"><span>{room.error}</span><button onClick={() => useRoomStore.setState({ error: undefined, status: 'disconnected' })}>Dismiss</button></div>}
    </> : <section className="room-live">
      {room.error && <div className="room-error" role="alert"><span>{room.error}</span><button onClick={() => useRoomStore.setState({ error: undefined })}>Dismiss</button></div>}
      <header className="room-code"><div><span>Room code</span><strong>{room.code}</strong></div><button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(room.code)}><Icon name="copy" size={16} /> Copy code</button><button className="text-button danger" onClick={room.leaveRoom}>Leave</button></header>
      <div className="room-now glass-surface">{track ? <><Artwork src={track.artwork} title={track.title} /><div><span>Now playing</span><strong>{track.title}</strong><small>{track.artist}</small></div><button className="text-button" onClick={() => usePlaybackStore.getState().openFullPlayer(true)}>Open player</button></> : <><span className="room-empty-art"><Icon name="music" /></span><div><span>Now playing</span><strong>Nothing yet</strong><small>Choose a song and it will sync here.</small></div></>}</div>
      <div className="room-columns">
        <section><header className="section-header"><h2>Listeners</h2><span>{room.users.length}</span></header><div className="listener-list">{room.users.map((user) => <div key={user.id}><span className="listener-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.host ? 'Host' : 'Listener'}{!user.connected ? ' · reconnecting' : ''}</small></span>{user.id === room.userId && <em>You</em>}</div>)}</div>{room.role === 'host' && <label className="toggle-row"><span><strong>Listener controls</strong><small>Let guests play, pause, and skip</small></span><input type="checkbox" checked={room.allowParticipantControl} onChange={(event) => room.setParticipantControl(event.target.checked)} /></label>}</section>
        <section><header className="section-header"><h2>Room chat</h2></header><div className="room-chat">{room.messages.length ? room.messages.map((item) => <div key={item.id}><strong>{item.username}</strong><p>{item.message}</p></div>) : <p className="chat-empty">Messages from the room appear here.</p>}</div><form className="chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} placeholder="Send a message" /><button className="primary-button" type="submit" aria-label="Send message"><Icon name="chevron-right" /></button></form></section>
      </div>
      {room.requests.length > 0 && <section className="join-requests"><header className="section-header"><h2>Join requests</h2></header>{room.requests.map((request) => <div key={request.id}><strong>{request.username}</strong><span>Would like to join</span><button className="text-button" onClick={() => room.approve(request.id, true)}>Approve</button><button className="text-button danger" onClick={() => room.approve(request.id, false)}>Decline</button></div>)}</section>}
    </section>}
  </div>;
}
