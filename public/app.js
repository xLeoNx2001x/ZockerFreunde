const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let me=null,members=[],socket=null,currentPrivate=null,config={},friendsData={friends:[],sent:[],incoming:[],blocked:[]},selectedFriend=null,communityServers=[],currentCommunityServer=null,currentCommunityData=null,currentCommunityChannel=null,currentVoiceChannel=null,voiceLocalStream=null,voiceScreenStream=null,voicePeers=new Map(),serverViewMode='mine';
const serverUnread=new Map();
let serverMemberSearchValue='';
const pages={home:'Startseite',members:'Mitglieder',friends:'Freunde',chat:'Öffentlicher Chat',private:'Private Chats',leaderboard:'Rangliste',settings:'Einstellungen',discordServers:'Meine Discord-Server'};
const protectedPages=new Set(['members','friends','chat','private','leaderboard','settings','discordServers']);
const pageThemes={home:'theme-home',members:'theme-members',friends:'theme-members',chat:'theme-chat',private:'theme-private',leaderboard:'theme-leaderboard',settings:'theme-settings'};
function setPageTheme(page){document.body.classList.remove(...Object.values(pageThemes));document.body.classList.add(pageThemes[page]||pageThemes.home);}
function showLoginGate(){const e=$('#loginGate');if(!e)return;e.classList.add('show');e.setAttribute('aria-hidden','false');}
function closeLoginGate(){const e=$('#loginGate');if(!e)return;e.classList.remove('show');e.setAttribute('aria-hidden','true');}

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function sameId(a,b){return String(a??'')===String(b??'')}
function avatar(u){const src=String(u?.avatar||'').trim();return src||'/logo.png'}
function avatarError(el){if(!el||el.dataset.fallbackApplied)return;el.dataset.fallbackApplied='1';el.onerror=null;el.src='/logo.png';el.classList.add('avatar-fallback')}
function avatarAttrs(u){return `loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="avatarError(this)" src="${esc(avatar(u))}"`}

