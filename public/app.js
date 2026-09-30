const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let me=null,members=[],socket=null,currentPrivate=null,config={},friendsData={friends:[],sent:[],incoming:[],blocked:[]},selectedFriend=null;
const pages={home:'Startseite',members:'Mitglieder',friends:'Freunde',chat:'Öffentlicher Chat',private:'Private Chats',leaderboard:'Rangliste',settings:'Einstellungen'};
const protectedPages=new Set(['members','friends','chat','private','leaderboard','settings']);
const pageThemes={home:'theme-home',members:'theme-members',friends:'theme-members',chat:'theme-chat',private:'theme-private',leaderboard:'theme-leaderboard',settings:'theme-settings'};
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
function friendButton(u){if(!me||sameId(u.id,me.id))return '';const id=String(u.id),r=friendRelation(id);if(r==='none')return `<button id="friend-add-${id}" class="friend-add-btn" title="Freundschaftsanfrage senden" onclick="sendFriendRequest(${JSON.stringify(String(id))},this);event.stopPropagation()">👤<b>＋</b></button>`;if(r==='friend')return `<button class="friend-add-btn friend-ok" title="Bereits befreundet" onclick="openFriendMenu(${JSON.stringify(String(id))});event.stopPropagation()">✓</button>`;if(r==='incoming')return `<button class="friend-add-btn" title="Freundschaftsanfrage beantworten" onclick="go('friends');event.stopPropagation()">📩</button>`;if(r==='sent')return '';return `<button class="friend-add-btn friend-blocked" title="Blockiert" onclick="go('friends');event.stopPropagation()">⊘</button>`;}
function memberCard(u){return `<div class="card member-card"><div class="member-head member-head-friend"><img class="avatar" src="${esc(avatar(u))}"><div><div class="member-name">${esc(u.global_name||u.username)}</div><div class="role">${esc(displayRole(u))}</div></div>${friendButton(u)}</div><p>${esc(u.bio||'Noch keine Beschreibung.')}</p>${discordInfo(u)}${levelInfo(u)}<div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'} · ${u.message_count||0} Nachrichten</div><div class="actions"><button class="secondary" onclick="showProfile('${u.id}')">Profil ansehen</button><button class="secondary" onclick="startPrivate(${JSON.stringify(String(u.id))})">Nachricht</button></div></div>`}
async function load(){
  const d=await api('/api/me');me=d.user;
  const m=await api('/api/members');members=m.members;
  if(me){try{friendsData=await api('/api/friends')}catch{friendsData={friends:[],sent:[],incoming:[],blocked:[]};}}
  if(me){checkStoredLevel(me);members=members.map(u=>sameId(u.id,me.id)?{...u,last_seen:new Date().toISOString()}:u);me=members.find(u=>sameId(u.id,me.id))||me;}
  renderTop();renderHome();connectSocket();
}
function renderTop(){ $('#topUser').innerHTML=me?`<div class="user-mini"><i class="dot online"></i><img class="avatar" src="${esc(avatar(me))}"><b>${esc(me.global_name||me.username)}</b></div>`:`<a class="primary" href="/auth/discord">Mit Discord anmelden</a>`; }
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
    if(tab==='friends') panel.innerHTML=friends.length?friends.map(u=>friendPerson(u,`<div class="friend-actions"><span class="favorite-mark">${u.favorite?'★':''}</span><button class="secondary small-btn" onclick="openFriendMenu(${JSON.stringify(String(u.id))})">Öffnen</button></div>`)).join(''):'<div class="empty">Noch keine Freunde. Geh zu den Mitgliedern und sende eine Anfrage. 👤＋</div>';
    if(tab==='incoming') panel.innerHTML=incoming.length?incoming.map(u=>friendPerson(u,`<div class="friend-actions"><button class="primary small-btn" onclick="acceptFriend(${u.id})">Annehmen</button><button class="secondary small-btn" onclick="declineFriend(${u.id})">Ablehnen</button></div>`)).join(''):'<div class="empty">Keine offenen Freundschaftsanfragen.</div>';
    if(tab==='sent') panel.innerHTML=sent.length?sent.map(u=>friendPerson(u,`<div class="friend-actions"><span class="pending-label">Gesendet</span><button class="secondary small-btn" onclick="cancelFriend(${u.id})">Zurückziehen</button></div>`)).join(''):'<div class="empty">Keine verschickten Anfragen.</div>';
    if(tab==='blocked') panel.innerHTML=blocked.length?blocked.map(u=>friendPerson(u,`<div class="friend-actions"><button class="secondary small-btn" onclick="unblockFriend(${JSON.stringify(String(u.id))})">Entsperren</button></div>`)).join(''):'<div class="empty">Du hast niemanden blockiert.</div>';
  }
  $$('.friend-tab').forEach(b=>b.onclick=()=>draw(b.dataset.ft)); draw('friends');
}
async function sendFriendRequest(id,button){id=String(id);
  if(button?.disabled)return;
  try{
    if(button){button.disabled=true;button.classList.add('friend-request-sent');button.title='Anfrage gesendet';}
    await api('/api/friends/request/'+id,{method:'POST'});
    await loadFriends();
    setTimeout(()=>button?.remove(),700);
    toast('Freundschaftsanfrage gesendet!');
  }catch(e){
    if(button){button.disabled=false;button.classList.remove('friend-request-sent');}
    toast('Anfrage konnte nicht gesendet werden.');
  }
}
async function acceptFriend(id){try{const target=friendsData.incoming.find(u=>u.id===String(id));const f=target;/* friendship id is not exposed in publicUser, use lookup helper below */await api('/api/friends/accept-by-user/'+id,{method:'POST'});await loadFriends();renderFriends();toast('Freundschaft angenommen!')}catch(e){toast('Anfrage konnte nicht angenommen werden.')}}
async function declineFriend(id){try{await api('/api/friends/decline-by-user/'+id,{method:'POST'});await loadFriends();renderFriends();toast('Anfrage abgelehnt.')}catch(e){toast('Anfrage konnte nicht abgelehnt werden.')}}
async function cancelFriend(id){try{await api('/api/friends/cancel-by-user/'+id,{method:'DELETE'});await loadFriends();renderFriends();toast('Anfrage zurückgezogen.')}catch(e){toast('Anfrage konnte nicht zurückgezogen werden.')}}
async function removeFriend(id){id=String(id);
  if(!confirm('Freund wirklich löschen?'))return;
  try{
    await api('/api/friends/'+encodeURIComponent(id),{method:'DELETE'});
    await loadFriends();
    renderMembers();
    renderFriends();
    toast('Freund gelöscht. Die 👤＋-Taste ist wieder verfügbar.');
  }catch(e){toast('Freund konnte nicht gelöscht werden.');}
}
async function toggleFavorite(id,current){id=String(id);
  try{
    const result=await api('/api/friends/'+encodeURIComponent(id)+'/favorite',{method:'POST',body:JSON.stringify({favorite:!current})});
    await loadFriends();
    renderFriends();
    toast(result.favorite?'Als Favorit markiert.':'Favorit entfernt.');
  }catch(e){toast('Favorit konnte nicht geändert werden.');}
}
async function blockFriend(id){id=String(id);if(!confirm('Diese Person blockieren? Freundschaft und offene Anfrage werden entfernt.'))return;try{await api('/api/friends/'+id+'/block',{method:'POST'});closeFriendMenu();await loadFriends();renderFriends();toast('Person blockiert.')}catch(e){toast('Blockieren fehlgeschlagen.')}}
async function unblockFriend(id){id=String(id);try{await api('/api/friends/'+id+'/block',{method:'DELETE'});await loadFriends();renderFriends();toast('Person entsperrt.')}catch(e){toast('Entsperren fehlgeschlagen.')}}
function openFriendMenu(id){
  const sid=String(id);
  selectedFriend=members.find(u=>sameId(u.id,sid))||friendsData.friends.find(u=>sameId(u.id,sid));
  if(!selectedFriend)return;
  const current=Boolean(friendsData.friends.find(u=>sameId(u.id,sid))?.favorite);
  let old=$('#friendActionModal');if(old)old.remove();
  const e=document.createElement('div');e.id='friendActionModal';e.className='friend-modal';
  const safeId=JSON.stringify(sid);
  e.innerHTML=`<div class="friend-modal-card">
    <button class="gate-close" onclick="closeFriendMenu()">×</button>
    <div class="friend-modal-user"><img class="avatar" src="${esc(avatar(selectedFriend))}">
      <div><h2>${esc(selectedFriend.global_name||selectedFriend.username)}</h2><span>${esc(displayRole(selectedFriend))}</span></div>
    </div>
    <div class="friend-choice-grid">
      <button class="friend-choice" onclick="closeFriendMenu();startPrivate(${safeId})"><strong>1</strong><span>✉</span><b>Privaten Chat starten</b></button>
      <button class="friend-choice" onclick="toggleFavorite(${safeId},${current});closeFriendMenu()"><strong>2</strong><span>${current?'★':'☆'}</span><b>${current?'Favorit entfernen':'Freund favorisieren'}</b></button>
      <button class="friend-choice danger" onclick="removeFriend(${safeId})"><strong>3</strong><span>🗑</span><b>Freund löschen</b></button>
      <button class="friend-choice danger" onclick="blockFriend(${safeId})"><strong>4</strong><span>⛔</span><b>Freund blockieren</b></button>
    </div>
  </div>`;
  document.body.appendChild(e);requestAnimationFrame(()=>e.classList.add('show'));
}
function closeFriendMenu(){const e=$('#friendActionModal');if(e){e.classList.remove('show');setTimeout(()=>e.remove(),180)}selectedFriend=null}
function renderPrivate(){const list=members.filter(u=>!me||!sameId(u.id,me.id));$('#page-private').innerHTML=`<div class="private-layout"><div class="card chat-list"><h3 style="padding:10px 12px">Private Chats</h3>${me?list.map(u=>`<div class="chat-person" onclick="startPrivate(${JSON.stringify(String(u.id))})"><img class="avatar" src="${esc(avatar(u))}"><div><b>${esc(u.global_name||u.username)}</b><div class="online-label"><i class="dot ${isOnline(u)?'online':''}"></i>${isOnline(u)?'Online':'Offline'}</div></div></div>`).join('')||'<div class="empty">Noch keine anderen Mitglieder.</div>':'<div class="empty">Melde dich mit Discord an, um private Chats zu nutzen.</div>'}</div><div id="privatePanel" class="card chat-shell"><div class="empty">Wähle links einen Chat aus.</div></div></div>`}
async function startPrivate(id){id=String(id);if(!me){toast('Bitte zuerst mit Discord anmelden.');return} currentPrivate=members.find(u=>sameId(u.id,id))||friendsData.friends.find(u=>sameId(u.id,id));if(!currentPrivate){toast('Mitglied nicht gefunden.');return;}go('private');renderPrivate();await openPrivate();}
async function openPrivate(){if(!currentPrivate)return;const p=$('#privatePanel');p.innerHTML=`<div class="chat-head"><h2>✉ ${esc(currentPrivate.global_name||currentPrivate.username)}</h2><small class="online-label"><i class="dot ${isOnline(currentPrivate)?'online':''}"></i>${isOnline(currentPrivate)?'Online':'Offline'}</small></div><div id="privateMessages" class="messages"></div><form id="privateForm" class="composer"><input id="privateInput" maxlength="1000" placeholder="Private Nachricht ..."><button class="primary">Senden</button></form>`;$('#privateForm').onsubmit=async e=>{
  e.preventDefault();
  const i=$('#privateInput');const text=i.value.trim();
  if(!text||!currentPrivate)return;
  const send=i.parentElement.querySelector('button'); if(send)send.disabled=true;
  try{
    await api('/api/chat/private/'+encodeURIComponent(currentPrivate.id),{method:'POST',body:JSON.stringify({message:text})});
    i.value='';
  }catch(err){toast('Private Nachricht konnte nicht gesendet werden.');}
  finally{if(send)send.disabled=false;}
};const d=await api('/api/chat/private/'+currentPrivate.id);$('#privateMessages').innerHTML=d.messages.map(messageHTML).join('');scrollPrivate();}
function scrollPrivate(){const e=$('#privateMessages');if(e)e.scrollTop=e.scrollHeight}
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
socket.on('presence',p=>{members=members.map(u=>sameId(u.id,p.userId)?{...u,last_seen:p.status==='online'?new Date().toISOString():u.last_seen}:u);renderHome();if($('.page.active')?.id==='page-members')renderMembers()});
setInterval(refreshMembers,30000);
}async function go(page,update=true){
  if(protectedPages.has(page)&&!me){showLoginGate();return}
  $$(' .page').forEach(p=>p.classList.remove('active'));$(`#page-${page}`).classList.add('active');
  $$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  if(update)$('#crumb').textContent=pages[page];
  setPageTheme(page);
  if(page==='home')renderHome();if(page==='members')renderMembers();if(page==='friends'){loadFriends().then(renderFriends)}if(page==='chat')renderChat();
  if(page==='private')renderPrivate();if(page==='leaderboard')renderLeaderboard();if(page==='settings')await renderSettings();
  if(innerWidth<761)$('.sidebar')?.classList.remove('open');
}
$$('.nav').forEach(n=>n.onclick=()=>go(n.dataset.page));$('#mobileMenu').onclick=()=>$('.sidebar').classList.toggle('open');
fetch('/api/me').then(r=>r.json()).then(async d=>{me=d.user;if(!me){renderTop();renderHome();setPageTheme('home');return}const m=await api('/api/members');members=m.members;try{friendsData=await api('/api/friends')}catch{}renderTop();renderHome();renderMembers();renderChat();renderPrivate();renderLeaderboard();renderSettings();connectSocket();setPageTheme('home');}).catch(console.error);
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