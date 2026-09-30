const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let me=null,members=[],socket=null,currentPrivate=null,config={},friendsData={friends:[],sent:[],incoming:[],blocked:[]},selectedFriend=null,communityServers=[],currentCommunityServer=null,currentCommunityData=null,currentCommunityChannel=null,currentVoiceChannel=null,voiceLocalStream=null,voiceScreenStream=null,voicePeers=new Map(),serverViewMode='mine';
const pages={home:'Startseite',members:'Mitglieder',friends:'Freunde',chat:'Öffentlicher Chat',private:'Private Chats',leaderboard:'Rangliste',servers:'Server',settings:'Einstellungen'};
const protectedPages=new Set(['members','friends','chat','private','leaderboard','servers','settings']);
const pageThemes={home:'theme-home',members:'theme-members',friends:'theme-members',chat:'theme-chat',private:'theme-private',leaderboard:'theme-leaderboard',servers:'theme-servers',settings:'theme-settings'};
function setPageTheme(page){document.body.classList.remove(...Object.values(pageThemes));document.body.classList.add(pageThemes[page]||pageThemes.home);}
function showLoginGate(){const e=$('#loginGate');if(!e)return;e.classList.add('show');e.setAttribute('aria-hidden','false');}
function closeLoginGate(){const e=$('#loginGate');if(!e)return;e.classList.remove('show');e.setAttribute('aria-hidden','true');}

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function sameId(a,b){return String(a??'')===String(b??'')}
function avatar(u){return u?.avatar||'/logo.png'}
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
function memberCard(u){return `<div class="card member-card"><div class="member-head member-head-friend"><img class="avatar" src="${esc(avatar(u))}"><div><div class="member-name">${esc(u.global_name||u.username)}</div><div class="role">${esc(displayRole(u))}</div></div>${friendButton(u)}</div><p>${esc(u.bio||'Noch keine Beschreibung.')}</p>${discordInfo(u)}${levelInfo(u)}<div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'} · ${u.message_count||0} Nachrichten</div><div class="actions"><button class="secondary" onclick="showProfile('${u.id}')">Profil ansehen</button><button type="button" class="secondary member-message-btn" data-message-user="${esc(String(u.id))}">✉ Nachricht</button></div></div>`}
async function load(){
  const d=await api('/api/me');me=d.user;
  const m=await api('/api/members');members=m.members;
  if(me){try{friendsData=await api('/api/friends')}catch{friendsData={friends:[],sent:[],incoming:[],blocked:[]};}}
  if(me){checkStoredLevel(me);members=members.map(u=>sameId(u.id,me.id)?{...u,last_seen:new Date().toISOString()}:u);me=members.find(u=>sameId(u.id,me.id))||me;}
  renderTop();await loadNotifications();renderTop();renderHome();try{await loadCommunityServers();}catch{}renderServers();connectSocket();
}
function renderTop(){if(!me){$('#topUser').innerHTML=`<a class="primary" href="/auth/discord">Mit Discord anmelden</a>`;return;}$('#topUser').innerHTML=`<div class="top-tools"><div class="global-search"><input id="globalSearchInput" class="top-search-input" placeholder="Suchen …" autocomplete="off"><div id="globalSearchResults" class="global-search-results hidden"></div></div><button type="button" id="notificationBtn" class="top-icon-btn" title="Benachrichtigungen">🔔<span id="notificationBadge" class="notify-badge hidden">0</span></button><div class="user-mini"><i class="dot online"></i><img class="avatar" src="${esc(avatar(me))}"><b>${esc(me.global_name||me.username)}</b></div></div>`;$('#globalSearchInput')?.addEventListener('input',debounceGlobalSearch);$('#globalSearchInput')?.addEventListener('focus',()=>{const q=$('#globalSearchInput').value.trim();if(q)runGlobalSearch(q)});$('#notificationBtn')?.addEventListener('click',toggleNotifications);updateNotificationBadge();}
let notificationData={notifications:[],unread:0};
let globalSearchTimer=null;
function debounceGlobalSearch(e){clearTimeout(globalSearchTimer);const q=e.target.value.trim();if(!q){$('#globalSearchResults')?.classList.add('hidden');return;}globalSearchTimer=setTimeout(()=>runGlobalSearch(q),250)}
async function loadNotifications(){if(!me){notificationData={notifications:[],unread:0};return;}try{notificationData=await api('/api/notifications')}catch{notificationData={notifications:[],unread:0};}updateNotificationBadge()}
function updateNotificationBadge(){const b=$('#notificationBadge');if(!b)return;b.textContent=String(notificationData.unread||0);b.classList.toggle('hidden',!(notificationData.unread>0))}
function closeNotifications(){document.querySelector('.notification-panel')?.remove()}
async function markNotificationRead(id){try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({id})})}catch{}await loadNotifications();renderTop()}
function toggleNotifications(e){e?.stopPropagation();closeNotifications();const panel=document.createElement('div');panel.className='notification-panel';const rows=notificationData.notifications||[];panel.innerHTML=`<div class="notification-head"><b>Benachrichtigungen</b><button type="button" class="tiny-icon" id="markAllNotifications">✓</button></div><div class="notification-list">${rows.map(n=>`<button type="button" class="notification-row ${n.read?'':'unread'}" data-notification-id="${n.id}" data-notification-link="${esc(n.link||'')}"><span class="notification-dot">${n.type==='friend'?'👥':n.type==='message'?'✉':'🔔'}</span><span><b>${esc(n.title||'Benachrichtigung')}</b><small>${esc(n.body||'')}</small></span></button>`).join('')||'<div class="empty compact">Keine Benachrichtigungen.</div>'}</div>`;document.body.appendChild(panel);$('#markAllNotifications')?.addEventListener('click',async()=>{try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({})})}catch{}await loadNotifications();closeNotifications();renderTop()});panel.querySelectorAll('[data-notification-id]').forEach(row=>row.addEventListener('click',async()=>{await markNotificationRead(row.dataset.notificationId);const link=row.dataset.notificationLink;closeNotifications();if(link==='friends')await go('friends');else if(link==='private')await go('private');else if(link.startsWith('server:')){const parts=link.split(':');await go('servers');await openCommunityServer(Number(parts[1]));if(parts[2])await openCommunityChannel(Number(parts[2]))}}))}
async function runGlobalSearch(q){const box=$('#globalSearchResults');if(!box)return;try{const d=await api('/api/search?q='+encodeURIComponent(q));const people=(d.members||[]).map(u=>`<button type="button" class="search-result" data-search-user="${u.id}"><img class="avatar" src="${esc(avatar(u))}"><span><b>${esc(u.global_name||u.username)}</b><small>Mitglied · Level ${u.level||1}</small></span></button>`).join('');const msgs=(d.messages||[]).map(m=>`<button type="button" class="search-result" data-search-server="${m.server_id}" data-search-channel="${m.channel_id}"><span class="search-result-icon">#</span><span><b>${esc(m.server_name)} · #${esc(m.channel_name)}</b><small>${esc((m.message||'').slice(0,120))}</small></span></button>`).join('');box.innerHTML=`${people?'<div class="search-group-title">MITGLIEDER</div>'+people:''}${msgs?'<div class="search-group-title">SERVER-NACHRICHTEN</div>'+msgs:''}${!people&&!msgs?'<div class="empty compact">Keine Treffer.</div>':''}`;box.classList.remove('hidden');box.querySelectorAll('[data-search-user]').forEach(b=>b.onclick=async()=>{box.classList.add('hidden');await go('members');const u=members.find(x=>sameId(x.id,b.dataset.searchUser));if(u){const input=$('#memberSearch');if(input){input.value=u.global_name||u.username;input.dispatchEvent(new Event('input'))}}});box.querySelectorAll('[data-search-server]').forEach(b=>b.onclick=async()=>{box.classList.add('hidden');await go('servers');await openCommunityServer(Number(b.dataset.searchServer));await openCommunityChannel(Number(b.dataset.searchChannel))})}catch{box.innerHTML='<div class="empty compact">Suche momentan nicht verfügbar.</div>';box.classList.remove('hidden')}}
document.addEventListener('click',e=>{if(!e.target.closest('.global-search')&&!e.target.closest('.top-icon-btn')){$('#globalSearchResults')?.classList.add('hidden');closeNotifications()}});
function renderHome(){const online=members.filter(isOnline).length;$('#page-home').innerHTML=`<div class="hero"><div class="eyebrow">DEINE GAMING COMMUNITY</div><h1>Gemeinsam spielen.<br><span class="gradient">Gemeinsam zocken.</span></h1><p>Zockerfreunde verbindet Gaming, Freunde und Community an einem Ort. Chatte, finde deine Freunde und sammle XP für die Community-Rangliste.</p><div class="actions">${me?`<button class="primary" onclick="go('chat')">Zum Community-Chat →</button>`:`<a class="primary" href="/auth/discord">Mit Discord starten →</a>`}<button class="secondary" onclick="go('leaderboard')">🏆 Rangliste ansehen</button></div></div><div class="stats"><div class="stat"><strong>${members.length}</strong><span>Mitglieder</span></div><div class="stat"><strong>${online}</strong><span>Gerade online</span></div><div class="stat"><strong>${members.reduce((a,b)=>a+b.points,0)}</strong><span>Community-Punkte</span></div><div class="stat"><strong>∞</strong><span>Gemeinsame Momente</span></div></div><div class="section-title"><h2>Aktive Mitglieder</h2><button class="secondary" onclick="go('members')">Alle ansehen</button></div><div class="grid">${members.filter(isOnline).slice(0,4).map(memberCard).join('')||'<div class="empty">Noch niemand online.</div>'}</div>`}
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
function messageHTML(m){const mine=me&&sameId(m.user_id,me.id);return `<div class="msg ${mine?'me':''}"><img class="avatar" src="${esc(avatar(m))}"><div><div class="meta">${esc(m.global_name||m.username)} · ${esc(m.role)}</div><div class="bubble">${esc(m.message)}</div></div></div>`}
function scrollMsgs(){const e=$('#publicMessages');if(e)e.scrollTop=e.scrollHeight}
async function loadFriends(){if(!me)return;try{friendsData=await api('/api/friends')}catch(e){console.warn('Freunde konnten nicht geladen werden:',e)}}
function friendPerson(u,extra=''){return `<div class="friend-row"><img class="avatar" src="${esc(avatar(u))}"><div class="friend-main"><b>${esc(u.global_name||u.username)}</b><span>${esc(displayRole(u))}</span></div>${extra}</div>`}
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
  list.innerHTML=friends.map(u=>`<button type="button" class="chat-person" data-private-user="${esc(String(u.id))}"><img class="avatar" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'}</div></div></button>`).join('')||'<div class="empty compact">Noch keine Freunde. Füge zuerst Freunde hinzu.</div>';
  list.querySelectorAll('[data-private-user]').forEach(b=>b.onclick=()=>startPrivate(b.dataset.privateUser));
  $('#oldFriendsToggle').onclick=async()=>{
    const box=$('#oldFriendsList');box.classList.toggle('hidden');
    if(!box.classList.contains('hidden')){const d=await oldPromise;const old=(d.friends||[]).filter(u=>!oldIds.has(String(u.id)));box.innerHTML=old.map(u=>`<button type="button" class="chat-person old-friend" data-private-user="${esc(String(u.id))}"><img class="avatar" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><small>Alte Freundschaft</small></div></button>`).join('')||'<div class="empty compact">Keine alten Freunde gespeichert.</div>';box.querySelectorAll('[data-private-user]').forEach(b=>b.onclick=()=>startPrivate(b.dataset.privateUser));}
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
function renderServers(){
  if(!me){$('#page-servers').innerHTML='<div class="empty">Bitte melde dich mit Discord an.</div>';return;}
  const d=currentCommunityData||{};const s=d.server;const sections=d.sections||[];const channels=d.channels||[];const perms=d.permissions||{};
  const membersByRole={};
  (d.members||[]).forEach(u=>{const key=u.community_role_name||u.role||'Mitglied';(membersByRole[key]??=[]).push(u)});
  const canManage=Number(s?.owner_id)===Number(me.id);
  const memberGroups=Object.entries(membersByRole).map(([role,users])=>`<div class="member-role-group"><div class="member-role-title"><span class="role-dot" style="--role-color:${esc(users[0]?.community_role_color||'#8b93ad')}"></span>${esc(role)} <small>${users.length}</small></div>${users.map(u=>`<button type="button" class="server-member" data-server-member-id="${u.id}"><span class="member-avatar-wrap"><img class="avatar" src="${esc(avatar(u))}"><i class="dot ${isOnline(u)?'online':''}"></i></span><span class="server-member-copy"><b>${esc(u.global_name||u.username)}</b><small>${isOnline(u)?'Online':'Offline'}</small></span></button>`).join('')}</div>`).join('');
  const channelMarkup=sections.map(sec=>`<div class="server-channel-group"><div class="section-row"><button type="button" class="section-toggle" data-toggle-section="${sec.id}"><span>▾</span>${esc(sec.name)}</button>${canManage?`<div class="channel-manage-mini"><button class="tiny-icon" data-edit-section="${sec.id}" title="Abschnitt umbenennen">✎</button></div>`:''}</div><div class="section-channel-list">${channels.filter(c=>Number(c.section_id)===Number(sec.id)).map(c=>`<div class="channel-row"><button class="channel-entry ${sameId(currentCommunityChannel?.id,c.id)?'active':''} ${c.type==='voice'?'voice':''}" data-channel-id="${c.type==='text'?c.id:''}" data-voice-id="${c.type==='voice'?c.id:''}"><span class="channel-icon">${c.type==='text'?'#':'🔊'}</span><span>${esc(c.name)}</span><span class="channel-state">${c.type==='voice'?'':' '}</span></button>${canManage?`<button class="tiny-icon" data-edit-channel="${c.id}" title="Kanal bearbeiten">✎</button>`:''}</div>`).join('')||'<div class="empty compact">Keine Kanäle</div>'}</div></div>`).join('');
  $('#page-servers').innerHTML=`<div class="server-page-shell"><div class="server-page-top"><div><div class="eyebrow">ZOCKERFREUNDE · SERVER</div><h1>Meine Server</h1><p>Private Communities, Textkanäle und Voice — alles an einem Ort.</p></div><div class="server-page-actions"><button class="server-action ghost" id="joinCommunityInvite"><span>🔗</span><div><b>Einladung</b><small>Beitreten</small></div></button><button class="server-action discovery" id="discoverCommunityServers"><span>🔎</span><div><b>Server entdecken</b><small>Öffentliche Communities</small></div></button><button class="server-action create" id="createCommunityServer"><span>＋</span><div><b>Server erstellen</b><small>Deine eigene Community</small></div></button></div></div>${s?`<div class="server-workspace"><aside class="server-rail card"><div class="server-rail-head"><div class="server-rail-title"><span>MEINE SERVER</span><b>${communityServers.length}</b></div></div><div class="server-entry-list">${communityServers.map(serverCard).join('')||'<div class="empty compact">Noch kein Server.</div>'}</div></aside><section class="server-main server-main-redesign card"><header class="server-main-head-redesign"><div class="server-hero-identity"><div class="server-big-icon">${s.icon?`<img src="${esc(s.icon)}" alt="">`:esc((s.name||'?').slice(0,1).toUpperCase())}</div><div class="server-hero-copy"><div class="server-title-line"><h2>${esc(s.name)}</h2>${s.discoverable?'<span class="discover-badge">🔎 Entdeckbar</span>':'<span class="private-badge">🔒 Privat</span>'}</div><p>${esc(s.description||'Nur eingeladene Mitglieder können diesen Server sehen.')}</p><small>👥 ${d.members?.length||0} Mitglieder</small></div></div><div class="server-main-actions">${canManage?`<button class="server-icon-action manage" id="openServerSettings" title="Server verwalten">⚙<span>Verwalten</span></button>`:''}<button class="server-icon-action" id="inviteCommunityServer" title="Mitglieder einladen">＋<span>Einladen</span></button><button class="server-icon-action leave" id="leaveCommunityServer" title="Server verlassen">↪<span>${canManage?'Löschen':'Verlassen'}</span></button></div></header><div class="server-content-grid"><aside class="server-channel-sidebar"><div class="channel-sidebar-header"><span>KANÄLE</span>${canManage?`<div class="channel-add-actions"><button id="addCommunitySection" class="tiny-icon accent" title="Abschnitt erstellen">＋</button><button id="addCommunityChannel" class="tiny-icon accent" title="Kanal erstellen">◈</button></div>`:''}</div><div class="server-channels-scroll">${channelMarkup||'<div class="empty compact">Keine Abschnitte.</div>'}</div></aside><main id="serverChannelView" class="server-channel-view server-channel-view-redesign">${currentVoiceChannel?'<div class="empty">Du bist weiterhin im Sprachkanal. Nutze die Sprachleiste unten.</div>':currentCommunityChannel?'<div class="empty">Lade Kanal …</div>':'<div class="server-welcome"><div class="server-welcome-icon">💬</div><h2>Willkommen auf ${esc(s.name)}</h2><p>Wähle links einen Kanal, um loszulegen.</p></div>'}</main><aside class="server-member-sidebar"><div class="member-sidebar-head"><span>MITGLIEDER</span><b>${d.members?.length||0}</b></div><div class="member-sidebar-scroll">${memberGroups||'<div class="empty compact">Keine Mitglieder.</div>'}</div></aside></div>${currentVoiceChannel?'<div id="persistentVoiceBar" class="persistent-voice-bar redesign-voice-bar"></div>':''}</section></div>`:`<div class="server-empty-state server-empty-redesign"><div class="server-empty-icon">🖥</div><h2>Deine privaten Server</h2><p>Erstelle deinen ersten Server oder tritt über einen Einladungslink bei.</p><div class="server-empty-actions"><button class="server-action create" id="createCommunityServer"><span>＋</span><div><b>Server erstellen</b><small>Deine eigene Community</small></div></button><button class="server-action ghost" id="joinCommunityInvite"><span>🔗</span><div><b>Einladung verwenden</b><small>Mit Einladung beitreten</small></div></button><button class="server-action discovery" id="discoverCommunityServers"><span>🔎</span><div><b>Server entdecken</b><small>Öffentliche Communities</small></div></button></div></div>`}</div>`;
  $$( '#page-servers .server-entry').forEach(b=>b.onclick=()=>openCommunityServer(Number(b.dataset.communityServer)));
  $('#createCommunityServer')?.addEventListener('click',createCommunityServer);$('#joinCommunityInvite')?.addEventListener('click',joinCommunityInvite);$('#discoverCommunityServers')?.addEventListener('click',openDiscoverServers);$('#inviteCommunityServer')?.addEventListener('click',createCommunityInvite);$('#openServerSettings')?.addEventListener('click',openServerSettings);$('#addCommunityChannel')?.addEventListener('click',createCommunityChannel);$('#addCommunitySection')?.addEventListener('click',createCommunitySection);$('#leaveCommunityServer')?.addEventListener('click',leaveServer);
  $$('#page-servers [data-channel-id]').forEach(b=>b.onclick=()=>b.dataset.channelId&&openCommunityChannel(Number(b.dataset.channelId)));
  $$('#page-servers [data-voice-id]').forEach(b=>b.onclick=()=>b.dataset.voiceId&&openVoiceLobby(Number(b.dataset.voiceId)));
  $$('#page-servers [data-edit-channel]').forEach(b=>b.onclick=()=>editCommunityChannel(Number(b.dataset.editChannel)));
  $$('#page-servers [data-edit-section]').forEach(b=>b.onclick=e=>{e.stopPropagation();editCommunitySection(Number(b.dataset.editSection))});
  $$('#page-servers [data-toggle-section]').forEach(b=>b.onclick=()=>{const g=b.closest('.server-channel-group');const list=g?.querySelector('.section-channel-list');if(!list)return;const hidden=list.classList.toggle('collapsed');b.querySelector('span').textContent=hidden?'▸':'▾'});
  $$('#page-servers [data-server-member-id]').forEach(b=>b.onclick=()=>showMemberProfile(Number(b.dataset.serverMemberId)));
  renderPersistentVoiceBar();
}
async function createCommunityServer(){if(!me)return;const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card small-modal"><button class="gate-close" data-close>×</button><div class="server-settings-title"><div class="eyebrow">NEUER SERVER</div><h2>＋ Eigenen Server erstellen</h2><p>Privat, nur für dich und eingeladene Mitglieder.</p></div><label class="field-label">Servername<input id="newServerName" class="settings-input" maxlength="50" placeholder="Mein Gaming-Server"></label><label class="field-label">Beschreibung<input id="newServerDescription" class="settings-input" maxlength="180" placeholder="Worum geht es auf dem Server?"></label><label class="field-label">Server-Icon URL<input id="newServerIcon" class="settings-input" maxlength="500" placeholder="https://… (optional)"></label><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="createServerSubmit">Server erstellen</button></div></div>`;document.body.appendChild(modal);modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));modal.querySelector('#createServerSubmit').onclick=async()=>{const name=modal.querySelector('#newServerName').value.trim();if(!name){toast('Bitte einen Servernamen eingeben.');return}try{const d=await api('/api/servers',{method:'POST',body:JSON.stringify({name,description:modal.querySelector('#newServerDescription').value.trim(),icon:modal.querySelector('#newServerIcon').value.trim()})});modal.remove();toast(`Server „${d.server.name}“ erstellt!`);await loadCommunityServers();await openCommunityServer(d.server.id)}catch{toast('Server konnte nicht erstellt werden.')}}}
async function joinCommunityInvite(){
  if(!me)return;
  const modal=document.createElement('div');modal.className='server-modal';
  modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">SERVER BEITRETEN</div><h2>🔗 Einladung eingeben</h2><p class="modal-help">Füge einen Einladungslink oder Code ein.</p><input id="inviteInput" class="settings-input" maxlength="300" placeholder="Einladungslink oder Code"><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="joinInviteSubmit">Beitreten</button></div></div>`;
  document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));
  $('#joinInviteSubmit').onclick=async()=>{const invite=$('#inviteInput').value.trim();if(!invite){toast('Bitte Einladung eingeben.');return}try{const d=await api('/api/invites/join',{method:'POST',body:JSON.stringify({invite})});modal.remove();toast(d.alreadyMember?`Du bist bereits auf „${d.serverName}“.`:`Du bist „${d.serverName}“ beigetreten!`);await loadCommunityServers();await openCommunityServer(d.serverId)}catch{toast('Einladung konnte nicht angenommen werden.')}};
}
async function createCommunityInvite(){if(!currentCommunityServer)return;try{const d=await api('/api/servers/'+currentCommunityServer.id+'/invites',{method:'POST',body:JSON.stringify({})});const link=serverInviteUrl(d.invite.code);try{await navigator.clipboard.writeText(link);toast('Einladungslink kopiert!')}catch{}const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">EINLADUNG</div><h2>🔗 Server einladen</h2><p>Teile diesen Link mit deinen Freunden:</p><div class="invite-link-box">${esc(link)}</div><div class="actions modal-actions"><button class="secondary" data-close>Schließen</button><button class="primary" id="copyInviteAgain">Link kopieren</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());$('#copyInviteAgain').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('Link kopiert!')}catch{toast('Kopieren wird von diesem Browser blockiert.')}};requestAnimationFrame(()=>modal.classList.add('show'))}catch{toast('Einladung konnte nicht erstellt werden.')}}
async function createCommunitySection(){
  if(!currentCommunityServer)return;const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">KANALBEREICH</div><h2>＋ Abschnitt erstellen</h2><input id="sectionNameInput" class="settings-input" maxlength="32" placeholder="z. B. COMMUNITY"><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="saveSectionBtn">Erstellen</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#saveSectionBtn').onclick=async()=>{const name=$('#sectionNameInput').value.trim();if(!name){toast('Bitte einen Namen eingeben.');return}try{await api(`/api/servers/${currentCommunityServer.id}/sections`,{method:'POST',body:JSON.stringify({name})});modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Abschnitt konnte nicht erstellt werden.')}};
}
async function editCommunitySection(id){
  const sec=(currentCommunityData?.sections||[]).find(x=>Number(x.id)===Number(id));if(!sec)return;const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">ABSCHNITT</div><h2>✎ Abschnitt bearbeiten</h2><input id="sectionNameInput" class="settings-input" value="${esc(sec.name)}" maxlength="32"><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="saveSectionBtn">Speichern</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#saveSectionBtn').onclick=async()=>{const name=$('#sectionNameInput').value.trim();if(!name)return;try{await api(`/api/servers/${currentCommunityServer.id}/sections/${id}`,{method:'PATCH',body:JSON.stringify({name})});modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Abschnitt konnte nicht geändert werden.')}};
}
async function createCommunityChannel(){
  if(!currentCommunityServer)return;const sections=currentCommunityData?.sections||[];if(!sections.length){toast('Erstelle zuerst einen Abschnitt.');return}
  const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">KANAL VERWALTEN</div><h2>＋ Neuen Kanal</h2><label class="field-label">Name<input id="channelNameInput" class="settings-input" maxlength="32" placeholder="z. B. gaming"></label><label class="field-label">Typ<select id="channelTypeInput" class="settings-input"><option value="text"># Textkanal</option><option value="voice">🔊 Voice-Kanal</option></select></label><label class="field-label">Abschnitt<select id="channelSectionInput" class="settings-input">${sections.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="saveChannelBtn">Kanal erstellen</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#saveChannelBtn').onclick=async()=>{const name=$('#channelNameInput').value.trim();const type=$('#channelTypeInput').value;const sectionId=Number($('#channelSectionInput').value);if(!name)return toast('Bitte einen Kanalnamen eingeben.');try{await api(`/api/servers/${currentCommunityServer.id}/channels`,{method:'POST',body:JSON.stringify({name,type,sectionId})});modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Kanal konnte nicht erstellt werden.')}};
}
async function editCommunityChannel(id){
  const c=(currentCommunityData?.channels||[]).find(x=>Number(x.id)===Number(id));if(!c)return;const sections=currentCommunityData?.sections||[];
  const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">KANAL</div><h2>✎ ${c.type==='voice'?'Voice':'Text'}kanal bearbeiten</h2><label class="field-label">Name<input id="channelNameInput" class="settings-input" value="${esc(c.name)}" maxlength="32"></label><label class="field-label">Abschnitt<select id="channelSectionInput" class="settings-input">${sections.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(c.section_id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><div class="channel-delete-zone"><span><b>Kanal löschen</b><small>Alle Nachrichten dieses Kanals werden ebenfalls entfernt.</small></span><button class="secondary danger-btn" id="deleteChannelBtn">Löschen</button></div><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="saveChannelBtn">Speichern</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#saveChannelBtn').onclick=async()=>{try{await api(`/api/servers/${currentCommunityServer.id}/channels/${id}`,{method:'PATCH',body:JSON.stringify({name:$('#channelNameInput').value.trim(),sectionId:Number($('#channelSectionInput').value)})});modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Kanal konnte nicht geändert werden.')}};$('#deleteChannelBtn').onclick=async()=>{if(String(c.name).toLowerCase()==='allgemein'){toast('Der Kanal Allgemein kann nicht gelöscht werden.');return}const ok=await serverConfirm('Kanal löschen?',`„${c.name}“ und seine Nachrichten werden dauerhaft gelöscht.`,'Kanal löschen');if(!ok)return;try{await api(`/api/servers/${currentCommunityServer.id}/channels/${id}`,{method:'DELETE'});modal.remove();currentCommunityChannel=null;await openCommunityServer(currentCommunityServer.id);toast('Kanal gelöscht.')}catch{toast('Kanal konnte nicht gelöscht werden.')}};
}
async function leaveServer(){
  if(!currentCommunityServer)return;const owner=Number(currentCommunityServer.owner_id)===Number(me.id);const ok=await serverConfirm(owner?'Server löschen?':'Server verlassen?',owner?'Der gesamte Server mit Kanälen, Nachrichten und Rollen wird gelöscht.':'Du verlässt diesen Server und kannst nur über eine neue Einladung zurückkehren.',owner?'Server löschen':'Server verlassen');if(!ok)return;const sid=currentCommunityServer.id;try{if(currentVoiceChannel)await leaveCommunityVoice();if(owner)await api(`/api/servers/${sid}`,{method:'DELETE'});else await api(`/api/servers/${sid}/leave`,{method:'POST'});currentCommunityServer=null;currentCommunityData=null;currentCommunityChannel=null;await loadCommunityServers();renderServers();toast(owner?'Server gelöscht.':'Server verlassen.')}catch{toast('Server-Aktion konnte nicht durchgeführt werden.')}}
function serverConfirm(title,text,confirmText='Bestätigen'){return new Promise(resolve=>{const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal confirm-modal"><button class="gate-close" data-cancel>×</button><div class="confirm-icon">!</div><div class="eyebrow">BESTÄTIGUNG</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions modal-actions"><button class="secondary" data-cancel>Abbrechen</button><button class="primary danger-solid" data-ok>${esc(confirmText)}</button></div></div>`;document.body.appendChild(modal);const done=v=>{modal.remove();resolve(v)};$$('[data-cancel]',modal).forEach(b=>b.onclick=()=>done(false));modal.querySelector('[data-ok]').onclick=()=>done(true);requestAnimationFrame(()=>modal.classList.add('show'))})}

async function openServerSettings(){if(!currentCommunityServer||!currentCommunityData)return;const d=currentCommunityData;let modal=$('#serverSettingsModal');if(modal)modal.remove();modal=document.createElement('div');modal.id='serverSettingsModal';modal.className='server-modal';const perms=d.permissions||{};const pkeys=['manage_server','manage_channels','manage_roles','manage_members','manage_messages','send_messages','connect_voice','use_voice','attach_files','create_polls'];const pnames={manage_server:'Server verwalten',manage_channels:'Kanäle verwalten',manage_roles:'Rollen verwalten',manage_members:'Mitglieder verwalten',manage_messages:'Nachrichten verwalten',send_messages:'Nachrichten senden',connect_voice:'Sprachkanäle betreten',use_voice:'Sprachchat nutzen',attach_files:'Dateien hochladen',create_polls:'Abstimmungen erstellen'};modal.innerHTML=`<div class="server-modal-card"><button class="gate-close" id="closeServerSettings">×</button><div class="server-settings-title"><div class="eyebrow">SERVER-VERWALTUNG</div><h2>⚙ ${esc(d.server.name)}</h2><p>Server, Abschnitte, Kanäle, Rollen und Mitglieder verwalten.</p></div><div class="server-settings-grid"><section><h3>Server</h3><input id="serverNameEdit" class="settings-input" value="${esc(d.server.name)}" maxlength="50" placeholder="Servername"><input id="serverDescriptionEdit" class="settings-input" value="${esc(d.server.description||'')}" maxlength="180" placeholder="Beschreibung"><input id="serverIconEdit" class="settings-input" value="${esc(d.server.icon||'')}" maxlength="500" placeholder="Server-Icon URL"><label class="discover-toggle"><input id="serverDiscoverableEdit" type="checkbox" ${d.server.discoverable?'checked':''}><span><b>🔎 Im Server-Entdecken anzeigen</b><small>Der Server bleibt nur per Einladung beitretbar.</small></span></label><button class="primary attractive-save" id="saveServerName">✓ Änderungen speichern</button><h3>Chat-Design</h3><div class="theme-editor-grid"><label>Chat-Hintergrund<input id="serverChatBg" type="color" value="${esc(d.server.chat_bg||'#0b1020')}"></label><label>Schriftfarbe<input id="serverChatText" type="color" value="${esc(d.server.chat_text||'#f4f7ff')}"></label><label>Speech-Bubble<input id="serverChatBubble" type="color" value="${esc(d.server.chat_bubble||'#171e33')}"></label></div><div class="theme-live-preview" id="chatThemePreview"><span>Beispielnachricht</span><b>So sieht dein Chat aus.</b></div><h3>Abschnitte</h3><div class="settings-stack">${(d.sections||[]).map(x=>`<div class="manage-row"><span>${esc(x.name)}</span><button class="tiny-icon" data-settings-section="${x.id}">✎</button></div>`).join('')}</div><h3>Kanäle</h3><div class="settings-stack">${(d.channels||[]).map(x=>`<div class="manage-row"><span>${x.type==='voice'?'🔊':'#'} ${esc(x.name)}</span><button class="tiny-icon" data-settings-channel="${x.id}">✎</button></div>`).join('')}</div></section><section><h3>Rollen</h3><div class="settings-stack">${(d.roles||[]).map(r=>`<button type="button" class="role-edit-row" data-role-id="${r.id}"><span style="color:${esc(r.color)}">●</span><b>${esc(r.name)}</b><small>${Object.entries(r.permissions||{}).filter(([k,v])=>v).length} Rechte</small></button>`).join('')}</div>${perms.manage_roles?'<button class="secondary" id="newRoleBtn">＋ Rolle erstellen</button>':''}<h3>Mitglieder & Rollen</h3><div class="settings-stack member-role-list">${(d.members||[]).map(u=>{const meta=(d.membersMeta||[]).find(m=>sameId(m.id,u.id));return `<div class="manage-row"><span>${esc(u.global_name||u.username)}</span>${Number(u.id)===Number(d.server.owner_id)?'<small>Besitzer</small>':perms.manage_members?`<select class="member-role-select" data-member-role="${u.id}"><option value="">Ohne Rolle</option>${(d.roles||[]).map(r=>`<option value="${r.id}" ${String(meta?.role_id)===String(r.id)?'selected':''}>${esc(r.name)}</option>`).join('')}</select>`:'<small>Mitglied</small>'}</div>`}).join('')}</div></section></div></div>`;document.body.appendChild(modal);$('#closeServerSettings').onclick=()=>modal.remove();$('#saveServerName')?.addEventListener('click',async()=>{try{await api(`/api/servers/${d.server.id}`,{method:'PATCH',body:JSON.stringify({name:$('#serverNameEdit').value.trim(),description:$('#serverDescriptionEdit').value.trim(),icon:$('#serverIconEdit').value.trim(),discoverable:$('#serverDiscoverableEdit').checked,chatBg:$('#serverChatBg')?.value,chatText:$('#serverChatText')?.value,chatBubble:$('#serverChatBubble')?.value})});toast('Server gespeichert.');modal.remove();await openCommunityServer(d.server.id)}catch{toast('Server konnte nicht gespeichert werden.')}});$$('#serverSettingsModal [data-settings-channel]').forEach(b=>b.onclick=()=>{modal.remove();editCommunityChannel(Number(b.dataset.settingsChannel))});$$('#serverSettingsModal [data-settings-section]').forEach(b=>b.onclick=()=>{modal.remove();editCommunitySection(Number(b.dataset.settingsSection))});$$('.member-role-select').forEach(sel=>sel.onchange=async()=>{try{await api(`/api/servers/${d.server.id}/members/${sel.dataset.memberRole}/role`,{method:'POST',body:JSON.stringify({roleId:sel.value||null})});toast('Rolle aktualisiert.')}catch{toast('Rolle konnte nicht vergeben werden.')}});$('#newRoleBtn')?.addEventListener('click',async()=>{modal.remove();await openRoleEditor(null)});$$('#serverSettingsModal [data-role-id]').forEach(b=>b.onclick=()=>{modal.remove();openRoleEditor(Number(b.dataset.roleId))});const updateThemePreview=()=>{const p=$('#chatThemePreview');if(!p)return;p.style.background=$('#serverChatBg')?.value||'#0b1020';p.style.color=$('#serverChatText')?.value||'#f4f7ff';p.querySelector('b')?.style.setProperty('background',$('#serverChatBubble')?.value||'#171e33')};['serverChatBg','serverChatText','serverChatBubble'].forEach(id=>$('#'+id)?.addEventListener('input',updateThemePreview));updateThemePreview();requestAnimationFrame(()=>modal.classList.add('show'))}
async function openRoleEditor(id){const role=id?(currentCommunityData?.roles||[]).find(r=>Number(r.id)===Number(id)):null;let modal=document.createElement('div');modal.className='server-modal';const permsList=['manage_messages','send_messages','connect_voice','use_voice','attach_files','create_polls'];const pnames={manage_server:'Server verwalten',manage_channels:'Kanäle verwalten',manage_roles:'Rollen verwalten',manage_members:'Mitglieder verwalten',manage_messages:'Nachrichten verwalten',send_messages:'Nachrichten senden',connect_voice:'Sprachkanäle betreten',use_voice:'Sprachchat nutzen',attach_files:'Dateien hochladen',create_polls:'Abstimmungen erstellen'};modal.innerHTML=`<div class="server-modal-card role-editor"><button class="gate-close" data-close-role>×</button><div class="eyebrow">${role?'ROLLE BEARBEITEN':'NEUE ROLLE'}</div><h2>${role?'✎':'＋'} Rolle</h2><div class="role-editor-row"><input id="roleName" class="settings-input" value="${esc(role?.name||'Neue Rolle')}"><input id="roleColor" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(role?.color||'')?role.color:'#8b93ad'}"></div><div class="permission-grid">${permsList.map(k=>`<label><input type="checkbox" data-perm="${k}" ${role?.permissions?.[k]?'checked':''}> ${pnames[k]}</label>`).join('')}</div><div class="actions"><button class="secondary" data-close-role>Abbrechen</button><button class="primary" id="saveRole">Speichern</button>${role?'<button class="secondary danger-btn" id="deleteRole">Löschen</button>':''}</div></div>`;document.body.appendChild(modal);$$('[data-close-role]').forEach(b=>b.onclick=()=>modal.remove());$('#saveRole').onclick=async()=>{const permissions={};$$('[data-perm]').forEach(x=>permissions[x.dataset.perm]=x.checked);const body={name:$('#roleName').value,color:$('#roleColor').value,permissions};try{await api(`/api/servers/${currentCommunityServer.id}/roles${role?'/'+role.id:''}`,{method:role?'PATCH':'POST',body:JSON.stringify(body)});toast('Rolle gespeichert.');modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Rolle konnte nicht gespeichert werden.')}};$('#deleteRole')?.addEventListener('click',async()=>{if(!(await serverConfirm('Rolle löschen?','Diese Rolle wird entfernt. Mitglieder verlieren die Rolle.','Rolle löschen')))return;try{await api(`/api/servers/${currentCommunityServer.id}/roles/${role.id}`,{method:'DELETE'});toast('Rolle gelöscht.');modal.remove();await openCommunityServer(currentCommunityServer.id)}catch{toast('Rolle konnte nicht gelöscht werden.')}});requestAnimationFrame(()=>modal.classList.add('show'))}

async function openCommunityChannel(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c||c.type!=='text')return;currentCommunityChannel=c;socket?.emit('server_channel_watch',{serverId:Number(currentCommunityServer.id),channelId:Number(c.id)});$$('#page-servers [data-channel-id]').forEach(b=>b.classList.toggle('active',sameId(b.dataset.channelId,c.id)));const view=$('#serverChannelView');if(!view)return;view.style.setProperty('--chat-bg',currentCommunityData?.server?.chat_bg||'#0b1020');view.style.setProperty('--chat-text',currentCommunityData?.server?.chat_text||'#f4f7ff');view.style.setProperty('--chat-bubble',currentCommunityData?.server?.chat_bubble||'#171e33');view.innerHTML=`<div class="server-chat-head"><div><h3># ${esc(c.name)}</h3><small>Privater Textkanal</small></div><div class="chat-tools"><label class="file-btn">📎<input id="serverFileInput" type="file" multiple hidden></label><button class="secondary" id="serverPollBtn">📊 Umfrage</button></div></div><div id="serverAttachmentsPreview" class="attachment-preview"></div><div id="serverMessages" class="messages"></div><form id="serverMessageForm" class="composer"><input id="serverMessageInput" maxlength="1000" placeholder="# ${esc(c.name)} schreiben …"><button class="primary">Senden</button></form>`;const perms=currentCommunityData.permissions||{};if(!perms.attach_files)$('#serverFileInput')?.remove();let pendingFiles=[];$('#serverFileInput')?.addEventListener('change',async e=>{pendingFiles=Array.from(e.target.files||[]);$('#serverAttachmentsPreview').innerHTML=pendingFiles.map(f=>`<span class="attachment-chip">${esc(f.name)}</span>`).join('')});if(!perms.create_polls)$('#serverPollBtn')?.remove();else $('#serverPollBtn')?.addEventListener('click',createPollForCurrentChannel);$('#serverMessageForm').onsubmit=async e=>{e.preventDefault();const i=$('#serverMessageInput');const text=i.value.trim();if(!text&&!pendingFiles.length)return;try{const attachments=await filesToData(pendingFiles);await api(`/api/servers/${currentCommunityServer.id}/channels/${c.id}/messages`,{method:'POST',body:JSON.stringify({message:text,attachments})});i.value='';pendingFiles=[];$('#serverAttachmentsPreview').innerHTML='';}catch(err){toast('Nachricht oder Dateien konnten nicht gesendet werden.')}};try{const d=await api(`/api/servers/${currentCommunityServer.id}/channels/${c.id}/messages`);const e=$('#serverMessages');if(e)e.innerHTML=d.messages.map(communityMessageHTML).join('');scrollCommunityMessages()}catch{toast('Kanal konnte nicht geladen werden.')}}
async function filesToData(files){const out=[];let total=0;for(const f of files.slice(0,8)){if(f.size>8*1024*1024){toast(`${f.name} ist zu groß (max. 8 MB).`);continue}total+=f.size;if(total>16*1024*1024)break;const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f)});out.push({filename:f.name,mime:f.type||'application/octet-stream',data})}return out}
async function createPollForCurrentChannel(){if(!currentCommunityServer||!currentCommunityChannel)return;const modal=document.createElement('div');modal.className='server-modal';modal.innerHTML=`<div class="server-modal-card action-modal"><button class="gate-close" data-close>×</button><div class="eyebrow">UMFRAGE</div><h2>📊 Neue Abstimmung</h2><label class="field-label">Frage<input id="pollQuestion" class="settings-input" maxlength=180 value="Was sollen wir heute spielen?"></label><label class="field-label">Antworten <small>(eine pro Zeile)</small><textarea id="pollOptions" class="settings-input" rows=5> Minecraft\nRoblox\nFortnite</textarea></label><label class="discover-toggle"><input id="pollMulti" type="checkbox"><span><b>Mehrfachauswahl</b><small>Mitglieder dürfen mehrere Antworten auswählen.</small></span></label><div class="actions modal-actions"><button class="secondary" data-close>Abbrechen</button><button class="primary" id="createPollBtn">Erstellen</button></div></div>`;document.body.appendChild(modal);$$('[data-close]',modal).forEach(b=>b.onclick=()=>modal.remove());requestAnimationFrame(()=>modal.classList.add('show'));$('#createPollBtn').onclick=async()=>{const q=$('#pollQuestion').value.trim();const options=$('#pollOptions').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,10);if(!q||options.length<2)return toast('Frage und mindestens zwei Antworten nötig.');try{await api(`/api/servers/${currentCommunityServer.id}/channels/${currentCommunityChannel.id}/messages`,{method:'POST',body:JSON.stringify({poll:{question:q,options,multi:$('#pollMulti').checked},message:''})});modal.remove()}catch{toast('Umfrage konnte nicht erstellt werden.')}}}
function communityMessageHTML(m){const mine=me&&sameId(m.user_id,me.id);const attachments=(m.attachments||[]).map(a=>{const url=`/api/community-attachments/${a.id}`;if((a.mime||'').startsWith('image/'))return `<a class="message-file image-file" href="${url}" target="_blank"><img src="${url}" alt="${esc(a.filename)}"></a>`;if((a.mime||'').startsWith('video/'))return `<video class="message-video" controls src="${url}"></video>`;return `<a class="message-file" href="${url}" target="_blank">📎 ${esc(a.filename)}</a>`}).join('');let poll='';if(m.message_type==='poll'&&m.poll_data){const pd=m.poll_data,counts=pd.counts||{},my=m.myVotes||[];poll=`<div class="poll-card"><b>📊 ${esc(pd.question||'Abstimmung')}</b>${pd.multi?'<small class="poll-note">Mehrfachauswahl</small>':''}<div class="poll-options">${(pd.options||[]).map((o,i)=>`<button type="button" class="poll-option ${my.includes(i)?'selected':''}" data-poll-option="${i}" data-poll-message="${m.id}"><span>${esc(o)}</span><strong>${Number(counts[i]||0)}</strong></button>`).join('')}</div></div>`}const reacts=(m.reactions||[]).map(r=>`<button type="button" class="reaction-chip ${r.mine?'mine':''}" data-reaction-message="${m.id}" data-reaction-emoji="${esc(r.emoji)}">${esc(r.emoji)} ${Number(r.count||0)}</button>`).join('');const manageMessages=Boolean(currentCommunityData?.permissions?.manage_messages),canEdit=mine,canDelete=mine||manageMessages,canPin=manageMessages;return `<div class="msg server-msg ${mine?'me':''} ${m.pinned?'is-pinned':''}" data-server-message="${m.id}"><img class="avatar" src="${esc(avatar(m))}"><div class="server-msg-body"><div class="meta">${esc(m.global_name||m.username)} · ${esc(m.role||'Mitglied')} ${m.pinned?'<span class="pin-mark">📌 angepinnt</span>':''} ${m.edited_at?'<span class="edited-mark">bearbeitet</span>':''}</div>${m.message?`<div class="bubble" data-message-body="${m.id}">${esc(m.message)}</div>`:''}${attachments}${poll}${reacts?`<div class="reaction-row">${reacts}</div>`:''}<div class="message-actions">${canEdit&&m.message?`<button type="button" class="tiny-icon" data-edit-server-message="${m.id}" title="Bearbeiten">✎</button>`:''}${canPin?`<button type="button" class="tiny-icon" data-pin-server-message="${m.id}" title="${m.pinned?'Loslösen':'Anpinnen'}">📌</button>`:''}<button type="button" class="tiny-icon" data-reaction-message="${m.id}" data-reaction-emoji="👍">👍</button><button type="button" class="tiny-icon" data-reaction-message="${m.id}" data-reaction-emoji="❤️">❤️</button>${canDelete?`<button type="button" class="tiny-delete" data-delete-server-message="${m.id}">Löschen</button>`:''}</div></div></div>`}
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
async function joinCommunityVoice(id){const c=(currentCommunityData?.channels||[]).find(x=>sameId(x.id,id));if(!c||c.type!=='voice')return;try{if(currentVoiceChannel&&!sameId(currentVoiceChannel.id,c.id)){for(const [,item] of voicePeers){item.pc?.close()}voicePeers.clear()}if(!voiceLocalStream)voiceLocalStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});currentVoiceChannel=c;renderServers();const view=$('#serverChannelView');if(view)view.innerHTML=`<div class="voice-room"><div class="server-chat-head"><div><h3>🔊 ${esc(c.name)}</h3><small>Sprachkanal · Peer-to-Peer</small></div></div><div class="voice-room-info">Verbunden. Mikro, Video, Bildschirmfreigabe und Lautstärke kannst du unten steuern.</div><div id="voiceStatusList" class="voice-members"></div></div>`;updateVoiceMemberList();socket?.emit('server_voice_join',{serverId:Number(currentCommunityServer.id),channelId:Number(c.id)});renderPersistentVoiceBar()}catch{toast('Mikrofonzugriff wurde nicht erlaubt oder ist nicht verfügbar.')}}
async function leaveCommunityVoice(){socket?.emit('server_voice_leave');for(const [,item] of voicePeers){item.pc?.close();document.getElementById('voice-audio-'+item.peerId)?.remove();document.getElementById('voice-video-'+item.peerId)?.remove()}voicePeers.clear();if(voiceLocalStream){voiceLocalStream.getTracks().forEach(t=>t.stop());voiceLocalStream=null}if(voiceScreenStream){voiceScreenStream.getTracks().forEach(t=>t.stop());voiceScreenStream=null}currentVoiceChannel=null;renderServers();if(currentCommunityChannel&&currentCommunityChannel.type==='text')await openCommunityChannel(currentCommunityChannel.id)}
async function makeVoicePeer(peerId,user,offer){let item=voicePeers.get(peerId);if(item?.pc){if(user)item.user=user;return item.pc}const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});item={pc,user:user||null,volume:1,peerId};voicePeers.set(peerId,item);voiceLocalStream?.getTracks().forEach(t=>pc.addTrack(t,voiceLocalStream));pc.onicecandidate=e=>{if(e.candidate)socket?.emit('server_voice_signal',{target:peerId,data:{candidate:e.candidate}})};pc.ontrack=e=>{let media=document.getElementById('voice-audio-'+peerId);if(e.track.kind==='video'){media=document.getElementById('voice-video-'+peerId)||document.createElement('video');media.id='voice-video-'+peerId;media.autoplay=true;media.playsInline=true;media.className='remote-video';document.body.appendChild(media);media.srcObject=e.streams[0]}else{if(!media){media=document.createElement('audio');media.id='voice-audio-'+peerId;media.autoplay=true;media.playsInline=true;document.body.appendChild(media)}media.srcObject=e.streams[0];media.volume=item.volume??1}};pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)){pc.close();voicePeers.delete(peerId);document.getElementById('voice-audio-'+peerId)?.remove();document.getElementById('voice-video-'+peerId)?.remove();updateVoiceMemberList()}};if(offer){const o=await pc.createOffer();await pc.setLocalDescription(o);socket?.emit('server_voice_signal',{target:peerId,data:{description:pc.localDescription}})}updateVoiceMemberList();return pc}
async function renegotiateVoicePeers(){for(const [peerId,item] of voicePeers){try{const offer=await item.pc.createOffer();await item.pc.setLocalDescription(offer);socket?.emit('server_voice_signal',{target:peerId,data:{description:item.pc.localDescription}})}catch(e){console.warn('voice renegotiate',e.message)}}}
async function toggleVoiceMute(){const t=voiceLocalStream?.getAudioTracks()[0];if(!t)return;if(pttEnabled){pttEnabled=false;pttPressed=false;if($('#voicePttBtn'))$('#voicePttBtn').textContent='⌨ PTT aus'}t.enabled=!t.enabled;$('#voiceMuteBtn').textContent=t.enabled?'🎙 Mikro':'🔇 Stumm'}
async function toggleVoiceVideo(){if(!voiceLocalStream)return;let track=voiceLocalStream.getVideoTracks()[0];if(track){track.enabled=!track.enabled;$('#voiceVideoBtn').textContent=track.enabled?'📹 Video aus':'📹 Video';return}try{const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});track=stream.getVideoTracks()[0];voiceLocalStream.addTrack(track);voicePeers.forEach(i=>i.pc.addTrack(track,voiceLocalStream));track.onended=()=>{track.enabled=false};$('#voiceVideoBtn').textContent='📹 Video aus';await renegotiateVoicePeers()}catch{toast('Kamerazugriff wurde nicht erlaubt.')}}
async function shareScreen(){try{if(voiceScreenStream){voiceScreenStream.getTracks().forEach(t=>t.stop());voiceScreenStream=null;toast('Bildschirmfreigabe beendet.');return}voiceScreenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});voiceScreenStream.getTracks().forEach(track=>{voicePeers.forEach(i=>i.pc.addTrack(track,voiceScreenStream))});voiceScreenStream.getVideoTracks()[0].onended=()=>{voiceScreenStream?.getTracks().forEach(t=>t.stop());voiceScreenStream=null;renegotiateVoicePeers();};await renegotiateVoicePeers();toast('Bildschirm wird geteilt.')}catch{toast('Bildschirmfreigabe wurde abgebrochen oder nicht erlaubt.')}}
async function chooseAudioOutput(){const audios=[...document.querySelectorAll('audio')];if(!audios.length){toast('Noch keine fremde Audioquelle vorhanden.');return}if(!navigator.mediaDevices?.selectAudioOutput){toast('Dein Browser unterstützt keine Auswahl des Audioausgangs.');return}try{const out=await navigator.mediaDevices.selectAudioOutput();for(const a of audios){if(a.setSinkId)await a.setSinkId(out.deviceId)}toast(`Audioausgabe: ${out.label||'ausgewählt'}`)}catch{}}
function bindCommunitySocket(){if(!socket)return;socket.on('notification',async n=>{notificationData.notifications=[n,...(notificationData.notifications||[])].slice(0,40);notificationData.unread=(notificationData.unread||0)+1;updateNotificationBadge();toast(n.title||'Neue Benachrichtigung');if(n.type==='friend'){await loadFriends();if($('#page-friends')?.classList.contains('active'))renderFriends()}});socket.on('server_channel_message',m=>{if(currentCommunityChannel&&sameId(m.channel_id,currentCommunityChannel.id)){const e=$('#serverMessages');if(e){e.insertAdjacentHTML('beforeend',communityMessageHTML(m));scrollCommunityMessages()}}});socket.on('server_message_deleted',p=>{document.querySelector(`[data-server-message="${p.messageId}"]`)?.remove()});socket.on('server_message_edited',p=>{if(currentCommunityChannel&&sameId(p.channelId,currentCommunityChannel.id)){const el=document.querySelector(`[data-message-body="${p.id}"]`);if(el){el.textContent=p.message;el.closest('.server-msg')?.querySelector('.meta')?.insertAdjacentHTML('beforeend',' <span class="edited-mark">bearbeitet</span>')}}});socket.on('server_message_pinned',p=>{if(currentCommunityChannel&&sameId(p.channelId,currentCommunityChannel.id)){const row=document.querySelector(`[data-server-message="${p.id}"]`);row?.classList.toggle('is-pinned',Boolean(p.pinned));const meta=row?.querySelector('.meta');if(meta&&!meta.querySelector('.pin-mark')&&p.pinned)meta.insertAdjacentHTML('beforeend',' <span class="pin-mark">📌 angepinnt</span>')}});socket.on('server_message_reactions',p=>{if(currentCommunityChannel&&document.querySelector(`[data-server-message="${p.messageId}"]`))openCommunityChannel(currentCommunityChannel.id)});socket.on('server_poll_updated',async()=>{if(currentCommunityChannel)openCommunityChannel(currentCommunityChannel.id)});socket.on('server_voice_peer',async p=>{if(!currentVoiceChannel)return;await makeVoicePeer(p.socketId,p.user,true);updateVoiceMemberList()});socket.on('server_voice_peer_joined',p=>{if(!currentVoiceChannel)return;voicePeers.set(p.socketId,{pc:voicePeers.get(p.socketId)?.pc||null,user:p.user,volume:1,peerId:p.socketId});updateVoiceMemberList()});socket.on('server_voice_peer_left',p=>{const item=voicePeers.get(p.socketId);item?.pc?.close();voicePeers.delete(p.socketId);document.getElementById('voice-audio-'+p.socketId)?.remove();document.getElementById('voice-video-'+p.socketId)?.remove();updateVoiceMemberList()});socket.on('server_voice_signal',async packet=>{const from=packet.from;let item=voicePeers.get(from);if(!item){item={pc:null,user:null,volume:1,peerId:from};voicePeers.set(from,item)}if(!item.pc){await makeVoicePeer(from,item.user,false);item=voicePeers.get(from)}const d=packet.data||{};try{if(d.description){if(d.description.type==='offer'){await item.pc.setRemoteDescription(d.description);const ans=await item.pc.createAnswer();await item.pc.setLocalDescription(ans);socket?.emit('server_voice_signal',{target:from,data:{description:item.pc.localDescription}})}else if(d.description.type==='answer'){await item.pc.setRemoteDescription(d.description)}}else if(d.candidate)await item.pc.addIceCandidate(d.candidate)}catch(e){console.warn('voice signal',e.message)}})}
document.addEventListener('click',async e=>{const react=e.target.closest('[data-reaction-message]');if(react&&currentCommunityChannel){e.preventDefault();await reactToServerMessage(Number(react.dataset.reactionMessage),react.dataset.reactionEmoji);return}const edit=e.target.closest('[data-edit-server-message]');if(edit){e.preventDefault();await editServerMessage(Number(edit.dataset.editServerMessage));return}const pin=e.target.closest('[data-pin-server-message]');if(pin){e.preventDefault();await pinServerMessage(Number(pin.dataset.pinServerMessage));return}});
function renderLeaderboard(){
  const sorted=[...members].sort((a,b)=>(b.xp-a.xp)||((b.level||1)-(a.level||1)));
  $('#page-leaderboard').innerHTML=`<div class="section-title"><div><h2>🏆 Rangliste</h2><div class="eyebrow">LEVEL · XP · AKTIVITÄT</div></div></div><div class="card"><div class="rank-help">+2 XP pro öffentlicher Nachricht · +25 XP einmal täglich beim Login</div>${sorted.map((u,i)=>`<div class="rank-row"><div class="rank-number">#${i+1}</div><div class="member-head"><img class="avatar" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="role">${esc(displayRole(u))}</div></div></div><div class="rank-level"><strong>Level ${u.level||1}</strong>${levelInfo(u)}</div><div class="rank-xp">${u.xp} XP</div></div>`).join('')||'<div class="empty">Noch keine Rangliste.</div>'}</div>`;
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
  $('#page-members').innerHTML=`<div class="profile"><div class="card profile-card"><img class="avatar" src="${esc(avatar(u))}"><h2>${esc(u.global_name||u.username)}</h2><div class="role">${esc(displayRole(u))}</div><p>${esc(u.bio||'Noch keine Beschreibung.')}</p>${discordInfo(u)}${levelInfo(u)}<div class="online-label" style="justify-content:center"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'}</div><div class="actions" style="justify-content:center"><button class="secondary" onclick="renderMembers()">← Zur Mitgliederliste</button><button class="primary" onclick="startPrivate(${String(u.id)})">✉ Nachricht</button></div></div><div><div class="section-title"><h2>Account-Informationen</h2></div><div class="info-grid"><div class="card info"><span>Discord-Name</span><strong>${esc(u.username)}</strong></div><div class="card info"><span>Discord-ID</span><strong class="small-value">${esc(u.discord_id||'—')}</strong></div><div class="card info"><span>Discord-Rolle</span><strong>${(u.discord_roles||[]).map(r=>esc(r.name)).join(', ')||'Keine Rolle'}</strong></div><div class="card info"><span>Level</span><strong>${u.level||1}</strong></div><div class="card info"><span>XP</span><strong>${u.xp}</strong></div><div class="card info"><span>Öffentliche Nachrichten</span><strong>${u.message_count||0}</strong></div><div class="card info"><span>Mitglied seit</span><strong>${new Date(u.created_at).toLocaleDateString('de-DE')}</strong></div><div class="card info"><span>Discord-Server</span><strong>${u.discord_in_server?'✓ Mitglied':'✕ Nicht Mitglied'}</strong></div></div></div></div>`;
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
            <div class="member-head"><img class="avatar" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="role">${esc(displayRole(u))} · Level ${u.level||1} · ${u.xp} XP</div></div></div>
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
function refreshMembers(){
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
  }).catch(()=>{});
}
function connectSocket(){if(socket)return;socket=io();socket.on('public_message',m=>{
  if(me&&sameId(m.user_id,me.id)){const oldLevel=Number(me.level||1);me={...me,xp:me.xp+Number(m.xp_gain||0),message_count:(me.message_count||0)+1};me.level=levelFromXPClient(me.xp);me.level_start_xp=levelStartXPClient(me.level);me.level_next_xp=levelNextXPClient(me.level);me.level_progress=Math.min(100,Math.max(0,((me.xp-me.level_start_xp)/(me.level_next_xp-me.level_start_xp))*100));members=members.map(u=>sameId(u.id,me.id)?me:u);localStorage.setItem(`zf_level_${me.id}`,String(me.level||1));if(me.level>oldLevel)showLevelUp(me.level);if($('#page-leaderboard')?.classList.contains('active'))renderLeaderboard();}
  const e=$('#publicMessages');if(e){e.insertAdjacentHTML('beforeend',messageHTML(m));scrollMsgs()}
  refreshMembers();
});
socket.on('public_chat_cleared',()=>{const e=$('#publicMessages');if(e)e.innerHTML='';});
socket.on('private_message',m=>{if(currentPrivate&&(sameId(m.sender_id,currentPrivate.id)||sameId(m.receiver_id,currentPrivate.id))){const e=$('#privateMessages');if(e){e.insertAdjacentHTML('beforeend',messageHTML(m));scrollPrivate()}}});
bindCommunitySocket();
socket.on('presence',p=>{members=members.map(u=>sameId(u.id,p.userId)?{...u,last_seen:p.status==='online'?new Date().toISOString():u.last_seen}:u);renderHome();if($('.page.active')?.id==='page-members')renderMembers()});
setInterval(refreshMembers,30000);
}async function go(page,update=true){
  if(protectedPages.has(page)&&!me){showLoginGate();return}
  $$(' .page').forEach(p=>p.classList.remove('active'));$(`#page-${page}`).classList.add('active');
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  if(update)$('#crumb').textContent=pages[page];
  setPageTheme(page);
  if(page==='home')renderHome();if(page==='members')renderMembers();if(page==='friends'){loadFriends().then(renderFriends)}if(page==='chat')renderChat();
  if(page==='private')renderPrivate();if(page==='leaderboard')renderLeaderboard();if(page==='servers'){await loadCommunityServers();renderServers();}if(page==='settings')await renderSettings();
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
fetch('/api/me').then(r=>r.json()).then(async d=>{me=d.user;if(!me){renderTop();renderHome();setPageTheme('home');return}const m=await api('/api/members');members=m.members;try{friendsData=await api('/api/friends')}catch{}renderTop();await loadNotifications();renderTop();renderHome();renderMembers();renderChat();renderPrivate();renderLeaderboard();try{await loadCommunityServers();}catch{}renderServers();if(communityServers[0]){try{await openCommunityServer(communityServers[0].id)}catch{}}await autoJoinPendingInvite();renderSettings();connectSocket();setPageTheme('home');}).catch(console.error);
fetch('/api/settings').then(r=>r.ok?r.json():null).then(d=>{if(d?.settings?.theme&&d.settings.theme!=='neon')document.body.classList.add(d.settings.theme)}).catch(()=>{});
fetch('/api/config').then(r=>r.json()).then(c=>{
  config=c;
  document.querySelectorAll('#discordLink,#settingsDiscord').forEach(a=>{
    if(c.discordInvite){a.href=c.discordInvite;a.removeAttribute('aria-disabled');}
    else{
      a.href='#';
      a.setAttribute('aria-disabled','true');
      a.onclick=e=>{e.preventDefault();toast('Discord-Invite fehlt noch. Auf Render DISCORD_INVITE_URL eintragen.');};
    }
  });
}).catch(()=>{});