function isOnline(u){
  if(!u?.last_seen)return false;
  const raw=String(u.last_seen).trim();
  const normalized=/[zZ]|[+-]\\d{2}:?\\d{2}$/.test(raw)?raw:raw.replace(' ','T')+'Z';
  const t=Date.parse(normalized);
  return Number.isFinite(t)&&Date.now()-t<120000;
}
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(window.tt);window.tt=setTimeout(()=>e.style.display='none',2600)}
async function api(url,opt){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt});if(!r.ok)throw new Error(await r.text());return r.json()}
function displayRole(u){return (u.discord_roles||[]).length ? (u.discord_roles||[]).map(r=>r.name).join(' · ') : (u.role||'Mitglied');}
const levelFromXPClient=xp=>Math.max(1,Math.floor(Math.sqrt(Math.max(0,Number(xp)||0)/100))+1);const levelStartXPClient=level=>Math.max(0,Math.pow(Math.max(1,level-1),2)*100);const levelNextXPClient=level=>Math.pow(Math.max(1,level),2)*100;
function levelInfo(u){
  const start=Number(u.level_start_xp||0), next=Number(u.level_next_xp||100);
  return `<div class="level-line"><span>Level ${u.level||1}</span><span>${u.xp} / ${next} XP</span></div><div class="level-bar"><i style="width:${Math.min(100,Math.max(0,Number(u.level_progress)||0))}%"></i></div>`;
}
function discordInfo(u){
  if(!config.discordServerCheckConfigured) return `<div class="discord-status unknown">◌ Discord-Server nicht geprüft</div>`;
  if(!u.discord_in_server) return `<div class="discord-status no">✕ Nicht auf dem Zockerfreunde-Discord</div>`;
  const roles=(u.discord_roles||[]).map(r=>{
    const color=Number(r.color||0).toString(16).padStart(6,'0');
    return `<span class="role-chip" style="--role-color:#${color}">${esc(r.name)}</span>`;
  }).join(' ');
  return `<div class="discord-status yes">✓ Auf dem Zockerfreunde-Discord${roles?` · ${roles}`:''}</div>`;
}
function showLevelUp(level){
  const old=$('#levelUpOverlay');
  if(old) old.remove();
  const e=document.createElement('div');
  e.id='levelUpOverlay';
  e.className='level-up-overlay';
  e.innerHTML=`<div class="level-up-card"><div class="level-up-stars">✦ ✦ ✦</div><div class="level-up-kicker">LEVEL UP!</div><div class="level-up-number">LEVEL ${Number(level)||1}</div><div class="level-up-sub">Du hast ein neues Level erreicht!</div></div>`;
  document.body.appendChild(e);
  requestAnimationFrame(()=>e.classList.add('show'));
  setTimeout(()=>e.classList.remove('show'),2600);
  setTimeout(()=>e.remove(),3100);
}
function checkStoredLevel(u){
  if(!u||!u.id)return;
  const key=`zf_level_${u.id}`;
  const current=Number(u.level||1);
  const previous=Number(localStorage.getItem(key)||0);
  if(previous>0&&current>previous)showLevelUp(current);
  localStorage.setItem(key,String(current));
}
function friendRelation(id){if(friendsData.friends.some(u=>sameId(u.id,id)))return 'friend';if(friendsData.sent.some(u=>sameId(u.id,id)))return 'sent';if(friendsData.incoming.some(u=>sameId(u.id,id)))return 'incoming';if(friendsData.blocked.some(u=>sameId(u.id,id)))return 'blocked';return 'none';}
function friendButton(u){if(!me||sameId(u.id,me.id))return '';const id=String(u.id),r=friendRelation(id);if(r==='none')return `<button type="button" id="friend-add-${esc(id)}" class="friend-add-btn" title="Freundschaftsanfrage senden" data-add-friend="${esc(id)}">👤<b>＋</b></button>`;if(r==='friend')return `<button type="button" class="friend-add-btn friend-ok" title="Bereits befreundet" onclick='openFriendMenu(${JSON.stringify(String(id))});event.stopPropagation()'>✓</button>`;if(r==='incoming')return `<button type="button" class="friend-add-btn" title="Freundschaftsanfrage beantworten" onclick="go('friends');event.stopPropagation()">📩</button>`;if(r==='sent')return `<button type="button" class="friend-add-btn friend-request-sent" title="Anfrage gesendet" disabled>✓</button>`;return `<button type="button" class="friend-add-btn friend-blocked" title="Blockiert" onclick="go('friends');event.stopPropagation()">⊘</button>`;}
function memberCard(u){return `<div class="card member-card"><div class="member-head member-head-friend"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div><div class="member-name">${esc(u.global_name||u.username)}</div><div class="role">${esc(displayRole(u))}</div></div>${friendButton(u)}</div><p>${esc(u.bio||'Noch keine Beschreibung.')}</p>${discordInfo(u)}${levelInfo(u)}<div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'} · ${u.message_count||0} Nachrichten</div><div class="actions"><button class="secondary" onclick="showProfile('${u.id}')">Profil ansehen</button><button type="button" class="secondary member-message-btn" data-message-user="${esc(String(u.id))}">✉ Nachricht</button></div></div>`}
async function load(){
  const d=await api('/api/me');me=d.user;
  const m=await api('/api/members');members=m.members;
  if(me){try{friendsData=await api('/api/friends')}catch{friendsData={friends:[],sent:[],incoming:[],blocked:[]};}}
  if(me){checkStoredLevel(me);members=members.map(u=>sameId(u.id,me.id)?{...u,last_seen:new Date().toISOString()}:u);me=members.find(u=>sameId(u.id,me.id))||me;}
  renderTop();await loadNotifications();renderTop();renderHome();try{await loadCommunityServers();}catch{}renderServers();connectSocket();
}
function renderTop(){if(!me){$('#topUser').innerHTML=`<a class="primary" href="/auth/discord">Mit Discord anmelden</a>`;return;}$('#topUser').innerHTML=`<div class="top-tools"><div class="global-search"><input id="globalSearchInput" class="top-search-input" placeholder="Suchen …" autocomplete="off"><div id="globalSearchResults" class="global-search-results hidden"></div></div><button type="button" id="notificationBtn" class="top-icon-btn" title="Benachrichtigungen">🔔<span id="notificationBadge" class="notify-badge hidden">0</span></button><div class="user-mini"><i class="dot online"></i><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(me))}"><b>${esc(me.global_name||me.username)}</b></div></div>`;$('#globalSearchInput')?.addEventListener('input',debounceGlobalSearch);$('#globalSearchInput')?.addEventListener('focus',()=>{const q=$('#globalSearchInput').value.trim();if(q)runGlobalSearch(q)});$('#notificationBtn')?.addEventListener('click',toggleNotifications);updateNotificationBadge();}
let notificationData={notifications:[],unread:0};
let globalSearchTimer=null;
function debounceGlobalSearch(e){clearTimeout(globalSearchTimer);const q=e.target.value.trim();if(!q){$('#globalSearchResults')?.classList.add('hidden');return;}globalSearchTimer=setTimeout(()=>runGlobalSearch(q),250)}
async function loadNotifications(){if(!me){notificationData={notifications:[],unread:0};return;}try{notificationData=await api('/api/notifications')}catch{notificationData={notifications:[],unread:0};}updateNotificationBadge()}
function updateNotificationBadge(){const b=$('#notificationBadge');if(!b)return;b.textContent=String(notificationData.unread||0);b.classList.toggle('hidden',!(notificationData.unread>0))}
function closeNotifications(){document.querySelector('.notification-panel')?.remove()}
async function markNotificationRead(id){try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({id})})}catch{}await loadNotifications();renderTop()}
function toggleNotifications(e){e?.stopPropagation();closeNotifications();const panel=document.createElement('div');panel.className='notification-panel';const rows=notificationData.notifications||[];panel.innerHTML=`<div class="notification-head"><b>Benachrichtigungen</b><button type="button" class="tiny-icon" id="markAllNotifications">✓</button></div><div class="notification-list">${rows.map(n=>`<button type="button" class="notification-row ${n.read?'':'unread'}" data-notification-id="${n.id}" data-notification-link="${esc(n.link||'')}"><span class="notification-dot">${n.type==='friend'?'👥':n.type==='message'?'✉':'🔔'}</span><span><b>${esc(n.title||'Benachrichtigung')}</b><small>${esc(n.body||'')}</small></span></button>`).join('')||'<div class="empty compact">Keine Benachrichtigungen.</div>'}</div>`;document.body.appendChild(panel);$('#markAllNotifications')?.addEventListener('click',async()=>{try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({})})}catch{}await loadNotifications();closeNotifications();renderTop()});panel.querySelectorAll('[data-notification-id]').forEach(row=>row.addEventListener('click',async()=>{await markNotificationRead(row.dataset.notificationId);const link=row.dataset.notificationLink;closeNotifications();if(link==='friends')await go('friends');else if(link==='private')await go('private');else if(link.startsWith('server:')){toast('Der Server-Bereich wurde entfernt.')}}))}
async function runGlobalSearch(q){const box=$('#globalSearchResults');if(!box)return;try{const d=await api('/api/search?q='+encodeURIComponent(q));const people=(d.members||[]).map(u=>`<button type="button" class="search-result" data-search-user="${u.id}"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><span><b>${esc(u.global_name||u.username)}</b><small>Mitglied · Level ${u.level||1}</small></span></button>`).join('');const msgs=(d.messages||[]).map(m=>`<button type="button" class="search-result" data-search-server="${m.server_id}" data-search-channel="${m.channel_id}"><span class="search-result-icon">#</span><span><b>${esc(m.server_name)} · #${esc(m.channel_name)}</b><small>${esc((m.message||'').slice(0,120))}</small></span></button>`).join('');box.innerHTML=`${people?'<div class="search-group-title">MITGLIEDER</div>'+people:''}${msgs?'<div class="search-group-title">SERVER-NACHRICHTEN</div>'+msgs:''}${!people&&!msgs?'<div class="empty compact">Keine Treffer.</div>':''}`;box.classList.remove('hidden');box.querySelectorAll('[data-search-user]').forEach(b=>b.onclick=async()=>{box.classList.add('hidden');await go('members');const u=members.find(x=>sameId(x.id,b.dataset.searchUser));if(u){const input=$('#memberSearch');if(input){input.value=u.global_name||u.username;input.dispatchEvent(new Event('input'))}}});box.querySelectorAll('[data-search-server]').forEach(b=>b.onclick=async()=>{box.classList.add('hidden');toast('Der Server-Bereich wurde entfernt.')})}catch{box.innerHTML='<div class="empty compact">Suche momentan nicht verfügbar.</div>';box.classList.remove('hidden')}}
document.addEventListener('click',e=>{if(!e.target.closest('.global-search')&&!e.target.closest('.top-icon-btn')){$('#globalSearchResults')?.classList.add('hidden');closeNotifications()}});
function renderHome(){const online=members.filter(isOnline).length;$('#page-home').innerHTML=`<div class="hero"><div class="eyebrow">DEINE GAMING COMMUNITY</div><h1>Gemeinsam spielen.<br><span class="gradient">Gemeinsam zocken.</span></h1><p>Zockerfreunde verbindet Gaming, Freunde und Community an einem Ort. Chatte, finde deine Freunde und sammle XP für die Community-Rangliste.</p><div class="actions">${me?`<button class="primary" onclick="go('chat')">Zum Community-Chat →</button>`:`<a class="primary" href="/auth/discord">Mit Discord starten →</a>`}<button class="secondary" onclick="go('leaderboard')">🏆 Rangliste ansehen</button></div></div><div class="stats"><div class="stat"><strong>${members.length}</strong><span>Mitglieder</span></div><div class="stat"><strong>${online}</strong><span>Gerade online</span></div><div class="stat"><strong>${members.reduce((a,b)=>a+b.points,0)}</strong><span>Community-Punkte</span></div><div class="stat"><strong>∞</strong><span>Gemeinsame Momente</span></div></div><div class="section-title"><h2>Aktive Mitglieder</h2><button class="secondary" onclick="go('members')">Alle ansehen</button></div><div class="grid">${members.filter(isOnline).slice(0,4).map(memberCard).join('')||'<div class="empty">Noch niemand online.</div>'}</div>`}
async function renderDiscordServers(){
  const root=$('#page-discordServers');
  root.innerHTML=`<div class="discord-servers-page"><div class="discord-servers-hero"><div><div class="eyebrow">DEIN DISCORD</div><h2>Meine Discord-Server</h2><p>Alle Discord-Server, denen du mit diesem Account beigetreten bist.</p></div><a class="secondary" href="/auth/discord">↻ Discord-Verbindung aktualisieren</a></div><div id="discordGuildMeta" class="discord-guild-meta">Lade deine Server …</div><div id="discordGuildGrid" class="discord-guild-grid"><div class="empty">Server werden geladen …</div></div></div>`;
  try{const d=await api('/api/discord/guilds');const guilds=Array.isArray(d.guilds)?d.guilds.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'})):[];$('#discordGuildMeta').textContent=guilds.length===1?'1 Discord-Server':`${guilds.length} Discord-Server · alphabetisch sortiert`;const grid=$('#discordGuildGrid');grid.innerHTML=guilds.map(g=>`<a class="discord-guild-card" href="https://discord.com/channels/${encodeURIComponent(g.id)}/@me" target="_blank" rel="noopener noreferrer"><span class="discord-guild-icon"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(g.icon||'/logo.png')}" onerror="this.onerror=null;this.src='/logo.png'" alt=""></span><span class="discord-guild-copy"><b>${esc(g.name)}</b><small>${g.owner?'Eigener Server':'Mitglied'}</small></span><span class="discord-guild-arrow">→</span></a>`).join('')||`<div class="empty discord-guild-empty"><strong>Keine Discord-Server gefunden.</strong><span>Verbinde deinen Discord-Account erneut, damit Discord deine Serverliste freigeben kann.</span><a class="primary" href="/auth/discord">Discord neu verbinden</a></div>`;}catch{$('#discordGuildMeta').textContent='Discord-Server konnten nicht geladen werden.';$('#discordGuildGrid').innerHTML='<div class="empty">Bitte verbinde deinen Discord-Account erneut.</div>';}
}

function renderMembers(){ $('#page-members').innerHTML=`<div class="section-title"><div><h2>Mitglieder</h2><div class="eyebrow">ZOCKERFREUNDE COMMUNITY</div></div></div><input id="memberSearch" class="search" placeholder="Mitglied suchen ..."><div id="memberGrid" class="grid" style="margin-top:15px">${members.map(memberCard).join('')||'<div class="empty">Noch keine Mitglieder.</div>'}</div>`;$('#memberSearch').oninput=e=>{const q=e.target.value.toLowerCase();$('#memberGrid').innerHTML=members.filter(u=>(u.global_name||u.username).toLowerCase().includes(q)||displayRole(u).toLowerCase().includes(q)).map(memberCard).join('')||'<div class="empty">Kein Mitglied gefunden.</div>'}}
async function renderChat(){
  let isAdmin=false;
  if(me){try{isAdmin=Boolean((await api('/api/admin/status')).isAdmin)}catch{}}
  $('#page-chat').innerHTML=`<div class="card chat-shell"><div class="chat-head"><div><h2>◈ Öffentlicher Chat</h2><small style="color:#7f869f">Alle angemeldeten Zockerfreunde können hier schreiben.</small></div>${isAdmin?`<button class="secondary danger-btn" id="clearPublicChat">🗑 Chat leeren</button>`:''}</div><div id="publicMessages" class="messages"></div><form id="publicForm" class="composer"><input id="publicInput" maxlength="1000" placeholder="Nachricht schreiben ..." ${me?'':'disabled'}><button class="primary" ${me?'':'disabled'}>Senden</button></form></div>`;
  $('#publicForm').onsubmit=e=>{e.preventDefault();const i=$('#publicInput');if(i.value.trim()){socket?.emit('public_message',{message:i.value});i.value=''}};
  $('#clearPublicChat')?.addEventListener('click',clearPublicChat);
  loadPublic();
}
async function clearPublicChat(){
  if(!confirm('Möchtest du den öffentlichen Chat wirklich vollständig leeren? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
  try{await api('/api/chat/public',{method:'DELETE'});$('#publicMessages').innerHTML='';toast('Öffentlicher Chat wurde geleert.');}
  catch(e){toast('Chat konnte nicht geleert werden.');}
}
async function loadPublic(){try{const d=await api('/api/chat/public');$('#publicMessages').innerHTML=d.messages.map(messageHTML).join('');scrollMsgs()}catch{}}
function messageHTML(m){const mine=me&&sameId(m.user_id,me.id);return `<div class="msg ${mine?'me':''}"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(m))}"><div><div class="meta">${esc(m.global_name||m.username)} · ${esc(m.role)}</div><div class="bubble">${esc(m.message)}</div></div></div>`}
function scrollMsgs(){const e=$('#publicMessages');if(e)e.scrollTop=e.scrollHeight}
async function loadFriends(){if(!me)return;try{friendsData=await api('/api/friends')}catch(e){console.warn('Freunde konnten nicht geladen werden:',e)}}
function friendPerson(u,extra=''){return `<div class="friend-row"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div class="friend-main"><b>${esc(u.global_name||u.username)}</b><span>${esc(displayRole(u))}</span></div>${extra}</div>`}
function renderFriends(){
  if(!me){$('#page-friends').innerHTML='<div class="empty">Bitte melde dich mit Discord an, um deine Freunde zu sehen.</div>';return;}
  const friends=[...friendsData.friends], incoming=[...friendsData.incoming], sent=[...friendsData.sent], blocked=[...friendsData.blocked];
  $('#page-friends').innerHTML=`<div class="section-title"><div><h2>👥 Freunde</h2><div class="eyebrow">DEIN ZOCKERFREUNDE-NETZWERK</div></div><button class="secondary" onclick="loadFriends().then(renderFriends)">↻ Aktualisieren</button></div>
  <div class="friend-tabs"><button class="friend-tab active" data-ft="friends">Freunde <b>${friends.length}</b></button><button class="friend-tab" data-ft="incoming">Anfragen <b>${incoming.length}</b></button><button class="friend-tab" data-ft="sent">Gesendet <b>${sent.length}</b></button><button class="friend-tab" data-ft="blocked">Blockiert <b>${blocked.length}</b></button></div>
  <div id="friendPanel" class="card friend-panel"></div>`;
  const panel=$('#friendPanel');
  function draw(tab){
    $$('.friend-tab').forEach(b=>b.classList.toggle('active',b.dataset.ft===tab));
    if(tab==='friends') panel.innerHTML=friends.length?friends.map(u=>friendPerson(u,`<div class="friend-actions"><span class="favorite-mark">${u.favorite?'★':''}</span><button class="secondary small-btn" onclick='openFriendMenu(${JSON.stringify(String(u.id))})'>Öffnen</button></div>`)).join(''):'<div class="empty">Noch keine Freunde. Geh zu den Mitgliedern und sende eine Anfrage. 👤＋</div>';
    if(tab==='incoming') panel.innerHTML=incoming.length?incoming.map(u=>friendPerson(u,`<div class="friend-actions"><button class="primary small-btn" onclick="acceptFriend(${u.id})">Annehmen</button><button class="secondary small-btn" onclick="declineFriend(${u.id})">Ablehnen</button></div>`)).join(''):'<div class="empty">Keine offenen Freundschaftsanfragen.</div>';
    if(tab==='sent') panel.innerHTML=sent.length?sent.map(u=>friendPerson(u,`<div class="friend-actions"><span class="pending-label">Gesendet</span><button class="secondary small-btn" onclick="cancelFriend(${u.id})">Zurückziehen</button></div>`)).join(''):'<div class="empty">Keine verschickten Anfragen.</div>';
    if(tab==='blocked') panel.innerHTML=blocked.length?blocked.map(u=>friendPerson(u,`<div class="friend-actions"><button type="button" class="secondary small-btn unblock-friend-btn" data-unblock-friend="${esc(String(u.id))}">Entsperren</button></div>`)).join(''):'<div class="empty">Du hast niemanden blockiert.</div>';
  }
  $$('.friend-tab').forEach(b=>b.onclick=()=>draw(b.dataset.ft)); draw('friends');
}
async function sendFriendRequest(id,button){
  id=String(id);
  if(button?.disabled)return;
  try{
    if(button){button.disabled=true;button.classList.add('friend-request-sent');button.title='Anfrage wird gesendet …';}
    await api('/api/friends/request/'+encodeURIComponent(id),{method:'POST'});
    await loadFriends();
    renderMembers();
    if($('#page-home')?.classList.contains('active'))renderHome();
    if($('#page-friends')?.classList.contains('active'))renderFriends();
    toast('Freundschaftsanfrage gesendet!');
  }catch(e){
    if(button){button.disabled=false;button.classList.remove('friend-request-sent');button.title='Freundschaftsanfrage senden';}
    let msg='Anfrage konnte nicht gesendet werden.';
    try{const d=JSON.parse(String(e.message||''));if(d.error)msg=d.error;}catch{}
    toast(msg);
  }
}
async function acceptFriend(id){try{const target=friendsData.incoming.find(u=>u.id===String(id));const f=target;/* friendship id is not exposed in publicUser, use lookup helper below */await api('/api/friends/accept-by-user/'+id,{method:'POST'});await loadFriends();renderFriends();toast('Freundschaft angenommen!')}catch(e){toast('Anfrage konnte nicht angenommen werden.')}}
async function declineFriend(id){try{await api('/api/friends/decline-by-user/'+id,{method:'POST'});await loadFriends();renderFriends();toast('Anfrage abgelehnt.')}catch(e){toast('Anfrage konnte nicht abgelehnt werden.')}}
async function cancelFriend(id){try{await api('/api/friends/cancel-by-user/'+id,{method:'DELETE'});await loadFriends();renderFriends();toast('Anfrage zurückgezogen.')}catch(e){toast('Anfrage konnte nicht zurückgezogen werden.')}}
async function removeFriend(id){
  id=String(id);
  if(!confirm('Freund wirklich löschen?'))return;
  try{
    await api('/api/friends/'+encodeURIComponent(id),{method:'DELETE'});
    closeFriendMenu();
    await loadFriends();
    renderMembers();
    renderFriends();
    toast('Freund gelöscht. Die 👤＋-Taste ist wieder verfügbar.');
  }catch(e){toast('Freund konnte nicht gelöscht werden.');}
}
async function toggleFavorite(id,current){
  id=String(id);
  try{
    const result=await api('/api/friends/'+encodeURIComponent(id)+'/favorite',{
      method:'POST',
      body:JSON.stringify({favorite:!current})
    });
    closeFriendMenu();
    await loadFriends();
    renderMembers();
    renderFriends();
    toast(result.favorite?'Als Favorit markiert.':'Favorit entfernt.');
  }catch(e){toast('Favorit konnte nicht geändert werden.');}
}
async function unblockFriend(id,button){
  id=String(id);
  if(button?.disabled)return;
  const target=friendsData.blocked.find(u=>sameId(u.id,id));
  try{
    if(button){button.disabled=true;button.textContent='Wird entsperrt …';}
    const result=await api('/api/friends/'+encodeURIComponent(id)+'/block',{method:'DELETE'});
    if(!result?.ok)throw new Error(JSON.stringify({error:'Entsperren wurde nicht bestätigt.'}));
    friendsData.blocked=friendsData.blocked.filter(u=>!sameId(u.id,id));
    renderMembers();
    renderFriends();
    toast(`${target?(target.global_name||target.username):'Mitglied'} wurde entsperrt.`);
  }catch(e){
    if(button){button.disabled=false;button.textContent='Entsperren';}
    let msg='Entsperren fehlgeschlagen.';
    try{const d=JSON.parse(String(e.message||''));if(d.error)msg=d.error;}catch{}
    toast(msg);
  }
}
async function blockFriend(id){
  id=String(id);
  if(!confirm('Diese Person blockieren? Freundschaft und offene Anfrage werden entfernt.'))return;
  try{
    await api('/api/friends/'+encodeURIComponent(id)+'/block',{method:'POST'});
    closeFriendMenu();
    await loadFriends();
    renderMembers();
    renderFriends();
    toast('Person blockiert.');
  }catch(e){toast('Blockieren fehlgeschlagen.');}
}
function openFriendMenu(id){
  const sid=String(id);
  selectedFriend=members.find(u=>sameId(u.id,sid))||friendsData.friends.find(u=>sameId(u.id,sid));
  if(!selectedFriend)return;
  const current=Boolean(friendsData.friends.find(u=>sameId(u.id,sid))?.favorite);
  let old=$('#friendActionModal');if(old)old.remove();
  const e=document.createElement('div');e.id='friendActionModal';e.className='friend-modal';
  e.innerHTML=`<div class="friend-modal-card">
    <button type="button" class="gate-close" data-friend-action="close">×</button>
    <div class="friend-modal-user"><img class="avatar" src="${esc(avatar(selectedFriend))}">
      <div><h2>${esc(selectedFriend.global_name||selectedFriend.username)}</h2><span>${esc(displayRole(selectedFriend))}</span></div>
    </div>
    <div class="friend-choice-grid">
      <button type="button" class="friend-choice" data-friend-action="private"><strong>1</strong><span>✉</span><b>Privaten Chat starten</b></button>
      <button type="button" class="friend-choice" data-friend-action="favorite"><strong>2</strong><span>${current?'★':'☆'}</span><b>${current?'Favorit entfernen':'Freund favorisieren'}</b></button>
      <button type="button" class="friend-choice danger" data-friend-action="remove"><strong>3</strong><span>🗑</span><b>Freund löschen</b></button>
      <button type="button" class="friend-choice danger" data-friend-action="block"><strong>4</strong><span>⛔</span><b>Freund blockieren</b></button>
    </div>
  </div>`;
  document.body.appendChild(e);
  e.addEventListener('click',async event=>{
    const button=event.target.closest('[data-friend-action]');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    const action=button.dataset.friendAction;
    if(action==='close'){closeFriendMenu();return;}
    if(action==='private'){closeFriendMenu();await startPrivate(sid);return;}
    if(action==='favorite'){await toggleFavorite(sid,current);return;}
    if(action==='remove'){await removeFriend(sid);return;}
    if(action==='block'){await blockFriend(sid);return;}
  });
  requestAnimationFrame(()=>e.classList.add('show'));
}
function closeFriendMenu(){const e=$('#friendActionModal');if(e){e.classList.remove('show');setTimeout(()=>e.remove(),180)}selectedFriend=null}
async function loadOldFriends(){if(!me)return {friends:[]};try{return await api('/api/friends/history')}catch{return {friends:[]}}}
function renderPrivate(){
  const friends=(friendsData.friends||[]).filter(u=>!sameId(u.id,me?.id));
  const oldIds=new Set(friends.map(u=>String(u.id)));
  const oldPromise=loadOldFriends();
  $('#page-private').innerHTML=`<div class="private-layout private-enhanced"><div class="card chat-list"><div class="private-list-head"><div><h3>Private Chats</h3><small>Nur deine Freunde</small></div></div><div id="privateFriendsList"></div><button class="secondary old-friends-toggle" id="oldFriendsToggle" type="button">Alte Freunde</button><div id="oldFriendsList" class="old-friends-list hidden"></div></div><div id="privatePanel" class="card chat-shell"><div class="empty">Wähle links einen Chat aus.</div></div></div>`;
  const list=$('#privateFriendsList');
  list.innerHTML=friends.map(u=>`<button type="button" class="chat-person" data-private-user="${esc(String(u.id))}"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'}</div></div></button>`).join('')||'<div class="empty compact">Noch keine Freunde. Füge zuerst Freunde hinzu.</div>';
  list.querySelectorAll('[data-private-user]').forEach(b=>b.onclick=()=>startPrivate(b.dataset.privateUser));
  $('#oldFriendsToggle').onclick=async()=>{
    const box=$('#oldFriendsList');box.classList.toggle('hidden');
    if(!box.classList.contains('hidden')){const d=await oldPromise;const old=(d.friends||[]).filter(u=>!oldIds.has(String(u.id)));box.innerHTML=old.map(u=>`<button type="button" class="chat-person old-friend" data-private-user="${esc(String(u.id))}"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><small>Alte Freundschaft</small></div></button>`).join('')||'<div class="empty compact">Keine alten Freunde gespeichert.</div>';box.querySelectorAll('[data-private-user]').forEach(b=>b.onclick=()=>startPrivate(b.dataset.privateUser));}
  };
}
async function startPrivate(id){
  id=String(id); if(!me){toast('Bitte zuerst mit Discord anmelden.');return;}
  let target=(members||[]).find(u=>sameId(u.id,id))||(friendsData.friends||[]).find(u=>sameId(u.id,id));
  if(!target){try{const fresh=await api('/api/member/'+encodeURIComponent(id));target=fresh?.member||null;}catch{}}
  if(!target){toast('Mitglied nicht gefunden.');return;}
  currentPrivate=target; if($('#page-private')?.classList.contains('active')===false) await go('private'); else renderPrivate(); await openPrivate();
}
async function openPrivate(){if(!currentPrivate)return;const p=$('#privatePanel');if(!p)return;p.innerHTML=`<div class="chat-head"><div><h2>✉ ${esc(currentPrivate.global_name||currentPrivate.username)}</h2><small class="online-label"><i class="dot ${isOnline(currentPrivate)?'online':''}"></i>${isOnline(currentPrivate)?'Online':'Offline'}</small></div></div><div id="privateMessages" class="messages"></div><form id="privateForm" class="composer"><input id="privateInput" maxlength="1000" placeholder="Private Nachricht ..."><button class="primary">Senden</button></form>`;$('#privateForm').onsubmit=async e=>{e.preventDefault();const i=$('#privateInput');const text=i.value.trim();if(!text||!currentPrivate)return;try{await api('/api/chat/private/'+encodeURIComponent(currentPrivate.id),{method:'POST',body:JSON.stringify({message:text})});i.value='';}catch{toast('Private Nachricht konnte nicht gesendet werden.')}};try{const d=await api('/api/chat/private/'+encodeURIComponent(currentPrivate.id));$('#privateMessages').innerHTML=d.messages.map(messageHTML).join('');scrollPrivate()}catch{toast('Privater Chat konnte nicht geladen werden.')};}
function scrollPrivate(){const e=$('#privateMessages');if(e)e.scrollTop=e.scrollHeight}

async function loadCommunityServers(){if(!me)return;const d=await api('/api/servers');communityServers=d.servers||[];if(currentCommunityServer&&!communityServers.some(s=>sameId(s.id,currentCommunityServer.id)))currentCommunityServer=null;if(!currentCommunityServer&&communityServers.length)currentCommunityServer=communityServers[0];}
async function loadDiscoverableServers(q=''){const d=await api('/api/servers/discover'+(q?`?q=${encodeURIComponent(q)}`:''));return d.servers||[];}
async function openDiscoverServers(){const modal=document.createElement('div');modal.className='server-modal server-discover-modal';modal.innerHTML=`<div class="server-modal-card server-discover-card"><button class="gate-close" data-close>×</button><div class="discover-hero"><div class="discover-hero-icon">🔎</div><div><div class="eyebrow">SERVER ENTDECKEN</div><h2>Finde deine nächste Community</h2><p>Nur Server, die ihr Besitzer ausdrücklich für die Entdeckung freigegeben hat, erscheinen hier. Private Server bleiben unsichtbar.</p></div></div><div class="discover-search"><input id="discoverSearchInput" class="settings-input" placeholder="Server suchen …"><button id="discoverSearchBtn" class="primary">Suchen</button></div><div id="discoverResults" class="discover-results"><div class="empty">Lade Server …</div></div></div>`;document.body.appendChild(modal);modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));const load=async()=>{const q=modal.querySelector('#discoverSearchInput').value.trim();const list=await loadDiscoverableServers(q);modal.querySelector('#discoverResults').innerHTML=list.map(x=>`<div class="discover-server-card"><div class="discover-server-icon">${x.icon?`<img src="${esc(x.icon)}" alt="">`:esc((x.name||'?').slice(0,1).toUpperCase())}</div><div class="discover-server-copy"><h3>${esc(x.name)}</h3><p>${esc(x.description||'Keine Beschreibung.')}</p><small>👥 ${Number(x.member_count||0)} Mitglieder</small></div><button class="secondary discover-join" data-discover-server-id="${x.id}" >${x.joined?'↗ Öffnen':'🔗 Einladung nötig'}</button></div>`).join('')||'<div class="empty">Keine passenden öffentlichen Server gefunden.</div>';modal.querySelectorAll('[data-discover-server-id]').forEach(b=>b.onclick=async()=>{const id=Number(b.dataset.discoverServerId);const item=list.find(x=>Number(x.id)===id);if(item?.joined){modal.remove();await openCommunityServer(id)}else toast('Zum Beitreten brauchst du eine Einladung.')} )};modal.querySelector('#discoverSearchBtn').onclick=load;modal.querySelector('#discoverSearchInput').onkeydown=e=>{if(e.key==='Enter')load()};await load();}

function serverInviteUrl(code){return `${location.origin}/?invite=${encodeURIComponent(code)}`}
async function openCommunityServer(id){try{const d=await api('/api/servers/'+encodeURIComponent(id));currentCommunityServer=d.server;currentCommunityData=d;const first=d.channels.find(c=>c.type==='text');currentCommunityChannel=first||d.channels[0]||null;renderServers();if(currentCommunityChannel&&currentCommunityChannel.type==='text')await openCommunityChannel(currentCommunityChannel.id);}catch(e){toast('Server konnte nicht geladen werden.')}}
function serverCard(s){return `<button type="button" class="server-entry ${sameId(currentCommunityServer?.id,s.id)?'active':''}" data-community-server="${esc(String(s.id))}"><span class="server-entry-dot">${s.icon?`<img class="server-list-icon" src="${esc(s.icon)}" alt="">`:esc((s.name||'?').slice(0,1).toUpperCase())}</span><span><b>${esc(s.name)}</b><small>${Number(s.member_count||0)} Mitglieder${s.description?` · ${esc(s.description.slice(0,35))}`:''}</small></span></button>`}
function serverFormModal(title,body,onSave){
  const m=document.createElement('div');m.className='server-modal zf-zero-modal';m.innerHTML=`<div class="server-modal-card zf-zero-modal-card"><button class="gate-close" data-zf-close>×</button><div class="eyebrow">SERVER</div><h2>${title}</h2><div class="zf-modal-body">${body}</div><div class="actions"><button class="secondary" data-zf-close>Abbrechen</button><button class="primary" id="zfModalSave">Speichern</button></div></div>`;document.body.appendChild(m);m.querySelectorAll('[data-zf-close]').forEach(b=>b.onclick=()=>m.remove());requestAnimationFrame(()=>m.classList.add('show'));m.querySelector('#zfModalSave').onclick=async()=>{const btn=m.querySelector('#zfModalSave');btn.disabled=true;try{await onSave(m);m.remove()}catch(e){toast(e?.message||'Aktion konnte nicht ausgeführt werden.');btn.disabled=false}};return m;
}
async function createCommunityServer(){
  serverFormModal('Neuen Server erstellen',`<label class="field-label">Name<input id="zfServerName" class="settings-input" maxlength="48" placeholder="z. B. Zocker Lounge"></label><label class="field-label">Beschreibung<textarea id="zfServerDesc" class="settings-input" maxlength="240" rows="3" placeholder="Worum geht es in deinem Server?"></textarea><label class="field-label">Icon-URL<input id="zfServerIcon" class="settings-input" maxlength="400" placeholder="https://…"></label>`,async m=>{const name=m.querySelector('#zfServerName').value.trim();if(name.length<2)throw Error('Bitte einen Servernamen eingeben.');const d=await api('/api/servers',{method:'POST',body:JSON.stringify({name,description:m.querySelector('#zfServerDesc').value.trim(),icon:m.querySelector('#zfServerIcon').value.trim()})});toast('Server erstellt.');await loadCommunityServers();await openCommunityServer(d.server.id)});
}
async function joinCommunityInvite(){
  serverFormModal('Mit Einladung beitreten',`<label class="field-label">Einladung<input id="zfInviteCode" class="settings-input" placeholder="Code oder kompletter Einladungslink"></label><small class="zf-form-note">Du kannst einen vollständigen ZockerFreunde-Einladungslink oder nur den Code einfügen.</small>`,async m=>{const value=m.querySelector('#zfInviteCode').value.trim();if(!value)throw Error('Einladung fehlt.');const d=await api('/api/invites/join',{method:'POST',body:JSON.stringify({invite:value})});toast(`${d.serverName} beigetreten.`);await loadCommunityServers();await openCommunityServer(d.serverId)});
}
async function createCommunityInvite(){
  if(!currentCommunityServer)return;serverFormModal('Mitglieder einladen',`<div class="zf-invite-grid"><label class="field-label">Gültigkeit<select id="zfInviteHours" class="settings-input"><option value="24">24 Stunden</option><option value="72">3 Tage</option><option value="168">7 Tage</option><option value="0">Unbegrenzt</option></select></label><label class="field-label">Maximale Nutzung<select id="zfInviteUses" class="settings-input"><option value="0">Unbegrenzt</option><option value="1">1 Nutzung</option><option value="5">5 Nutzungen</option><option value="25">25 Nutzungen</option><option value="100">100 Nutzungen</option></select></label></div><div id="zfInviteResult" class="zf-invite-result hidden"></div>`,async m=>{const hours=Number(m.querySelector('#zfInviteHours').value);const max=Number(m.querySelector('#zfInviteUses').value);const d=await api(`/api/servers/${currentCommunityServer.id}/invites`,{method:'POST',body:JSON.stringify({expiresHours:hours,maxUses:max})});const url=serverInviteUrl(d.invite.code);m.querySelector('.zf-modal-body').insertAdjacentHTML('beforeend',`<div class="zf-generated-invite"><b>Einladung erstellt</b><input class="settings-input" readonly value="${esc(url)}"><small>Code: ${esc(d.invite.code)}</small></div>`);await navigator.clipboard?.writeText(url).catch(()=>{});toast('Einladung erstellt und kopiert.');m.querySelector('#zfModalSave').textContent='Schließen'});
}
async function createCommunitySection(){
  if(!currentCommunityServer)return;serverFormModal('Kategorie erstellen',`<label class="field-label">Name<input id="zfSectionName" class="settings-input" maxlength="32" placeholder="z. B. COMMUNITY"></label>`,async m=>{const name=m.querySelector('#zfSectionName').value.trim();if(!name)throw Error('Name fehlt.');await api(`/api/servers/${currentCommunityServer.id}/sections`,{method:'POST',body:JSON.stringify({name})});toast('Kategorie erstellt.');await openCommunityServer(currentCommunityServer.id)})
}
async function editCommunitySection(id){const sec=(currentCommunityData?.sections||[]).find(x=>sameId(x.id,id));if(!sec)return;serverFormModal('Kategorie bearbeiten',`<label class="field-label">Name<input id="zfSectionName" class="settings-input" maxlength="32" value="${esc(sec.name)}"></label>`,async m=>{const name=m.querySelector('#zfSectionName').value.trim();if(!name)throw Error('Name fehlt.');await api(`/api/servers/${currentCommunityServer.id}/sections/${id}`,{method:'PATCH',body:JSON.stringify({name})});toast('Kategorie gespeichert.');await openCommunityServer(currentCommunityServer.id)})}
async function createCommunityChannel(){
  if(!currentCommunityServer)return;const sections=currentCommunityData?.sections||[];serverFormModal('Kanal erstellen',`<label class="field-label">Name<input id="zfChannelName" class="settings-input" maxlength="32" placeholder="z. B. gaming"></label><label class="field-label">Typ<select id="zfChannelType" class="settings-input"><option value="text"># Textkanal</option><option value="voice">◉ Sprachkanal</option></select></label><label class="field-label">Kategorie<select id="zfChannelSection" class="settings-input">${sections.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`,async m=>{const name=m.querySelector('#zfChannelName').value.trim();if(!name)throw Error('Kanalname fehlt.');await api(`/api/servers/${currentCommunityServer.id}/channels`,{method:'POST',body:JSON.stringify({name,type:m.querySelector('#zfChannelType').value,sectionId:Number(m.querySelector('#zfChannelSection').value)})});toast('Kanal erstellt.');await openCommunityServer(currentCommunityServer.id)})
}
async function editCommunityChannel(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c)return;const sections=currentCommunityData?.sections||[];serverFormModal('Kanal bearbeiten',`<label class="field-label">Name<input id="zfChannelName" class="settings-input" maxlength="32" value="${esc(c.name)}"></label><label class="field-label">Kategorie<select id="zfChannelSection" class="settings-input">${sections.map(x=>`<option value="${x.id}" ${sameId(x.id,c.section_id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`,async m=>{const name=m.querySelector('#zfChannelName').value.trim();if(!name)throw Error('Kanalname fehlt.');await api(`/api/servers/${currentCommunityServer.id}/channels/${id}`,{method:'PATCH',body:JSON.stringify({name,sectionId:Number(m.querySelector('#zfChannelSection').value)})});toast('Kanal gespeichert.');await openCommunityServer(currentCommunityServer.id)})}
async function leaveServer(){if(!currentCommunityServer)return;const owner=Number(currentCommunityServer.owner_id)===Number(me.id);if(!(await serverConfirm(owner?'Server löschen?':'Server verlassen?',owner?'Der komplette Server und seine Inhalte werden gelöscht.':'Du verlässt diesen Server.','Bestätigen')))return;try{await api(`/api/servers/${currentCommunityServer.id}/${owner?'':'leave'}`,{method:'POST'}).catch(async()=>{if(owner)return api(`/api/servers/${currentCommunityServer.id}`,{method:'DELETE'});throw Error()});if(owner)await api(`/api/servers/${currentCommunityServer.id}`,{method:'DELETE'});currentCommunityServer=null;currentCommunityData=null;currentCommunityChannel=null;await loadCommunityServers();renderServers();toast(owner?'Server gelöscht.':'Server verlassen.')}catch{toast('Aktion konnte nicht ausgeführt werden.')}}
async function openServerSettings(){
  if(!currentCommunityServer||Number(currentCommunityServer.owner_id)!==Number(me.id))return;const d=currentCommunityData;const m=document.createElement('div');m.className='server-modal zf-zero-modal';m.innerHTML=`<div class="server-modal-card zf-settings-zero"><button class="gate-close" data-close>×</button><div class="eyebrow">SERVER VERWALTEN</div><h2>⚙ ${esc(d.server.name)}</h2><div class="zf-settings-tabs"><button class="active" data-tab="server">Server & Design</button><button data-tab="roles">Rollen & Mitglieder</button></div><div class="zf-settings-pane" data-pane="server"><label class="field-label">Servername<input id="zsName" class="settings-input" value="${esc(d.server.name)}"></label><label class="field-label">Beschreibung<textarea id="zsDesc" class="settings-input" rows="3">${esc(d.server.description||'')}</textarea></label><label class="field-label">Icon-URL<input id="zsIcon" class="settings-input" value="${esc(d.server.icon||'')}"></label><label class="zf-check-row"><input id="zsDiscover" type="checkbox" ${d.server.discoverable?'checked':''}><span><b>Server entdecken lassen</b><small>Andere können den Server finden, aber weiterhin nur per Einladung beitreten.</small></span></label><div class="zf-color-grid"><label>Chat-Hintergrund<input id="zsBg" type="color" value="${esc(d.server.chat_bg||'#0b1020')}"></label><label>Chat-Text<input id="zsText" type="color" value="${esc(d.server.chat_text||'#f4f7ff')}"></label><label>Chat-Bubble<input id="zsBubble" type="color" value="${esc(d.server.chat_bubble||'#171e33')}"></label></div><button class="primary" id="zsSave">Änderungen speichern</button></div><div class="zf-settings-pane hidden" data-pane="roles"><div class="zf-role-list">${(d.roles||[]).map(r=>`<div class="zf-role-item"><span style="color:${esc(r.color)}">●</span><b>${esc(r.name)}</b><small>${Object.values(r.permissions||{}).filter(Boolean).length} Rechte</small></div>`).join('')||'<div class="empty">Noch keine Rollen.</div>'}</div><div class="zf-member-role-manage">${(d.members||[]).map(u=>`<div><span>${esc(u.global_name||u.username)}</span><small>${esc(u.community_role_name||'Mitglied')}</small></div>`).join('')}</div></div></div>`;document.body.appendChild(m);m.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>m.remove());m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{m.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));m.querySelectorAll('[data-pane]').forEach(x=>x.classList.toggle('hidden',x.dataset.pane!==b.dataset.tab))});m.querySelector('#zsSave').onclick=async()=>{try{await api(`/api/servers/${d.server.id}`,{method:'PATCH',body:JSON.stringify({name:m.querySelector('#zsName').value.trim(),description:m.querySelector('#zsDesc').value.trim(),icon:m.querySelector('#zsIcon').value.trim(),discoverable:m.querySelector('#zsDiscover').checked,chatBg:m.querySelector('#zsBg').value,chatText:m.querySelector('#zsText').value,chatBubble:m.querySelector('#zsBubble').value})});m.remove();toast('Server gespeichert.');await openCommunityServer(d.server.id)}catch{toast('Server konnte nicht gespeichert werden.')}};requestAnimationFrame(()=>m.classList.add('show'))
}
function renderServers(){
  const root=$('#page-servers');
  if(!me){root.innerHTML='<div class="empty">Bitte melde dich mit Discord an.</div>';return;}
  const d=currentCommunityData||{}; const s=d.server; const sections=d.sections||[]; const channels=d.channels||[];
  const canManage=Number(s?.owner_id)===Number(me.id); const members=d.members||[];
  const grouped={}; members.forEach(u=>{const key=u.community_role_name||u.role||'Mitglied';(grouped[key]??=[]).push(u)});
  const memberGroups=Object.entries(grouped).map(([role,users])=>'<section class="server25-role" data-role-group="'+esc(role.toLowerCase())+'"><div class="server25-role-head"><span>'+esc(role)+'</span><b>'+users.length+'</b></div>'+users.map(u=>'<button class="server25-member" type="button" data-server-member-id="'+u.id+'" data-member-search="'+esc((u.global_name||u.username||'').toLowerCase())+'"><span class="server25-avatar"><img '+avatarAttrs(u)+'><i class="dot '+(isOnline(u)?'online':'')+'"></i></span><span><b>'+esc(u.global_name||u.username)+'</b><small>'+(isOnline(u)?'Online':'Offline')+' · '+esc(u.community_role_name||u.role||'Mitglied')+'</small></span></button>').join('')+'</section>').join('');
  const channelMarkup=sections.map(sec=>{const cs=channels.filter(c=>Number(c.section_id)===Number(sec.id));const rows=cs.map(c=>'<div class="server25-channel-wrap"><button class="server25-channel '+(sameId(currentCommunityChannel?.id,c.id)?'active':'')+'" data-channel-id="'+(c.type==='text'?c.id:'')+'" data-voice-id="'+(c.type==='voice'?c.id:'')+'"><span>'+(c.type==='text'?'#':'◉')+'</span><b>'+esc(c.name)+'</b>'+(serverUnread.get(Number(c.id))?'<em>'+serverUnread.get(Number(c.id))+'</em>':'')+'</button>'+(canManage?'<span class="server25-channel-actions"><button data-edit-channel="'+c.id+'">✎</button><button data-delete-channel="'+c.id+'">×</button></span>':'')+'</div>').join('');return '<section class="server25-category"><div class="server25-category-head"><button data-toggle-section="'+sec.id+'">⌄ '+esc(sec.name)+'</button>'+(canManage?'<span><button class="server25-mini" data-edit-section="'+sec.id+'">✎</button></span>':'')+'</div><div class="server25-channel-list">'+(rows||'<div class="server25-empty">Keine Kanäle</div>')+'</div></section>'}).join('');
  const serverRail=communityServers.map(srv=>'<button class="server25-server '+(sameId(currentCommunityServer?.id,srv.id)?'active':'')+'" data-community-server="'+srv.id+'" title="'+esc(srv.name)+'"><span>'+(srv.icon?'<img src="'+esc(srv.icon)+'" alt="">':esc((srv.name||'?').slice(0,1).toUpperCase()))+'</span><b>'+esc(srv.name)+'</b></button>').join('');
  root.innerHTML=`<div class="server25-shell">
    <header class="server25-header"><div class="server25-title"><div class="server25-logo">S</div><div><small>ZOCKERFREUNDE</small><h1>Server</h1></div></div><div class="server25-header-search">⌕<input id="server25QuickSearch" placeholder="Server, Kanal oder Mitglied suchen …"></div><div class="server25-header-actions"><button id="discoverCommunityServers">Entdecken</button><button id="joinCommunityInvite">Einladung</button><button data-create-server class="accent">＋ Neuer Server</button></div></header>
    ${s?`<div class="server25-body">
      <aside class="server25-rail"><div class="server25-rail-title">SERVER</div>${serverRail||'<div class="server25-no-servers">Noch keine Server</div>'}<button class="server25-add" data-create-server>＋</button></aside>
      <aside class="server25-nav"><div class="server25-nav-head"><div class="server25-server-card"><span class="server25-big-icon">${s.icon?`<img src="${esc(s.icon)}" alt="">`:esc((s.name||'?').slice(0,1).toUpperCase())}</span><div><strong>${esc(s.name)}</strong><small>${canManage?'Besitzer':'Mitglied'}</small></div></div><button id="inviteCommunityServer" title="Einladen">↗</button></div><p class="server25-description">${esc(s.description||'Deine Community, deine Regeln.')}</p><div class="server25-nav-tools"><b>Kanäle</b>${canManage?`<span><button id="addCommunitySection">＋</button><button id="addCommunityChannel">◈</button></span>`:''}</div><div class="server25-channels">${channelMarkup||'<div class="server25-empty">Noch keine Kanäle.</div>'}</div><div class="server25-account"><span class="server25-avatar"><img ${avatarAttrs(me)}><i class="dot online"></i></span><div><b>${esc(me.global_name||me.username)}</b><small>Online</small></div><button id="openServerSettings" ${canManage?'':'disabled'}>⚙</button></div></aside>
      <main class="server25-main"><div class="server25-mobile-tabs"><button id="server25ChannelsTab" class="active">Kanäle</button><button id="server25ChatTab">Chat</button><button id="server25MembersTab">Mitglieder</button></div><header class="server25-main-head"><div><div class="server25-kicker">${currentCommunityChannel?.type==='voice'?'SPRACHKANAL':'TEXTKANAL'}</div><h2>${esc(currentCommunityChannel?.name||'Willkommen')}</h2><p>${currentCommunityChannel?esc(s.name):'Wähle links einen Kanal, um loszulegen.'}</p></div><div class="server25-main-actions">${canManage?'<button id="zfManageServer">⚙ Verwalten</button>':''}<button id="zfInviteMain">＋ Einladen</button><button id="leaveCommunityServer" class="danger">${canManage?'Server löschen':'Server verlassen'}</button></div></header><div id="serverChannelView" class="server25-content">${currentCommunityChannel?'<div class="server25-loading"><div></div><b>Kanal wird geladen</b><small>Nachrichten werden vorbereitet …</small></div>':'<div class="server25-hero"><span>✦</span><small>DEIN SERVER</small><h2>${esc(s.name)}</h2><p>Wähle einen Kanal oder erstelle einen neuen Bereich für deine Community.</p><div><button id="server25HeroChannel">＋ Kanal erstellen</button><button id="server25HeroInvite">↗ Freunde einladen</button></div></div>'}</div></main>
      <aside class="server25-members"><div class="server25-members-head"><div><small>COMMUNITY</small><h3>Mitglieder</h3><span>${members.length} insgesamt</span></div></div><div class="server25-member-search">⌕<input id="serverMemberSearch" placeholder="Mitglied suchen …"></div><div class="server25-member-list">${memberGroups||'<div class="server25-empty">Keine Mitglieder.</div>'}</div></aside>
    </div>`:`<div class="server25-empty-state"><div class="server25-empty-icon">S</div><small>SERVER</small><h2>Deine Community beginnt hier.</h2><p>Erstelle einen Server für deine Freunde, Spiele und Gespräche.</p><div><button data-create-server class="accent">＋ Server erstellen</button><button id="joinCommunityInvite">↗ Einladung verwenden</button><button id="discoverCommunityServers">⌕ Entdecken</button></div></div>`}
  </div>`;
  $$('#page-servers [data-community-server]').forEach(b=>b.onclick=()=>openCommunityServer(Number(b.dataset.communityServer)));
  $$('#page-servers [data-create-server]').forEach(b=>b.addEventListener('click',createCommunityServer)); $('#joinCommunityInvite')?.addEventListener('click',joinCommunityInvite); $('#discoverCommunityServers')?.addEventListener('click',openDiscoverServers);
  $('#inviteCommunityServer')?.addEventListener('click',createCommunityInvite); $('#zfInviteMain')?.addEventListener('click',createCommunityInvite); $('#openServerSettings')?.addEventListener('click',()=>canManage&&openServerSettings()); $('#zfManageServer')?.addEventListener('click',()=>canManage&&openServerSettings());
  $('#addCommunityChannel')?.addEventListener('click',createCommunityChannel); $('#addCommunitySection')?.addEventListener('click',createCommunitySection); $('#leaveCommunityServer')?.addEventListener('click',leaveServer);
  $('#server25HeroChannel')?.addEventListener('click',createCommunityChannel); $('#server25HeroInvite')?.addEventListener('click',createCommunityInvite);
  $$('#page-servers [data-channel-id]').forEach(b=>b.onclick=()=>b.dataset.channelId&&openCommunityChannel(Number(b.dataset.channelId))); $$('#page-servers [data-voice-id]').forEach(b=>b.onclick=()=>b.dataset.voiceId&&openVoiceLobby(Number(b.dataset.voiceId)));
  $$('#page-servers [data-edit-channel]').forEach(b=>b.onclick=e=>{e.stopPropagation();editCommunityChannel(Number(b.dataset.editChannel))}); $$('#page-servers [data-delete-channel]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteCommunityChannel(Number(b.dataset.deleteChannel))}); $$('#page-servers [data-edit-section]').forEach(b=>b.onclick=e=>{e.stopPropagation();editCommunitySection(Number(b.dataset.editSection))});
  $$('#page-servers [data-toggle-section]').forEach(b=>b.onclick=()=>{const list=b.closest('.server25-category')?.querySelector('.server25-channel-list');if(list)list.classList.toggle('collapsed');b.textContent=list?.classList.contains('collapsed')?'› '+b.textContent.slice(2):'⌄ '+b.textContent.slice(2)});
  const search=$('#serverMemberSearch'); search?.addEventListener('input',e=>{serverMemberSearchValue=e.target.value.trim().toLowerCase(); $$('#page-servers .server25-member').forEach(b=>b.style.display=(!serverMemberSearchValue||String(b.dataset.memberSearch||'').includes(serverMemberSearchValue))?'flex':'none'); $$('#page-servers .server25-role').forEach(g=>g.style.display=[...g.querySelectorAll('.server25-member')].some(x=>x.style.display!=='none')?'':'none')});
  $('#server25ChannelsTab')?.addEventListener('click',()=>{$('#page-servers .server25-nav')?.classList.remove('mobile-hidden');$('#page-servers .server25-main')?.classList.add('mobile-hidden');$('#page-servers .server25-members')?.classList.remove('mobile-show')}); $('#server25ChatTab')?.addEventListener('click',()=>{$('#page-servers .server25-nav')?.classList.add('mobile-hidden');$('#page-servers .server25-main')?.classList.remove('mobile-hidden');$('#page-servers .server25-members')?.classList.remove('mobile-show')}); $('#server25MembersTab')?.addEventListener('click',()=>{$('#page-servers .server25-nav')?.classList.add('mobile-hidden');$('#page-servers .server25-main')?.classList.add('mobile-hidden');$('#page-servers .server25-members')?.classList.add('mobile-show')});
  $('#server25QuickSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase(); if(!q){$$('.server25-channel,.server25-server,.server25-member').forEach(x=>x.style.display='');return;} $$('.server25-channel').forEach(x=>x.style.display=x.innerText.toLowerCase().includes(q)?'flex':'none'); $$('.server25-server').forEach(x=>x.style.display=x.innerText.toLowerCase().includes(q)?'flex':'none'); $$('.server25-member').forEach(x=>x.style.display=x.innerText.toLowerCase().includes(q)?'flex':'none')});
  if(currentVoiceChannel)renderPersistentVoiceBar();
}
async function deleteCommunityChannel(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c)return;if(!(await serverConfirm('Kanal löschen?',`#${c.name} wird dauerhaft gelöscht.`,'Kanal löschen')))return;try{await api(`/api/servers/${currentCommunityServer.id}/channels/${id}`,{method:'DELETE'});toast('Kanal gelöscht.');currentCommunityChannel=null;await openCommunityServer(currentCommunityServer.id)}catch{toast('Kanal konnte nicht gelöscht werden.')}}
async function openCommunityChannel(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c||c.type!=='text')return;serverUnread.delete(Number(c.id));currentCommunityChannel=c;socket?.emit('server_channel_watch',{serverId:Number(currentCommunityServer.id),channelId:Number(c.id)});$$('#page-servers [data-channel-id]').forEach(b=>b.classList.toggle('active',sameId(b.dataset.channelId,c.id)));const view=$('#serverChannelView');if(!view)return;view.style.setProperty('--chat-bg',currentCommunityData?.server?.chat_bg||'#0b1020');view.style.setProperty('--chat-text',currentCommunityData?.server?.chat_text||'#f4f7ff');view.style.setProperty('--chat-bubble',currentCommunityData?.server?.chat_bubble||'#171e33');view.innerHTML=`<div class="server-chat-head"><div class="server-chat-title"><div class="server-channel-title-icon">#</div><div><h3>${esc(c.name)}</h3><small>Textkanal · ${Number(serverUnread.get(Number(c.id))||0)?`${Number(serverUnread.get(Number(c.id)))} neue Nachrichten`:'bereit zum Chatten'}</small></div></div><div class="chat-tools"><button class="secondary" id="serverPinnedBtn" title="Angepinnte Nachrichten">📌 <span>Angepinnt</span></button><button class="secondary" id="serverBottomBtn" title="Zum Ende springen">↓ <span>Neueste</span></button><label class="file-btn" title="Datei anhängen">📎<input id="serverFileInput" type="file" multiple hidden></label><button class="secondary" id="serverPollBtn">📊 Umfrage</button></div></div><div id="serverPinnedBar" class="server-pinned-bar hidden"></div><div id="serverAttachmentsPreview" class="attachment-preview"></div><div id="serverMessages" class="messages"></div><form id="serverMessageForm" class="composer"><input id="serverMessageInput" maxlength="1000" placeholder="# ${esc(c.name)} schreiben …"><button class="primary">Senden</button></form>`;const perms=currentCommunityData.permissions||{};if(!perms.attach_files)$('#serverFileInput')?.remove();let pendingFiles=[];$('#serverFileInput')?.addEventListener('change',async e=>{pendingFiles=Array.from(e.target.files||[]);$('#serverAttachmentsPreview').innerHTML=pendingFiles.map(f=>`<span class="attachment-chip">${esc(f.name)}</span>`).join('')});if(!perms.create_polls)$('#serverPollBtn')?.remove();else $('#serverPollBtn')?.addEventListener('click',createPollForCurrentChannel);let serverChatCooldownUntil=0;
$('#serverMessageForm').onsubmit=async e=>{e.preventDefault();const i=$('#serverMessageInput');const text=i.value.trim();if(!text&&!pendingFiles.length)return;const left=Math.ceil((serverChatCooldownUntil-Date.now())/1000);if(left>0){toast(`Bitte noch ${left} Sek. warten.`);return;}try{const attachments=await filesToData(pendingFiles);const d=await api(`/api/servers/${currentCommunityServer.id}/channels/${c.id}/messages`,{method:'POST',body:JSON.stringify({message:text,attachments})});serverChatCooldownUntil=Date.now()+5000;i.value='';pendingFiles=[];$('#serverAttachmentsPreview').innerHTML='';const btn=$('#serverMessageForm button');if(btn){btn.disabled=true;let remain=5;const timer=setInterval(()=>{remain--;btn.textContent=remain>0?`Warten (${remain})`:'Senden';if(remain<=0){clearInterval(timer);btn.disabled=false}},1000)}}catch(err){try{const info=JSON.parse(err.message);if(info.retryAfter){serverChatCooldownUntil=Date.now()+Number(info.retryAfter)*1000;toast(info.error||`Bitte noch ${info.retryAfter} Sek. warten.`);return}}catch{}toast('Nachricht oder Dateien konnten nicht gesendet werden.')}};try{const d=await api(`/api/servers/${currentCommunityServer.id}/channels/${c.id}/messages`);const e=$('#serverMessages');if(e)e.innerHTML=d.messages.map(communityMessageHTML).join('');
const showPinned=()=>{const rows=[...($('#serverMessages')?.querySelectorAll('.is-pinned')||[])];const bar=$('#serverPinnedBar');if(!bar)return;bar.innerHTML=rows.length?`<b>📌 ${rows.length} angepinnt</b><button type="button" class="secondary" id="closePinnedBar">Schließen</button>`:'<span>Keine angepinnten Nachrichten.</span>';bar.classList.remove('hidden');$('#closePinnedBar')?.addEventListener('click',()=>bar.classList.add('hidden'))};
$('#serverPinnedBtn')?.addEventListener('click',showPinned);$('#serverBottomBtn')?.addEventListener('click',scrollCommunityMessages);$('#serverMessages')?.addEventListener('scroll',e=>{const el=e.currentTarget;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<140;$('#serverBottomBtn')?.classList.toggle('hidden',nearBottom)});scrollCommunityMessages()}catch{toast('Kanal konnte nicht geladen werden.')}}
async function filesToData(files){const out=[];let total=0;for(const f of files.slice(0,8)){if(f.size>8*1024*1024){toast(`${f.name} ist zu groß (max. 8 MB).`);continue}total+=f.size;if(total>16*1024*1024)break;const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});out.push({filename:f.name,mime:f.type||'application/octet-stream',data})}return out}
async function createPollForCurrentChannel(){if(!currentCommunityServer||!currentCommunityChannel)return;const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">UMFRAGE</div><h2>📊 Neue Abstimmung</h2><label class="field-label">Frage<input id="pollQuestion" class="settings-input" maxlength=180 value="Was sollen wir heute spielen?"></label><label class="field-label">Antworten <small>(eine pro Zeile)</small><textarea id="pollOptions" class="settings-input" rows=5> Minecraft\nRoblox\nFortnite</textarea></label><label class="discover-toggle"><input id="pollMulti" type="checkbox"><span><b>Mehrfachauswahl</b><small>Mitglieder dürfen mehrere Antworten auswählen.</small></span></label><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="createPollBtn">Erstellen</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#createPollBtn').onclick=async()=>{const q=$('#pollQuestion').value.trim();const options=$('#pollOptions').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,10);if(!q||options.length<2)return toast('Frage und mindestens zwei Antworten nötig.');try{await api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages`,{method:'POST',body:JSON.stringify({poll:{question:q,options,multi:$('#pollMulti').checked},message:''})});modal.remove()}catch{toast('Umfrage konnte nicht erstellt werden.')}}}
function communityMessageHTML(m){const mine=me&&sameId(m.user_id,me.id);const attachments=(m.attachments||[]).map(a=>{const url=`/api/community-attachments/${a.id}`;if((a.mime||'').startsWith('image/'))return `<a class="message-file image-file" href="${url}" target="_blank"><img src="${url}" alt="${esc(a.filename)}"></a>`;if((a.mime||'').startsWith('video/'))return `<video class="message-video" controls src="${url}"></video>`;return `<a class="message-file" href="${url}" target="_blank">📎 ${esc(a.filename)}</a>`}).join('');let poll='';if(m.message_type==='poll'&&m.poll_data){const pd=m.poll_data,counts=pd.counts||{},my=m.myVotes||[];poll=`<div class="poll-card"><b>📊 ${esc(pd.question||'Abstimmung')}</b>${pd.multi?'<small class="poll-note">Mehrfachauswahl</small>':''}<div class="poll-options">${(pd.options||[]).map((o,i)=>`<button type="button" class="poll-option ${my.includes(i)?'selected':''}" data-poll-option="${i}" data-poll-message="${m.id}"><span>${esc(o)}</span><strong>${Number(counts[i]||0)}</strong></button>`).join('')}</div></div>`}const reacts=(m.reactions||[]).map(r=>`<button type="button" class="reaction-chip ${r.mine?'mine':''}" data-reaction-message="${m.id}" data-reaction-emoji="${esc(r.emoji)}">${esc(r.emoji)} ${Number(r.count||0)}</button>`).join('');const manageMessages=Boolean(currentCommunityData?.permissions?.manage_messages),canEdit=mine,canDelete=mine||manageMessages,canPin=manageMessages;return `<div class="msg server-msg ${mine?'me':''} ${m.pinned?'is-pinned':''}" data-server-message="${m.id}"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(m))}"><div class="server-msg-body"><div class="meta">${esc(m.global_name||m.username)} · ${esc(m.role||'Mitglied')} ${m.pinned?'<span class="pin-mark">📌 angepinnt</span>':''} ${m.edited_at?'<span class="edited-mark">bearbeitet</span>':''}</div>${m.message?`<div class="bubble" data-message-body="${m.id}">${esc(m.message)}</div>`:''}${attachments}${poll}${reacts?`<div class="reaction-row">${reacts}</div>`:''}<div class="message-actions">${canEdit&&m.message?`<button type="button" class="tiny-icon" data-edit-server-message="${m.id}" title="Bearbeiten">✎</button>`:''}${canPin?`<button type="button" class="tiny-icon" data-pin-server-message="${m.id}" title="${m.pinned?'Loslösen':'Anpinnen'}">📌</button>`:''}<button type="button" class="tiny-icon" data-reaction-message="${m.id}" data-reaction-emoji="👍">👍</button><button type="button" class="tiny-icon" data-reaction-message="${m.id}" data-reaction-emoji="❤️">❤️</button>${canDelete?`<button type="button" class="tiny-delete" data-delete-server-message="${m.id}">Löschen</button>`:''}</div></div></div>`}
async function reactToServerMessage(id,emoji){if(!currentCommunityServer||!currentCommunityChannel)return;try{await api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages/${id}/reaction`,{method:'POST',body:JSON.stringify({emoji})})}catch{toast('Reaktion konnte nicht gespeichert werden.')}}
function editTextModal(title,value,label,saveText='Speichern'){return new Promise(resolve=>{const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-cancel>×</button><div class="eyebrow">BEARBEITEN</div><h2>${esc(title)}</h2><label class="field-label">${esc(label)}<textarea id="editTextValue" class="settings-input" rows="5" maxlength="1000">${esc(value)}</textarea></label><div class="actions modal-actions"><button class="secondary" data-cancel>Abbrechen</button><button class="primary" id="editTextSave">${esc(saveText)}</button></div></div>`;document.body.appendChild(modal);const done=v=>{modal.remove();resolve(v)};modal.querySelector('[data-cancel]').onclick=()=>done(null);modal.querySelector('#editTextSave').onclick=()=>done(modal.querySelector('#editTextValue').value);requestAnimationFrame(()=>modal.classList.add('show'))})}
async function editServerMessage(id){const el=document.querySelector(`[data-server-message="${id}"] [data-message-body="${id}"]`);const current=el?.textContent||'';const next=await editTextModal('Nachricht bearbeiten',current,'Nachricht','Speichern');if(next===null||!next.trim())return;try{await api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages/${id}`,{method:'PATCH',body:JSON.stringify({message:next.trim()})});await openCommunityChannel(currentCommunityChannel.id)}catch{toast('Nachricht konnte nicht bearbeitet werden.')}}
async function pinServerMessage(id){try{const row=document.querySelector(`[data-server-message="${id}"]`);const pinned=row?.classList.contains('is-pinned');await api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages/${id}/pin`,{method:'POST',body:JSON.stringify({pinned:!pinned})})}catch{toast('Anheften konnte nicht geändert werden.')}}

