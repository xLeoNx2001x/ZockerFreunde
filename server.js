require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "zockerfreunde.db"));
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = Number(process.env.PORT || 10000);
const SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 discord_id TEXT UNIQUE NOT NULL,
 username TEXT NOT NULL,
 global_name TEXT,
 avatar TEXT,
 role TEXT NOT NULL DEFAULT 'Mitglied',
 bio TEXT NOT NULL DEFAULT '',
 xp INTEGER NOT NULL DEFAULT 0,
 points INTEGER NOT NULL DEFAULT 0,
 games_played INTEGER NOT NULL DEFAULT 0,
 wins INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS public_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS private_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
 user_id INTEGER PRIMARY KEY,
 theme TEXT NOT NULL DEFAULT 'neon',
 notifications INTEGER NOT NULL DEFAULT 1
);
`);

const clean = s => String(s ?? '').replace(/[<>]/g, '').trim();
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const sign = value => crypto.createHmac('sha256', SECRET).update(value).digest('hex');
function issueToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;
  db.prepare('INSERT INTO auth_tokens(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(raw), userId, expires);
  return `${raw}.${sign(raw)}`;
}
function currentUser(req) {
  const value = req.cookies?.zf_token;
  if (!value || !value.includes('.')) return null;
  const [raw, sig] = value.split('.');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(raw)))) return null;
  const row = db.prepare('SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?').get(tokenHash(raw), Date.now());
  if (row) db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
  return row || null;
}
function publicUser(u) {
  return { id:u.id, username:u.username, global_name:u.global_name, avatar:u.avatar, role:u.role, bio:u.bio, xp:u.xp, points:u.points, games_played:u.games_played, wins:u.wins, last_seen:u.last_seen, created_at:u.created_at };
}
function requireUser(req,res,next){ const u=currentUser(req); if(!u) return res.status(401).json({error:'Nicht angemeldet'}); req.user=u; next(); }

app.use(express.json({limit:'64kb'}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,'public')));

app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/api/config',(req,res)=>res.json({discordInvite:process.env.DISCORD_INVITE_URL||''}));
app.get('/api/me', (req,res)=>{ const u=currentUser(req); res.json({user:u?publicUser(u):null}); });
app.get('/api/members', (req,res)=>{
  const users = db.prepare('SELECT * FROM users ORDER BY points DESC, xp DESC, username COLLATE NOCASE ASC').all();
  res.json({members:users.map(publicUser)});
});
app.get('/api/member/:id',(req,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if(!u) return res.status(404).json({error:'Nicht gefunden'});
  res.json({member:publicUser(u)});
});
app.get('/api/leaderboard',(req,res)=>{
  const users=db.prepare('SELECT * FROM users ORDER BY points DESC, xp DESC LIMIT 100').all();
  res.json({members:users.map(publicUser)});
});
app.get('/api/chat/public',(req,res)=>{
  const rows=db.prepare(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM public_messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 80`).all().reverse();
  res.json({messages:rows});
});
app.get('/api/chat/private/:id',requireUser,(req,res)=>{
  const other=Number(req.params.id);
  const rows=db.prepare(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY m.id ASC LIMIT 200`).all(req.user.id,other,other,req.user.id);
  res.json({messages:rows});
});
app.get('/api/settings',requireUser,(req,res)=>{
  let s=db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id);
  if(!s){db.prepare('INSERT INTO settings(user_id) VALUES(?)').run(req.user.id);s=db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id);}
  res.json({settings:s});
});
app.post('/api/settings',requireUser,(req,res)=>{
  const theme=['dark','light','neon'].includes(req.body.theme)?req.body.theme:'neon';
  const notifications=req.body.notifications===false?0:1;
  db.prepare(`INSERT INTO settings(user_id,theme,notifications) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,notifications=excluded.notifications`).run(req.user.id,theme,notifications);
  res.json({ok:true});
});
app.post('/api/profile',requireUser,(req,res)=>{
  const bio=clean(req.body.bio).slice(0,240);
  db.prepare('UPDATE users SET bio=? WHERE id=?').run(bio,req.user.id);
  res.json({ok:true});
});

app.get('/auth/discord', (req,res)=>{
  if(!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(500).send('Discord OAuth ist noch nicht konfiguriert.');
  const state=crypto.randomBytes(20).toString('hex');
  res.cookie('zf_oauth_state', state, {httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:10*60*1000});
  const params=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:process.env.DISCORD_REDIRECT_URI,scope:'identify',state});
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get('/auth/discord/callback', async (req,res)=>{
  try{
    if(!req.query.code || !req.query.state || req.query.state!==req.cookies.zf_oauth_state) return res.status(400).send('Ungültige Discord-Anmeldung.');
    const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:process.env.DISCORD_REDIRECT_URI});
    const tokenRes=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    if(!tokenRes.ok) throw new Error('Token request failed');
    const token=await tokenRes.json();
    const userRes=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`}});
    if(!userRes.ok) throw new Error('User request failed');
    const d=await userRes.json();
    const avatar=d.avatar?`https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=256`:`https://cdn.discordapp.com/embed/avatars/${Number(d.discriminator||0)%5}.png`;
    let u=db.prepare('SELECT * FROM users WHERE discord_id=?').get(d.id);
    if(!u){
      const info=db.prepare('INSERT INTO users(discord_id,username,global_name,avatar) VALUES(?,?,?,?)').run(d.id,d.username,d.global_name||d.username,avatar);
      u=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET username=?,global_name=?,avatar=?,last_seen=CURRENT_TIMESTAMP WHERE id=?').run(d.username,d.global_name||d.username,avatar,u.id);
      u=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    }
    const tokenValue=issueToken(u.id);
    res.cookie('zf_token',tokenValue,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:30*24*60*60*1000});
    res.clearCookie('zf_oauth_state');
    res.redirect('/');
  }catch(e){console.error(e);res.status(500).send('Discord-Anmeldung fehlgeschlagen. Bitte Client-ID, Secret und Redirect-URI prüfen.');}
});
app.post('/auth/logout',(req,res)=>{ const v=req.cookies?.zf_token; if(v){const raw=v.split('.')[0];db.prepare('DELETE FROM auth_tokens WHERE token_hash=?').run(tokenHash(raw));} res.clearCookie('zf_token');res.json({ok:true}); });

