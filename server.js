const express=require('express');
const session=require('express-session');
const Database=require('better-sqlite3');
const crypto=require('crypto');
const path=require('path');
const app=express();
const port=Number(process.env.PORT||3000);
const db=new Database(path.join(__dirname,'data.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL,global_name TEXT,avatar TEXT,created_at TEXT NOT NULL)`);
app.set('trust proxy',1);
app.use(express.json());
app.use(session({name:'zf_session',secret:process.env.SESSION_SECRET||'dev-only-change-me',resave:false,saveUninitialized:false,proxy:true,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*24*30}}));
app.use(express.static(path.join(__dirname,'public')));
function configured(){return process.env.DISCORD_CLIENT_ID&&process.env.DISCORD_CLIENT_SECRET&&process.env.DISCORD_REDIRECT_URI}
app.get('/api/me',(req,res)=>res.json({authenticated:!!req.session.user,user:req.session.user||null}));
app.get('/auth/discord',(req,res)=>{
 if(!configured()) return res.status(503).send('Discord OAuth ist noch nicht konfiguriert.');
 const state=crypto.randomBytes(32).toString('hex'); req.session.oauthState=state;
 req.session.save(()=>{const p=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:process.env.DISCORD_REDIRECT_URI,scope:'identify',state});res.redirect('https://discord.com/oauth2/authorize?'+p)});
});
app.get('/auth/discord/callback',async(req,res)=>{
 try{
  if(!req.query.code||!req.query.state||req.query.state!==req.session.oauthState)return res.status(400).send('Autorisierung ungültig oder abgelaufen.');
  delete req.session.oauthState;
  const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:process.env.DISCORD_REDIRECT_URI});
  const tr=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if(!tr.ok)throw new Error('Token request failed'); const token=await tr.json();
  const ur=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:`${token.token_type} ${token.access_token}`}});
  if(!ur.ok)throw new Error('User request failed'); const u=await ur.json();
  db.prepare(`INSERT INTO users(id,username,global_name,avatar,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,global_name=excluded.global_name,avatar=excluded.avatar`).run(u.id,u.username,u.global_name||u.username,u.avatar||'',new Date().toISOString());
  req.session.user={id:u.id,username:u.username,global_name:u.global_name||u.username,avatar:u.avatar||''};
  req.session.save(()=>res.redirect('/'));
 }catch(e){console.error(e);res.status(500).send('Discord-Anmeldung fehlgeschlagen.');}
});
app.post('/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('zf_session');res.json({ok:true})}));
app.get('/api/members',(req,res)=>res.json(db.prepare('SELECT id,username,global_name,avatar FROM users ORDER BY COALESCE(global_name,username) COLLATE NOCASE').all()));
app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(port,()=>console.log(`Zockerfreunde läuft auf Port ${port}`));
