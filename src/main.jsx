import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient} from '@supabase/supabase-js';
import {Play, Pause, SkipBack, SkipForward, Repeat1, Shuffle, Volume2, VolumeX, Plus, Upload, Music2, ListMusic, MoreHorizontal, Trash2, X, Check, LogOut, Disc3, ArrowLeft, GripVertical} from 'lucide-react';
import './style.css';
import {AudioEngine,neutral,frequencies} from './audio-engine';
import Effects from './Effects';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const cloud = Boolean(url && key);
const sb = cloud ? createClient(url, key) : null;
const BUCKET = 'music';
const randomIndex = n => Math.floor(Math.random() * n);
const titleFromFile = name => name.replace(/\.mp3$/i,'').replace(/[_]/g,' ');
const durationText = s => Number.isFinite(s) ? `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` : '0:00';
const errorText = e => e?.message || String(e);
const demoSong = {id:'demo', title:'Add an MP3 to begin', artist:'Your library is empty', path:null, duration:0};

function App(){
  const [session,setSession]=useState(null),[authReady,setAuthReady]=useState(!cloud),[email,setEmail]=useState(''),[linkSent,setLinkSent]=useState(false);
  const [songs,setSongs]=useState([]),[playlists,setPlaylists]=useState([]),[items,setItems]=useState([]);
  const [view,setView]=useState('library'),[current,setCurrent]=useState(null),[playing,setPlaying]=useState(false);
  const [shuffle,setShuffle]=useState(false),[repeat,setRepeat]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(.8);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[menu,setMenu]=useState(null),[dialog,setDialog]=useState(null),[newName,setNewName]=useState('');
  const [effects,setEffects]=useState(neutral),[globalEq,setGlobalEq]=useState(()=>{try{return JSON.parse(localStorage.getItem('stillwave-global-eq'))||frequencies.map(()=>0)}catch{return frequencies.map(()=>0)}});
  const audio=useRef(new AudioEngine()), fileInput=useRef(null), localUrls=useRef(new Map()), queueRef=useRef([]), currentRef=useRef(null), shuffleRef=useRef(false), repeatRef=useRef(false), loadedRef=useRef(false);
  const activePlaylist=playlists.find(p=>p.id===view);
  const playlistSongs=items.filter(i=>i.playlist_id===view).sort((a,b)=>a.position-b.position).map(i=>songs.find(s=>s.id===i.song_id)).filter(Boolean);
  const visible=view==='library'?songs:playlistSongs;
  const queue=activePlaylist?playlistSongs:songs;
  queueRef.current=queue;currentRef.current=current;shuffleRef.current=shuffle;repeatRef.current=repeat;
  const currentSong=songs.find(s=>s.id===current);

  const flash=(msg)=>{setNotice(msg);window.setTimeout(()=>setNotice(''),4500)};
  useEffect(()=>{if(!cloud)return;sb.auth.getSession().then(({data})=>{setSession(data.session);setAuthReady(true)});const {data:{subscription}}=sb.auth.onAuthStateChange((_event,s)=>setSession(s));return()=>subscription.unsubscribe()},[]);
  const refresh=useCallback(async()=>{
    if(!cloud||!session)return;
    const [a,b,c]=await Promise.all([sb.from('songs').select('*').order('created_at',{ascending:false}),sb.from('playlists').select('*').order('created_at'),sb.from('playlist_songs').select('*')]);
    if(a.error||b.error||c.error){flash(`Could not load library: ${errorText(a.error||b.error||c.error)}`);return}
    setSongs(a.data);setPlaylists(b.data);setItems(c.data);
  },[session]);
  useEffect(()=>{if(cloud){if(session)refresh();else{setSongs([]);setPlaylists([]);setItems([])}}},[session,refresh]);
  useEffect(()=>{audio.current.volume=volume},[volume]);
  useEffect(()=>{audio.current.setEffects(effects,globalEq);localStorage.setItem('stillwave-global-eq',JSON.stringify(globalEq))},[effects,globalEq]);
  audio.current.onTime=()=>setPosition(audio.current.currentTime);audio.current.onMetadata=()=>setDuration(audio.current.duration);audio.current.onEnded=()=>ended();
  useEffect(()=>()=>{for(const u of localUrls.current.values())URL.revokeObjectURL(u)},[]);

  const start=useCallback(async(song)=>{
    if(!song)return;
    try{
      let source=localUrls.current.get(song.id);
      if(cloud){const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(song.path,3600);if(error)throw error;source=data.signedUrl}
      if(!source)throw Error('Audio file is unavailable');
      const settings=song.effects||neutral();setEffects(settings);audio.current.effects=settings;audio.current.src=source;audio.current.load();setCurrent(song.id);setPosition(0);loadedRef.current=true;
      await audio.current.play();setPlaying(true);
    }catch(e){setPlaying(false);flash(`Playback failed: ${errorText(e)}`)}
  },[]);
  const next=useCallback(()=>{
    const list=queueRef.current;if(!list.length)return;
    let index=list.findIndex(s=>s.id===currentRef.current);
    if(shuffleRef.current){index=randomIndex(list.length)}else index=(index+1)%list.length;
    start(list[index]);
  },[start]);
  const previous=()=>{if(audio.current.currentTime>3){audio.current.currentTime=0;return}const list=queueRef.current;if(!list.length)return;const i=list.findIndex(s=>s.id===current);start(list[(i-1+list.length)%list.length])};
  const ended=()=>{if(repeatRef.current){audio.current.currentTime=0;audio.current.play().then(()=>setPlaying(true)).catch(()=>setPlaying(false))}else next()};
  const toggle=async()=>{if(!currentSong){if(queue.length)start(queue[0]);return}if(playing){audio.current.pause();setPlaying(false)}else{try{await audio.current.play();setPlaying(true)}catch(e){flash(errorText(e))}}};
  const upload=async files=>{
    const chosen=Array.from(files).filter(f=>f.type==='audio/mpeg'||/\.mp3$/i.test(f.name));
    if(!chosen.length){flash('Choose MP3 files to upload.');return}
    setBusy(true);let done=0;
    for(const file of chosen){
      if(file.size>50*1024*1024){flash(`${file.name} is larger than 50 MB.`);continue}
      try{
        const id=crypto.randomUUID(),path=`${session?.user?.id||'preview'}/${id}.mp3`;
        const song={id,title:titleFromFile(file.name),artist:'Unknown artist',path, duration:0};
        if(cloud){
          const {error:uploadError}=await sb.storage.from(BUCKET).upload(path,file,{contentType:'audio/mpeg',upsert:false});if(uploadError)throw uploadError;
          const {error:dbError}=await sb.from('songs').insert({...song,user_id:session.user.id});
          if(dbError){await sb.storage.from(BUCKET).remove([path]);throw dbError}
        }else{localUrls.current.set(id,URL.createObjectURL(file));setSongs(old=>[song,...old])}
        done++;
      }catch(e){flash(`Could not upload ${file.name}: ${errorText(e)}`)}
    }
    if(cloud)await refresh();setBusy(false);if(done)flash(`${done} ${done===1?'song':'songs'} added${cloud?'':' to this preview'}.`);
    if(fileInput.current)fileInput.current.value='';
  };
  const saveVersion=async()=>{if(!currentSong||!newName.trim())return;try{const song={...currentSong,id:crypto.randomUUID(),title:newName.trim(),effects:{...effects,eq:[...(effects.eq??globalEq)]},created_at:new Date().toISOString()};if(cloud){const {error}=await sb.from('songs').insert(song);if(error)throw error;await refresh()}else{localUrls.current.set(song.id,localUrls.current.get(currentSong.id));setSongs(x=>[song,...x])}setDialog(null);flash('Saved as a separate version.')}catch(e){flash(errorText(e))}};
  const createPlaylist=async()=>{
    const name=newName.trim();if(!name)return;
    try{let p;if(cloud){const {data,error}=await sb.from('playlists').insert({name,user_id:session.user.id}).select().single();if(error)throw error;p=data;await refresh()}else{p={id:crypto.randomUUID(),name};setPlaylists(x=>[...x,p])}setView(p.id);setDialog(null);setNewName('')}
    catch(e){flash(errorText(e))}
  };
  const addTo=async(p,s)=>{
    if(items.some(i=>i.playlist_id===p.id&&i.song_id===s.id)){flash('Already in that playlist.');setMenu(null);return}
    const row={playlist_id:p.id,song_id:s.id,position:items.filter(i=>i.playlist_id===p.id).length};
    try{if(cloud){const {error}=await sb.from('playlist_songs').insert({...row,user_id:session.user.id});if(error)throw error;await refresh()}else setItems(x=>[...x,{...row,id:crypto.randomUUID()}]);flash(`Added to ${p.name}.`)}catch(e){flash(errorText(e))}setMenu(null);
  };
  const removeFrom=async(s)=>{const item=items.find(i=>i.playlist_id===view&&i.song_id===s.id);if(!item)return;try{if(cloud){const {error}=await sb.from('playlist_songs').delete().eq('id',item.id);if(error)throw error;await refresh()}else setItems(x=>x.filter(i=>i.id!==item.id));setMenu(null)}catch(e){flash(errorText(e))}};
  const deleteSong=async(s)=>{try{if(cloud){if(!songs.some(v=>v.id!==s.id&&v.path===s.path)){const {error}=await sb.storage.from(BUCKET).remove([s.path]);if(error)throw error;}const r=await sb.from('songs').delete().eq('id',s.id);if(r.error)throw r.error;await refresh()}else{if(!songs.some(v=>v.id!==s.id&&v.path===s.path))URL.revokeObjectURL(localUrls.current.get(s.id));localUrls.current.delete(s.id);setSongs(x=>x.filter(v=>v.id!==s.id));setItems(x=>x.filter(i=>i.song_id!==s.id))}if(current===s.id){audio.current.pause();audio.current.removeAttribute('src');setCurrent(null);setPlaying(false)}setDialog(null);setMenu(null)}catch(e){flash(errorText(e))}};
  const deletePlaylist=async(p)=>{try{if(cloud){const {error}=await sb.from('playlists').delete().eq('id',p.id);if(error)throw error;await refresh()}else{setPlaylists(x=>x.filter(v=>v.id!==p.id));setItems(x=>x.filter(i=>i.playlist_id!==p.id))}setView('library');setDialog(null)}catch(e){flash(errorText(e))}};
  const move=async(song,delta)=>{const ordered=items.filter(i=>i.playlist_id===view).sort((a,b)=>a.position-b.position);const at=ordered.findIndex(i=>i.song_id===song.id),to=at+delta;if(at<0||to<0||to>=ordered.length)return;const first=ordered[at],second=ordered[to];try{if(cloud){const {error:e1}=await sb.from('playlist_songs').update({position:second.position}).eq('id',first.id);if(e1)throw e1;const {error:e2}=await sb.from('playlist_songs').update({position:first.position}).eq('id',second.id);if(e2)throw e2;await refresh()}else setItems(x=>x.map(i=>i.id===first.id?{...i,position:second.position}:i.id===second.id?{...i,position:first.position}:i))}catch(e){flash(errorText(e))}};
  const logout=()=>sb.auth.signOut();
  const login=async(e)=>{e.preventDefault();const {error}=await sb.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:window.location.href.split('#')[0]}});if(error)flash(errorText(error));else setLinkSent(true)};

  if(!authReady)return <div className="center"><Disc3 className="spin" size={30}/></div>;
  if(cloud&&!session)return <div className="login-shell"><div className="brand"><span className="mark"><Disc3 size={21}/></span> STILLWAVE</div><div className="login-card"><div className="login-art"><Disc3 size={104} strokeWidth={.6}/></div><span className="eyebrow">YOUR PRIVATE LISTENING SPACE</span><h1>Music, wherever<br/>you are.</h1><p>Sign in to reach your library and playlists.</p><form onSubmit={login} className="login-form"><label htmlFor="email">Email address</label><input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button className="primary" type="submit">Email me a sign-in link <span>↗</span></button></form>{linkSent&&<p className="sent">Check your inbox for the sign-in link.</p>}</div></div>;
  return <div className="app">

    <aside className="sidebar"><div className="brand"><span className="mark"><Disc3 size={21}/></span> STILLWAVE</div><div className="nav-label">COLLECTION</div><button className={`nav-item ${view==='library'?'selected':''}`} onClick={()=>setView('library')}><Music2 size={18}/> All songs <span className="nav-count">{songs.length}</span></button><div className="nav-heading"><span>PLAYLISTS</span><button title="Create playlist" aria-label="Create playlist" onClick={()=>{setNewName('');setDialog({type:'create'})}}><Plus size={18}/></button></div><div className="playlist-nav">{playlists.map(p=><button key={p.id} className={`nav-item ${view===p.id?'selected':''}`} onClick={()=>setView(p.id)}><ListMusic size={18}/><span className="ellipsis">{p.name}</span></button>)}</div><div className="sidebar-bottom">{!cloud&&<div className="preview-pill">LOCAL PREVIEW · FILES STAY HERE</div>}{cloud&&<button className="signout" onClick={logout}><LogOut size={16}/> Sign out</button>}</div></aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">YOUR MUSIC <span>/</span> <strong>{activePlaylist?.name||'All songs'}</strong></div><div className="top-actions"><span className="storage-hint">{songs.length} {songs.length===1?'TRACK':'TRACKS'}</span><button className="top-upload" onClick={()=>fileInput.current.click()} disabled={busy}><Upload size={16}/>{busy?'Uploading…':'Upload music'}</button></div></header>
      <section className="content"><div className="feature"><div className="feature-copy"><span className="eyebrow">{activePlaylist?'PLAYLIST':'YOUR LIBRARY'}</span><h1>{activePlaylist?.name||'All songs'}</h1><p>{activePlaylist?`${playlistSongs.length} ${playlistSongs.length===1?'track':'tracks'} in this playlist`:'Every track, all in one place.'}</p><div className="feature-actions"><button className="primary play-all" disabled={!visible.length} onClick={()=>start(visible[0])}><Play size={17} fill="currentColor"/> Play {activePlaylist?'playlist':'all'}</button>{activePlaylist&&<button className="ghost" onClick={()=>setDialog({type:'deletePlaylist',playlist:activePlaylist})}><Trash2 size={17}/> Delete playlist</button>}</div></div><div className="record-art"><div className="record"><div className="record-ring one"/><div className="record-ring two"/><div className="record-ring three"/><div className="record-label"><Disc3 size={32} strokeWidth={1}/></div></div></div></div>
        <Effects effects={effects} setEffects={setEffects} globalEq={globalEq} setGlobalEq={setGlobalEq} hasSong={!!currentSong} onSave={()=>{setNewName(currentSong.title+' — version');setDialog({type:'saveVersion'})}}/><div className="section-title"><div><h2>Tracks</h2><span>{visible.length} songs</span></div>{activePlaylist&&<button className="subtle" onClick={()=>setView('library')}>Browse library <ArrowLeft size={15} className="flip"/></button>}</div>
        {visible.length?<div className="track-list"><div className="track-header"><span>#</span><span>TITLE</span><span>ADDED</span><span className="right">TIME</span><span/></div>{visible.map((song,i)=><div className={`track ${current===song.id?'is-current':''}`} key={song.id}><button className="track-index" onClick={()=>start(song)} aria-label={`Play ${song.title}`}>{current===song.id&&playing?<span className="bars"><i/><i/><i/></span>:String(i+1).padStart(2,'0')}</button><button className="track-info" onClick={()=>start(song)}><span className="mini-art"><Music2 size={17}/></span><span className="track-text"><strong>{song.title}</strong><small>{song.artist||'Unknown artist'}</small></span></button><span className="track-date">{song.created_at?new Date(song.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Just now'}</span><span className="track-time">{song.duration?durationText(song.duration):'—'}</span><div className="menu-wrap"><button className="icon more" aria-label={`Options for ${song.title}`} onClick={()=>setMenu(menu===song.id?null:song.id)}><MoreHorizontal size={19}/></button>{menu===song.id&&<div className="pop-menu"><div className="pop-label">ADD TO PLAYLIST</div>{playlists.map(p=><button key={p.id} onClick={()=>addTo(p,song)}><ListMusic size={15}/>{p.name}</button>)}{!playlists.length&&<span className="pop-empty">Create a playlist first</span>}{activePlaylist&&<button onClick={()=>removeFrom(song)}><X size={15}/>Remove from playlist</button>}{activePlaylist&&<div className="pop-row"><button onClick={()=>{move(song,-1);setMenu(null)}}>Move up</button><button onClick={()=>{move(song,1);setMenu(null)}}>Move down</button></div>}<div className="pop-divider"/><button className="danger" onClick={()=>{setMenu(null);setDialog({type:'deleteSong',song})}}><Trash2 size={15}/>Delete song</button></div>}</div></div>)}</div>:<div className="empty"><div className="empty-icon"><Music2 size={26}/></div><h3>{activePlaylist?'Nothing here yet':'Your library is waiting'}</h3><p>{activePlaylist?'Add songs from your library using the ••• menu.':'Upload MP3 files to start listening.'}</p><button className="outline" onClick={()=>activePlaylist?setView('library'):fileInput.current.click()}>{activePlaylist?'Browse library':'Upload your first song'}</button></div>}
      </section>
    </main>
    <footer className="player"><div className="playing-track"><div className="playing-art"><Music2 size={20}/></div><div className="playing-meta"><strong>{currentSong?.title||'Nothing playing'}</strong><span>{currentSong?.artist||'Choose a track to begin'}</span></div></div><div className="transport"><div className="controls"><button className={`icon mode ${shuffle?'active':''}`} title="Fully random shuffle; repeats are possible" aria-label="Toggle random shuffle" aria-pressed={shuffle} onClick={()=>setShuffle(!shuffle)}><Shuffle size={18}/></button><button className="icon" aria-label="Previous track" onClick={previous}><SkipBack size={19} fill="currentColor"/></button><button className="play-toggle" aria-label={playing?'Pause':'Play'} onClick={toggle}>{playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button className="icon" aria-label="Next track" onClick={next}><SkipForward size={19} fill="currentColor"/></button><button className={`icon mode ${repeat?'active':''}`} title="Repeat current song" aria-label="Toggle repeat song" aria-pressed={repeat} onClick={()=>setRepeat(!repeat)}><Repeat1 size={19}/></button></div><div className="progress"><span>{durationText(position)}</span><input aria-label="Seek" type="range" min="0" max={duration||1} step="0.1" value={Math.min(position,duration||1)} onChange={e=>{audio.current.currentTime=Number(e.target.value);setPosition(Number(e.target.value))}} style={{'--fill':`${duration?position/duration*100:0}%`}}/><span>{durationText(duration)}</span></div></div><div className="volume"><button className="icon" aria-label={volume?'Mute':'Unmute'} onClick={()=>setVolume(volume?0:.8)}>{volume?<Volume2 size={19}/>:<VolumeX size={19}/>}</button><input aria-label="Volume" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{'--fill':`${volume*100}%`}}/></div></footer>
    <input ref={fileInput} type="file" accept=".mp3,audio/mpeg" multiple hidden onChange={e=>upload(e.target.files)}/>
    {notice&&<div className="toast">{notice}<button aria-label="Dismiss" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    {dialog&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><div className="modal"><button className="close icon" aria-label="Close" onClick={()=>setDialog(null)}><X size={19}/></button>{(dialog.type==='create'||dialog.type==='saveVersion')?<><span className="eyebrow">NEW COLLECTION</span><h2>{dialog.type==='saveVersion'?'Save version':'Create playlist'}</h2><p>{dialog.type==='saveVersion'?'A separate track with these pitch, tempo, and EQ settings.':'Give your playlist a name.'}</p><form onSubmit={e=>{e.preventDefault();dialog.type==='saveVersion'?saveVersion():createPlaylist()}}><input autoFocus placeholder="Playlist name" maxLength="60" value={newName} onChange={e=>setNewName(e.target.value)}/><div className="modal-actions"><button type="button" className="ghost" onClick={()=>setDialog(null)}>Cancel</button><button className="primary" disabled={!newName.trim()} type="submit">{dialog.type==='saveVersion'?'Save version':'Create playlist'}</button></div></form></>:<><span className="eyebrow">CONFIRM DELETE</span><h2>Delete {dialog.type==='deleteSong'?'song':'playlist'}?</h2><p>{dialog.type==='deleteSong'?`“${dialog.song.title}” will be removed from your library and every playlist.`:`“${dialog.playlist.name}” will be removed. Your songs will stay in the library.`}</p><div className="modal-actions"><button className="ghost" onClick={()=>setDialog(null)}>Cancel</button><button className="destructive" onClick={()=>dialog.type==='deleteSong'?deleteSong(dialog.song):deletePlaylist(dialog.playlist)}>Delete</button></div></>}</div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