io.use((socket,next)=>{ try{ const cookie=socket.handshake.headers.cookie||''; const match=cookie.match(/(?:^|; )zf_token=([^;]+)/); if(!match)return next(); const value=decodeURIComponent(match[1]); if(!value.includes('.'))return next(); const [raw,sig]=value.split('.'); if(sig!==sign(raw))return next(); const u=db.prepare('SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?').get(tokenHash(raw),Date.now()); if(u) socket.user=publicUser(u); }catch{} next(); });
const online=new Map();
io.on('connection',socket=>{
  if(socket.user){ online.set(socket.user.id,(online.get(socket.user.id)||0)+1); io.emit('presence',{userId:socket.user.id,status:'online'}); }
  socket.on('public_message',data=>{
    if(!socket.user)return;
    const message=clean(data?.message).slice(0,1000); if(!message)return;
    const info=db.prepare('INSERT INTO public_messages(user_id,message) VALUES(?,?)').run(socket.user.id,message);
    const row=db.prepare(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM public_messages m JOIN users u ON u.id=m.user_id WHERE m.id=?`).get(info.lastInsertRowid);
    db.prepare('UPDATE users SET xp=xp+2,points=points+1,last_seen=CURRENT_TIMESTAMP WHERE id=?').run(socket.user.id);
    io.emit('public_message',row);
  });
  socket.on('private_message',data=>{
    if(!socket.user)return;
    const receiverId=Number(data?.receiverId); const message=clean(data?.message).slice(0,1000);
    if(!receiverId||!message||receiverId===socket.user.id)return;
    const target=db.prepare('SELECT id FROM users WHERE id=?').get(receiverId); if(!target)return;
    const info=db.prepare('INSERT INTO private_messages(sender_id,receiver_id,message) VALUES(?,?,?)').run(socket.user.id,receiverId,message);
    const row=db.prepare(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(info.lastInsertRowid);
    for(const [sid] of io.sockets.sockets){const s=io.sockets.sockets.get(sid);if(s?.user?.id===receiverId||s?.user?.id===socket.user.id)s.emit('private_message',row);}
  });
  socket.on('game_score',data=>{
    if(!socket.user)return;
    const points=Math.max(0,Math.min(100,Number(data?.points)||0));
    db.prepare('UPDATE users SET games_played=games_played+1, xp=xp+?, points=points+?, wins=wins+? WHERE id=?').run(Math.floor(points/2),points,points>=50?1:0,socket.user.id);
    socket.emit('game_score_saved',{points});
  });
  socket.on('disconnect',()=>{if(socket.user){const n=(online.get(socket.user.id)||1)-1;if(n<=0){online.delete(socket.user.id);io.emit('presence',{userId:socket.user.id,status:'offline'});}else online.set(socket.user.id,n);}});
});

app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,'0.0.0.0',()=>console.log(`Zockerfreunde läuft auf Port ${PORT}`));