function scrollCommunityMessages(){const e=$('#serverMessages');if(e)e.scrollTop=e.scrollHeight}
function updateVoiceMemberList(){const host=$('#voiceStatusList');if(!host)return;const names=[];if(me&&currentVoiceChannel&&voiceLocalStream)names.push(`<div class="voice-member"><i class="dot online"></i><span>${esc(me.global_name||me.username)} <small>Du</small></span></div>`);for(const [id,p] of voicePeers){const vol=Math.round((p.volume??1)*100);names.push(`<div class="voice-member"><i class="dot online"></i><span>${esc(p.user?.global_name||p.user?.username||'Mitglied')}</span><input class="peer-volume" type="range" min="0" max="150" value="${vol}" data-peer-volume="${id}" title="Lautstärke"></div>`)}host.innerHTML=names.join('')||'<div class="empty compact">Niemand ist gerade im Sprachkanal.</div>';host.querySelectorAll('[data-peer-volume]').forEach(r=>r.oninput=()=>{const p=voicePeers.get(r.dataset.peerVolume);if(p){p.volume=Number(r.value)/100;const audio=document.getElementById('voice-audio-'+r.dataset.peerVolume); if(audio) audio.volume=p.volume;}})}
function renderPersistentVoiceBar(){const bar=$('#persistentVoiceBar');if(!bar||!currentVoiceChannel)return;bar.innerHTML=`<div><b>🔊 ${esc(currentVoiceChannel.name)}</b><small>Du bleibst verbunden, bis du auf „Verlassen“ drückst.</small></div><div class="voice-controls"><button id="voiceMuteBtn">🎙 Mikro</button><button id="voiceVideoBtn">📹 Video</button><button id="voiceShareBtn">🖥 Teilen</button><button id="voiceOutputBtn">🔈 Ausgabe</button><button id="voicePttBtn">⌨ PTT aus</button><button id="voiceLeaveBtn" class="danger-btn">🔌 Verlassen</button></div>`;$('#voiceMuteBtn').onclick=toggleVoiceMute;$('#voiceVideoBtn').onclick=toggleVoiceVideo;$('#voiceShareBtn').onclick=shareScreen;$('#voiceOutputBtn').onclick=chooseAudioOutput;$('#voicePttBtn').onclick=togglePTT;$('#voiceLeaveBtn').onclick=leaveCommunityVoice;if(pttEnabled)$('#voicePttBtn').textContent=`⌨ PTT ${pttKey.toUpperCase()}`}
let pttEnabled=false,pttPressed=false,pttKey='v';
function togglePTT(){pttEnabled=!pttEnabled;const btn=$('#voicePttBtn');if(btn)btn.textContent=pttEnabled?`⌨ PTT ${pttKey.toUpperCase()}`:'⌨ PTT aus';const t=voiceLocalStream?.getAudioTracks()[0];if(t)t.enabled=!pttEnabled||pttPressed}
function handlePTTKey(e){if(!pttEnabled||!currentVoiceChannel||e.repeat)return;if(e.key.toLowerCase()===pttKey){pttPressed=true;const t=voiceLocalStream?.getAudioTracks()[0];if(t)t.enabled=true}}
function handlePTTKeyUp(e){if(!pttEnabled||!currentVoiceChannel)return;if(e.key.toLowerCase()===pttKey){pttPressed=false;const t=voiceLocalStream?.getAudioTracks()[0];if(t)t.enabled=false}}
document.addEventListener('keydown',handlePTTKey);document.addEventListener('keyup',handlePTTKeyUp)

function openVoiceLobby(id){
  const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c)return;currentCommunityChannel=c;const view=$('#serverChannelView');if(!view)return;view.innerHTML=`<div class="voice-lobby"><div class="voice-lobby-icon">🔊</div><div class="eyebrow">VOICE CHANNEL</div><h2>${esc(c.name)}</h2><p>Du bist noch nicht verbunden. Klicke auf <b>Beitreten</b>, um den Sprachchat zu öffnen.</p><div class="voice-lobby-actions"><button class="primary voice-join-big" id="voiceJoinBig">🎙 Beitreten</button><button class="secondary" id="voiceLobbyCancel">Zurück</button></div><div class="voice-lobby-note">Mikrofonzugriff wird erst beim Beitreten angefragt.</div></div>`;$('#voiceJoinBig').onclick=()=>joinCommunityVoice(c.id);$('#voiceLobbyCancel').onclick=()=>{const first=(currentCommunityData?.channels||[]).find(x=>x.type==='text');if(first)openCommunityChannel(first.id);else renderServers()}}
async function joinCommunityVoice(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c||c.type!=='voice')return;try{if(currentVoiceChannel&&!sameId(currentVoiceChannel.id,c.id)){for(const [,item] of voicePeers){item.pc?.close()}voicePeers.clear()}if(!voiceLocalStream)voiceLocalStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});currentVoiceChannel=c;renderServers();const view=$('#serverChannelView');if(view)view.innerHTML=`<div class="voice-room discord-voice-room"><header class="discord-voice-header"><div class="discord-voice-title"><span class="discord-voice-icon">🔊</span><div><h3>${esc(c.name)}</h3><small>Sprachkanal</small></div></div><div class="discord-voice-state"><span class="dot online"></span> Verbunden</div></header><div class="discord-voice-body"><div class="voice-stage"><div class="voice-stage-label">SPRACHKANAL · ${esc(c.name)}</div><div id="voiceStatusList" class="voice-members discord-voice-members"></div></div><aside class="voice-side-info"><b>Sprachkanal</b><span>Alle Teilnehmer werden hier angezeigt.</span><small>Peer-to-Peer Verbindung</small></aside></div></div>`;updateVoiceMemberList();socket?.emit('server_voice_join',{serverId:Number(currentCommunityServer.id),channelId:Number(c.id)});renderPersistentVoiceBar()}catch{toast('Mikrofonzugriff wurde nicht erlaubt oder ist nicht verfügbar.')}}
async function leaveCommunityVoice(){socket?.emit('server_voice_leave');for(const [,item] of voicePeers){item.pc?.close();document.getElementById('voice-audio-'+item.peerId)?.remove();document.getElementById('voice-video-'+item.peerId)?.remove()}voicePeers.clear();if(voiceLocalStream){voiceLocalStream.getTracks().forEach(t=>t.stop());voiceLocalStream=null}if(voiceScreenStream){voiceScreenStream.getTracks().forEach(t=>t.stop());voiceScreenStream=null}currentVoiceChannel=null;renderServers();if(currentCommunityChannel&&currentCommunityChannel.type==='text')await openCommunityChannel(currentCommunityChannel.id)}
async function makeVoicePeer(peerId,user,offer){let item=voicePeers.get(peerId);if(item?.pc){if(user)item.user=user;return item.pc}const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});item={pc,user:user||null,volume:1,peerId};voicePeers.set(peerId,item);voiceLocalStream?.getTracks().forEach(t=>pc.addTrack(t,voiceLocalStream));pc.onicecandidate=e=>{if(e.candidate)socket?.emit('server_voice_signal',{target:peerId,data:{candidate:e.candidate}})};pc.ontrack=e=>{let media=document.getElementById('voice-audio-'+peerId);if(e.track.kind==='video'){media=document.getElementById('voice-video-'+peerId)||document.createElement('video');media.id='voice-video-'+peerId;media.autoplay=true;media.playsInline=true;media.className='remote-video';document.body.appendChild(media);media.srcObject=e.streams[0]}else{if(!media){media=document.createElement('audio');media.id='voice-audio-'+peerId;media.autoplay=true;media.playsInline=true;document.body.appendChild(media)}media.srcObject=e.streams[0];media.volume=item.volume??1}};pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)){pc.close();voicePeers.delete(peerId);document.getElementById('voice-audio-'+peerId)?.remove();document.getElementById('voice-video-'+peerId)?.remove();updateVoiceMemberList()}};if(offer){const o=await pc.createOffer();await pc.setLocalDescription(o);socket?.emit('server_voice_signal',{target:peerId,data:{description:pc.localDescription}})}updateVoiceMemberList();return pc}
async function renegotiateVoicePeers(){for(const [peerId,item] of voicePeers){try{const offer=await item.pc.createOffer();await item.pc.setLocalDescription(offer);socket?.emit('server_voice_signal',{target:peerId,data:{description:item.pc.localDescription}})}catch(e){console.warn('voice renegotiate',e.message)}}}
async function toggleVoiceMute(){const t=voiceLocalStream?.getAudioTracks()[0];if(!t)return;if(pttEnabled){pttEnabled=false;pttPressed=false;if($('#voicePttBtn'))$('#voicePttBtn').textContent='⌨ PTT aus'}t.enabled=!t.enabled;$('#voiceMuteBtn').textContent=t.enabled?'🎙 Mikro':'🔇 Stumm'}
async function toggleVoiceVideo(){if(!voiceLocalStream)return;let track=voiceLocalStream.getVideoTracks()[0];if(track){track.enabled=!track.enabled;$('#voiceVideoBtn').textContent=track.enabled?'📹 Video aus':'📹 Video';return}try{const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});track=stream.getVideoTracks()[0];voiceLocalStream.addTrack(track);voicePeers.forEach(i=>i.pc.addTrack(track,voiceLocalStream));track.onended=()=>{track.enabled=false};$('#voiceVideoBtn').textContent='📹 Video aus';await renegotiateVoicePeers()}catch{toast('Kamerazugriff wurde nicht erlaubt.')}}
async function shareScreen(){try{if(voiceScreenStream){voiceScreenStream.getTracks().forEach(t=>t.stop());voiceScreenStream=null;toast('Bildschirmfreigabe beendet.');return}voiceScreenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});voiceScreenStream.getTracks().forEach(track=>{voicePeers.forEach(i=>i.pc.addTrack(track,voiceScreenStream))});voiceScreenStream.getVideoTracks()[0].onended=()=>{voiceScreenStream?.getTracks().forEach(t=>t.stop());voiceScreenStream=null;renegotiateVoicePeers();};await renegotiateVoicePeers();toast('Bildschirm wird geteilt.')}catch{toast('Bildschirmfreigabe wurde abgebrochen oder nicht erlaubt.')}}
async function chooseAudioOutput(){const audios=[...document.querySelectorAll('audio')];if(!audios.length){toast('Noch keine fremde Audioquelle vorhanden.');return}if(!navigator.mediaDevices?.selectAudioOutput){toast('Dein Browser unterstützt keine Auswahl des Audioausgangs.');return}try{const out=await navigator.mediaDevices.selectAudioOutput();for(const a of audios){if(a.setSinkId)await a.setSinkId(out.deviceId)}toast(`Audioausgabe: ${out.label||'ausgewählt'}`)}catch{}}
function bindCommunitySocket(){if(!socket)return;socket.on('notification',async n=>{notificationData.notifications=[n,...(notificationData.notifications||[])].slice(0,40);notificationData.unread=(notificationData.unread||0)+1;updateNotificationBadge();toast(n.title||'Neue Benachrichtigung');if(n.type==='friend'){await loadFriends();if($('#page-friends')?.classList.contains('active'))renderFriends()}});socket.on('server_channel_message',m=>{if(currentCommunityChannel&&sameId(m.channel_id,currentCommunityChannel.id)){const e=$('#serverMessages');if(e){const nearBottom=e.scrollHeight-e.scrollTop-e.clientHeight<160;e.insertAdjacentHTML('beforeend',communityMessageHTML(m));if(nearBottom)scrollCommunityMessages();else $('#serverBottomBtn')?.classList.remove('hidden')}}else{const id=Number(m.channel_id);serverUnread.set(id,(serverUnread.get(id)||0)+1);const badge=document.querySelector(`#page-servers [data-channel-id="${id}"] .channel-unread`);if(badge){badge.textContent=String(serverUnread.get(id));badge.classList.add('visible')}toast(`Neue Nachricht in #${m.channel_name||'Kanal'}`)}});socket.on('server_message_deleted',p=>{document.querySelector(`[data-server-message="${p.messageId}"]`)?.remove()});socket.on('server_message_edited',p=>{if(currentCommunityChannel&&sameId(p.channelId,currentCommunityChannel.id)){const el=document.querySelector(`[data-message-body="${p.id}"]`);if(el){el.textContent=p.message;el.closest('.server-msg')?.querySelector('.meta')?.insertAdjacentHTML('beforeend',' <span class="edited-mark">bearbeitet</span>')}}});socket.on('server_message_pinned',p=>{if(currentCommunityChannel&&sameId(p.channelId,currentCommunityChannel.id)){const row=document.querySelector(`[data-server-message="${p.id}"]`);row?.classList.toggle('is-pinned',Boolean(p.pinned));const meta=row?.querySelector('.meta');if(meta&&!meta.querySelector('.pin-mark')&&p.pinned)meta.insertAdjacentHTML('beforeend',' <span class="pin-mark">📌 angepinnt</span>')}});socket.on('server_message_reactions',p=>{if(currentCommunityChannel&&document.querySelector(`[data-server-message="${p.messageId}"]`))openCommunityChannel(currentCommunityChannel.id)});socket.on('server_poll_updated',async()=>{if(currentCommunityChannel)openCommunityChannel(currentCommunityChannel.id)});socket.on('server_voice_peer',async p=>{if(!currentVoiceChannel)return;await makeVoicePeer(p.socketId,p.user,true);updateVoiceMemberList()});socket.on('server_voice_peer_joined',p=>{if(!currentVoiceChannel)return;voicePeers.set(p.socketId,{pc:voicePeers.get(p.socketId)?.pc||null,user:p.user,volume:1,peerId:p.socketId});updateVoiceMemberList()});socket.on('server_voice_peer_left',p=>{const item=voicePeers.get(p.socketId);item?.pc?.close();voicePeers.delete(p.socketId);document.getElementById('voice-audio-'+p.socketId)?.remove();document.getElementById('voice-video-'+p.socketId)?.remove();updateVoiceMemberList()});socket.on('server_voice_signal',async packet=>{const from=packet.from;let item=voicePeers.get(from);if(!item){item={pc:null,user:null,volume:1,peerId:from};voicePeers.set(from,item)}if(!item.pc){await makeVoicePeer(from,item.user,false);item=voicePeers.get(from)}const d=packet.data||{};try{if(d.description){if(d.description.type==='offer'){await item.pc.setRemoteDescription(d.description);const ans=await item.pc.createAnswer();await item.pc.setLocalDescription(ans);socket?.emit('server_voice_signal',{target:from,data:{description:item.pc.localDescription}})}else if(d.description.type==='answer'){await item.pc.setRemoteDescription(d.description)}}else if(d.candidate)await item.pc.addIceCandidate(d.candidate)}catch(e){console.warn('voice signal',e.message)}})}
document.addEventListener('click',async e=>{const react=e.target.closest('[data-reaction-message]');if(react&&currentCommunityChannel){e.preventDefault();await reactToServerMessage(Number(react.dataset.reactionMessage),react.dataset.reactionEmoji);return}const edit=e.target.closest('[data-edit-server-message]');if(edit){e.preventDefault();await editServerMessage(Number(edit.dataset.editServerMessage));return}const pin=e.target.closest('[data-pin-server-message]');if(pin){e.preventDefault();await pinServerMessage(Number(pin.dataset.pinServerMessage));return}});
function renderLeaderboard(){
  const sorted=[...members].sort((a,b)=>(b.xp-a.xp)||((b.level||1)-(a.level||1)));
  $('#page-leaderboard').innerHTML=`<div class="section-title"><div><h2>🏆 Rangliste</h2><div class="eyebrow">LEVEL · XP · AKTIVITÄT</div></div></div><div class="card"><div class="rank-help">+2 XP pro öffentlicher Nachricht · +25 XP einmal täglich beim Login</div>${sorted.map((u,i)=>`<div class="rank-row"><div class="rank-number">#${i+1}</div><div class="member-head"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="role">${esc(displayRole(u))}</div></div></div><div class="rank-level"><strong>Level ${u.level||1}</strong>${levelInfo(u)}</div><div class="rank-xp">${u.xp} XP</div></div>`).join('')||'<div class="empty">Noch keine Rangliste.</div>'}</div>`;
}async function showProfile(id){
  const memberId=String(id);
  let u=members.find(x=>String(x.id)===memberId);
  if(!u){toast('Mitglied nicht gefunden.');return;}
  setPageTheme('members');
  $$(' .page').forEach(p=>p.classList.remove('active'));
  $('#page-members').classList.add('active');
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page==='members'));
  $('#crumb').textContent=pages.members;
  try{
    const fresh=await api('/api/member/'+encodeURIComponent(memberId));
    if(fresh?.member){u=fresh.member;members=members.map(x=>String(x.id)===memberId?u:x);}
  }catch(e){console.warn('Profil konnte nicht aktualisiert werden:',e);}
  $('#page-members').innerHTML=`<div class="profile"><div class="card profile-card"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><h2>${esc(u.global_name||u.username)}</h2><div class="role">${esc(displayRole(u))}</div><p>${esc(u.bio||'Noch keine Beschreibung.')}</p>${discordInfo(u)}${levelInfo(u)}<div class="online-label" style="justify-content:center"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'}</div><div class="actions" style="justify-content:center"><button class="secondary" onclick="renderMembers()">← Zur Mitgliederliste</button><button class="primary" onclick="startPrivate(${String(u.id)})">✉ Nachricht</button></div></div><div><div class="section-title"><h2>Account-Informationen</h2></div><div class="info-grid"><div class="card info"><span>Discord-Name</span><strong>${esc(u.username)}</strong></div><div class="card info"><span>Discord-ID</span><strong class="small-value">${esc(u.discord_id||'—')}</strong></div><div class="card info"><span>Discord-Rolle</span><strong>${(u.discord_roles||[]).map(r=>esc(r.name)).join(', ')||'Keine Rolle'}</strong></div><div class="card info"><span>Level</span><strong>${u.level||1}</strong></div><div class="card info"><span>XP</span><strong>${u.xp}</strong></div><div class="card info"><span>Öffentliche Nachrichten</span><strong>${u.message_count||0}</strong></div><div class="card info"><span>Mitglied seit</span><strong>${new Date(u.created_at).toLocaleDateString('de-DE')}</strong></div><div class="card info"><span>Discord-Server</span><strong>${u.discord_in_server?'✓ Mitglied':'✕ Nicht Mitglied'}</strong></div></div></div></div>`;
}async function renderSettings(){
  if(!me){
    $('#page-settings').innerHTML='<div class="empty">Bitte melde dich mit Discord an, um Einstellungen zu öffnen.</div>';
    return;
  }
  try{
    const [accountData,settingsData,adminData]=await Promise.all([
      api('/api/account'),
      api('/api/settings'),
      api('/api/admin/status').catch(()=>({isAdmin:false}))
    ]);
    me=accountData.account;
    members=members.map(x=>x.id===me.id?me:x);
    const s=settingsData.settings;
    const isAdmin=Boolean(adminData.isAdmin);
    let adminHTML='';
    if(isAdmin){
      let roleOptions='';
      try{
        const rd=await api('/api/admin/discord-roles');
        roleOptions='<option value="">Discord-Rolle auswählen…</option>'+rd.roles.map(r=>{
          const color=Number(r.color||0).toString(16).padStart(6,'0');
          return `<option value="${esc(r.id)}" data-color="#${color}">${esc(r.name)}</option>`;
        }).join('');
      }catch{
        roleOptions='<option value="">Discord-Rollen nicht verfügbar</option>';
      }
      adminHTML=`<div class="card setting admin-panel">
        <div class="admin-title"><div><h3>🛠 Server & Level bearbeiten</h3><p>Nur für konfigurierte Zockerfreunde-Admins. Level werden über XP gespeichert; Discord-Rollen werden direkt über den Bot gesetzt.</p></div><span class="admin-badge">ADMIN</span></div>
        <div class="admin-member-list">
          ${members.map(u=>`<div class="admin-member">
            <div class="member-head"><img class="avatar" onerror="avatarError(this)" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="role">${esc(displayRole(u))} · Level ${u.level||1} · ${u.xp} XP</div></div></div>
            <div class="admin-fields">
              <label>Level<input class="admin-level" type="number" min="1" max="1000" value="${u.level||1}" data-id="${u.id}"></label>
              <label>Discord-Rolle<select class="admin-role" data-id="${u.id}">${roleOptions}</select></label>
              <button class="primary admin-save" data-id="${u.id}">Speichern</button>
            </div>
          </div>`).join('')}
        </div>
      </div>`;
    }
    $('#page-settings').innerHTML=`<div class="section-title"><div><h2>⚙ Einstellungen</h2><div class="eyebrow">DEIN ZOCKERFREUNDE-KONTO</div></div></div>
      <div class="settings-grid">
        <div class="card setting">
          <h3>👤 Account-Informationen</h3>
          <div class="account-info-list">
            <div><span>Discord-Name</span><strong>${esc(me.global_name||me.username)}</strong></div>
            <div><span>Benutzername</span><strong>${esc(me.username)}</strong></div>
            <div><span>Discord-ID</span><strong class="small-value">${esc(me.discord_id||'—')}</strong></div>
            <div><span>Discord-Rolle</span><strong>${esc(displayRole(me))}</strong></div>
            <div><span>Mitglied seit</span><strong>${me.created_at?new Date(me.created_at).toLocaleDateString('de-DE'):'—'}</strong></div>
            <div><span>Nachrichten</span><strong>${me.message_count||0}</strong></div>
          </div>
          ${discordInfo(me)}
          <button class="secondary" onclick="refreshAccount()">↻ Discord & Konto aktualisieren</button>
        </div>
        <div class="card setting">
          <h3>⭐ Level & Fortschritt</h3>
          <div class="big-level"><strong>Level ${me.level||1}</strong><span>${me.xp} XP</span></div>
          ${levelInfo(me)}
          <p class="setting-note">Du erhältst XP durch Community-Aktivität. Der Fortschritt wird automatisch in der Rangliste aktualisiert.</p>
        </div>
        <div class="card setting">
          <h3>Darstellung</h3><p style="color:#8d93ae">Wähle deinen Look.</p>
          <div class="theme-buttons">${['neon','dark','light'].map(t=>`<button class="${s.theme===t?'active':''}" onclick="setTheme('${t}')">${t==='neon'?'✨ Neon':t==='dark'?'🌙 Dunkel':'☀️ Hell'}</button>`).join('')}</div>
        </div>
        <div class="card setting">
          <h3>Profil</h3><p style="color:#8d93ae">Deine Beschreibung wird anderen Mitgliedern angezeigt.</p>
          <textarea id="bioInput" maxlength="240">${esc(me.bio||'')}</textarea><div class="actions"><button class="primary" onclick="saveBio()">Profil speichern</button></div>
        </div>
        <div class="card setting">
          <h3>Discord</h3><p style="color:#8d93ae">${config.discordServerCheckConfigured?'Der Server-Check ist aktiv.':'Der Server-Check ist noch nicht konfiguriert.'}</p>
          <a class="discord-btn" id="settingsDiscord" target="_blank">Discord-Server öffnen ↗</a>
        </div>
        <div class="card setting">
          <h3>Account</h3><p style="color:#8d93ae">Mit Discord verbunden als <b>${esc(me.global_name||me.username)}</b>.</p>
          <button class="secondary" onclick="logout()">Ausloggen</button>
        </div>
      </div>${adminHTML}`;
    const invite=config.discordInvite||'';
    if(invite) $('#settingsDiscord').href=invite;
    if(isAdmin) $$('.admin-save').forEach(btn=>btn.onclick=()=>saveAdminMember(Number(btn.dataset.id)));
  }catch(e){
    console.error(e);
    $('#page-settings').innerHTML='<div class="empty">Die Account-Daten konnten nicht geladen werden. Bitte aktualisiere die Seite.</div>';
  }
}
async function refreshAccount(){
  try{
    const d=await api('/api/account');
    me=d.account;
    members=members.map(x=>x.id===me.id?me:x);
    toast('Discord & Konto aktualisiert');
    renderTop();renderHome();renderLeaderboard();await renderSettings();
  }catch(e){toast('Aktualisierung fehlgeschlagen');}
}
async function saveAdminMember(id){
  const levelInput=$(`.admin-level[data-id="${id}"]`);
  const roleInput=$(`.admin-role[data-id="${id}"]`);
  const level=Number(levelInput?.value);
  if(!Number.isFinite(level)||level<1||level>1000){toast('Ungültiges Level');return}
  try{
    const d=await api('/api/admin/member/'+id,{method:'POST',body:JSON.stringify({level,roleId:roleInput?.value||''})});
    members=members.map(u=>u.id===id?d.member:u);
    if(me&&me.id===id) me=d.member;
    toast(d.changed?.length?`Gespeichert: ${d.changed.join(' · ')}`:'Keine Änderung');
    renderHome();renderLeaderboard();await renderSettings();
  }catch(e){toast('Speichern fehlgeschlagen: '+(e.message||'Fehler'))}
}
async function saveBio(){await api('/api/profile',{method:'POST',body:JSON.stringify({bio:$('#bioInput').value})});const d=await api('/api/me');me=d.user;members=members.map(x=>x.id===me.id?me:x);toast('Profil gespeichert');renderMembers();renderHome()}
async function setTheme(theme){document.body.classList.remove('light','dark');if(theme!=='neon')document.body.classList.add(theme);await api('/api/settings',{method:'POST',body:JSON.stringify({theme})});renderSettings()}
async function logout(){await api('/auth/logout',{method:'POST'});location.reload()}
let refreshMembersTimer=0, refreshMembersBusy=false;
function refreshMembers(){
  if(refreshMembersBusy)return Promise.resolve();
  refreshMembersBusy=true;
  return api('/api/members').then(d=>{
    members=d.members;
    if(me){
      const fresh=members.find(u=>sameId(u.id,me.id));
      if(fresh){
        const oldLevel=Number(me.level||1);
        me=fresh;
        if(me.level>oldLevel)showLevelUp(me.level);
        localStorage.setItem(`zf_level_${me.id}`,String(me.level||1));
      }
      // The current authenticated user is active while this page is open.
      members=members.map(u=>sameId(u.id,me.id)?{...u,last_seen:new Date().toISOString()}:u);
    }
    renderHome();
    if($('.page.active')?.id==='page-members')renderMembers();
    if($('.page.active')?.id==='page-leaderboard')renderLeaderboard();
  }).catch(()=>{}).finally(()=>{refreshMembersBusy=false;});
}
function connectSocket(){if(socket)return;socket=io();socket.on('public_message',m=>{
  if(me&&sameId(m.user_id,me.id)){const oldLevel=Number(me.level||1);me={...me,xp:me.xp+Number(m.xp_gain||0),message_count:(me.message_count||0)+1};me.level=levelFromXPClient(me.xp);me.level_start_xp=levelStartXPClient(me.level);me.level_next_xp=levelNextXPClient(me.level);me.level_progress=Math.min(100,Math.max(0,((me.xp-me.level_start_xp)/(me.level_next_xp-me.level_start_xp))*100));members=members.map(u=>sameId(u.id,me.id)?me:u);localStorage.setItem(`zf_level_${me.id}`,String(me.level||1));if(me.level>oldLevel)showLevelUp(me.level);if($('#page-leaderboard')?.classList.contains('active'))renderLeaderboard();}
  const e=$('#publicMessages');if(e){e.insertAdjacentHTML('beforeend',messageHTML(m));scrollMsgs()}
  refreshMembers();
});
socket.on('public_chat_cleared',()=>{const e=$('#publicMessages');if(e)e.innerHTML='';});socket.on('public_message_error',p=>toast(p?.error||'Bitte kurz warten.'));socket.on('private_message_error',p=>toast(p?.error||'Bitte kurz warten.'));
socket.on('private_message',m=>{if(currentPrivate&&(sameId(m.sender_id,currentPrivate.id)||sameId(m.receiver_id,currentPrivate.id))){const e=$('#privateMessages');if(e){e.insertAdjacentHTML('beforeend',messageHTML(m));scrollPrivate()}}});
bindCommunitySocket();
socket.on('presence',p=>{members=members.map(u=>sameId(u.id,p.userId)?{...u,last_seen:p.status==='online'?new Date().toISOString():u.last_seen}:u);renderHome();if($('.page.active')?.id==='page-members')renderMembers()});
clearInterval(window.zfMemberRefreshTimer);
window.zfMemberRefreshTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshMembers()},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&me)refreshMembers()});
}async function go(page,update=true){
  if(protectedPages.has(page)&&!me){showLoginGate();return}
  $$(' .page').forEach(p=>p.classList.remove('active'));$(`#page-${page}`).classList.add('active');
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  if(update)$('#crumb').textContent=pages[page];
  setPageTheme(page);
  if(page==='home')renderHome();if(page==='members')renderMembers();if(page==='friends'){loadFriends().then(renderFriends)}if(page==='chat')renderChat();
  if(page==='private')renderPrivate();if(page==='leaderboard')renderLeaderboard();if(page==='discordServers')await renderDiscordServers();if(page==='settings')await renderSettings();
  if(innerWidth<761)$('.sidebar')?.classList.remove('open');
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('.member-message-btn');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  startPrivate(btn.dataset.messageUser);
});
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-add-friend]');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  sendFriendRequest(btn.dataset.addFriend,btn);
});
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-unblock-friend]');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  unblockFriend(btn.dataset.unblockFriend,btn);
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-delete-server-message]');if(!b||!currentCommunityServer||!currentCommunityChannel)return;serverConfirm('Nachricht löschen?','Die Nachricht wird dauerhaft entfernt.','Löschen').then(ok=>{if(!ok)return;api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages/${b.dataset.deleteServerMessage}`,{method:'DELETE'}).then(()=>b.closest('[data-server-message]')?.remove()).catch(()=>toast('Nachricht konnte nicht gelöscht werden.'))})});
document.addEventListener('click',e=>{const b=e.target.closest('[data-poll-option]');if(!b||!currentCommunityServer||!currentCommunityChannel)return;api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages/${b.dataset.pollMessage}/poll-vote`,{method:'POST',body:JSON.stringify({optionIndex:Number(b.dataset.pollOption)})}).catch(()=>toast('Abstimmung konnte nicht aktualisiert werden.'))});
$$('.nav').forEach(n=>n.onclick=()=>go(n.dataset.page));$('#mobileMenu').onclick=()=>$('.sidebar').classList.toggle('open');
function capturePendingInvite(){const params=new URLSearchParams(location.search);const code=params.get('invite');if(code)localStorage.setItem('zf_pending_invite',code)}
async function autoJoinPendingInvite(){
  const code=localStorage.getItem('zf_pending_invite'); if(!code||!me)return;
  localStorage.removeItem('zf_pending_invite');
  try{const d=await api('/api/invites/join',{method:'POST',body:JSON.stringify({invite:code})});toast(d.alreadyMember?`Du bist bereits auf „${d.serverName}“.`:`Du bist „${d.serverName}“ beigetreten!`);await loadCommunityServers();if(communityServers.some(s=>sameId(s.id,d.serverId)))await openCommunityServer(d.serverId);}catch(e){let msg='Einladung konnte nicht angenommen werden.';try{const d=JSON.parse(e.message);if(d.error)msg=d.error}catch{}toast(msg)}
}
capturePendingInvite();
Promise.all([
  fetch('/api/me').then(r=>r.json()),
  fetch('/api/settings').then(r=>r.ok?r.json():null).catch(()=>null),
  fetch('/api/config').then(r=>r.json()).catch(()=>null)
]).then(async ([session,settingsData,configData])=>{
  me=session.user;
  if(settingsData?.settings?.theme&&settingsData.settings.theme!=='neon')document.body.classList.add(settingsData.settings.theme);
  if(configData)config=configData;
  if(!me){renderTop();renderHome();setPageTheme('home');return;}
  const [membersData,friends] = await Promise.all([api('/api/members'),api('/api/friends').catch(()=>({friends:[],sent:[],incoming:[],blocked:[]}))]);
  members=membersData.members; friendsData=friends;
  renderTop();
  await loadNotifications();
  renderTop();renderHome();renderMembers();renderChat();renderPrivate();renderLeaderboard();
  await loadCommunityServers().catch(()=>{});
  renderServers();
  if(communityServers[0])await openCommunityServer(communityServers[0].id).catch(()=>{});
  await autoJoinPendingInvite();
  renderSettings();connectSocket();setPageTheme('home');
  document.querySelectorAll('#discordLink,#settingsDiscord').forEach(a=>{
    if(config.discordInvite){a.href=config.discordInvite;a.removeAttribute('aria-disabled');}
    else{a.href='#';a.setAttribute('aria-disabled','true');a.onclick=e=>{e.preventDefault();toast('Discord-Invite fehlt noch. Auf Render DISCORD_INVITE_URL eintragen.');};}
  });
}).catch(console.error);
