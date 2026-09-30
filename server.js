require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const { Server } = require('socket.io');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL fehlt. Bitte die Supabase/PostgreSQL-Verbindungs-URL als Environment Variable setzen.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const db = {
  async get(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || undefined;
  },
  async all(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows;
  },
  async run(sql, params = []) {
    const r = await pool.query(sql, params);
    return { rowCount: r.rowCount, lastInsertRowid: r.rows[0]?.id };
  },
  async exec(sql) { return pool.query(sql); }
};

async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      discord_in_server BOOLEAN NOT NULL DEFAULT FALSE,
      discord_roles TEXT NOT NULL DEFAULT '[]',
      last_login_reward TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'neon',
      notifications INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      requester_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      addressee_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (requester_id <> addressee_id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY,
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(blocker_id, blocked_id),
      CHECK (blocker_id <> blocked_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id, status);
    CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id, status);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);
    CREATE INDEX IF NOT EXISTS idx_users_xp ON users (xp DESC);
    CREATE INDEX IF NOT EXISTS idx_public_messages_id ON public_messages (id DESC);
    CREATE INDEX IF NOT EXISTS idx_private_messages_pair ON private_messages (sender_id, receiver_id, id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);
  `);
  console.log('Supabase/PostgreSQL-Datenbank ist bereit.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = Number(process.env.PORT || 10000);
const SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

const germanDay = () => new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const levelFromXP = xp => Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1);
const levelStartXP = level => Math.max(0, Math.pow(Math.max(1, level - 1), 2) * 100);
const levelNextXP = level => Math.pow(Math.max(1, level), 2) * 100;
const chatXPForLevel = level => 5 * Math.pow(2, Math.max(0, Number(level) - 1));

async function discordRequest(url) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const r = await fetch(`https://discord.com/api/v10${url}`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) throw new Error(`Discord API ${r.status}`);
  return r.json();
}

async function syncDiscordMember(discordId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_BOT_TOKEN) return null;
  try {
    const [member, roles] = await Promise.all([
      discordRequest(`/guilds/${guildId}/members/${discordId}`),
      discordRequest(`/guilds/${guildId}/roles`)
    ]);
    if (!member || member.notFound) return { inServer: false, roles: [] };
    const roleMap = new Map((roles || []).map(r => [r.id, r]));
    const memberRoles = (member.roles || []).map(id => {
      const r = roleMap.get(id);
      return r ? { id: r.id, name: r.name, color: r.color || 0 } : null;
    }).filter(Boolean).filter(r => r.name !== '@everyone');
    return { inServer: true, roles: memberRoles };
  } catch (e) {
    console.error('Discord-Mitglied konnte nicht geprüft werden:', e.message);
    return null;
  }
}

async function awardDailyLogin(userId) {
  const today = germanDay();
  const u = await db.get('SELECT last_login_reward FROM users WHERE id=$1', [userId]);
  if (!u || u.last_login_reward === today) return false;
  await db.run('UPDATE users SET xp=xp+25,last_login_reward=$1 WHERE id=$2', [today, userId]);
  return true;
}

const clean = s => String(s ?? '').replace(/[<>]/g, '').trim();
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const sign = value => crypto.createHmac('sha256', SECRET).update(value).digest('hex');
function issueToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;
  return { raw, expires, value: `${raw}.${sign(raw)}` };
}
async function currentUser(req) {
  const value = req.cookies?.zf_token;
  if (!value || !value.includes('.')) return null;
  const [raw, sig] = value.split('.');
  const expected = sign(raw);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const row = await db.get('SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>$2', [tokenHash(raw), Date.now()]);
  if (row) await db.run('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=$1', [row.id]);
  return row || null;
}
async function publicUser(u) {
  const roles = (() => { try { return JSON.parse(u.discord_roles || '[]'); } catch { return []; } })();
  const messageCount = (await db.get('SELECT COUNT(*)::int AS count FROM public_messages WHERE user_id=$1', [u.id])).count;
  const level = levelFromXP(u.xp);
  const start = levelStartXP(level);
  const next = levelNextXP(level);
  return {
    id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar,
    role: u.role, discord_id: u.discord_id, discord_in_server: Boolean(u.discord_in_server),
    discord_roles: roles, bio: u.bio, xp: u.xp, level, level_start_xp: start,
    level_next_xp: next, level_progress: Math.min(100, Math.max(0, ((u.xp - start) / (next - start)) * 100)),
    points: u.points, message_count: messageCount, games_played: u.games_played || 0, wins: u.wins || 0,
    last_seen: u.last_seen, created_at: u.created_at
  };
}
async function getPublicUsers(rows) { return Promise.all(rows.map(publicUser)); }
async function requireUser(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet' });
    req.user = u;
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Serverfehler' }); }
}

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (req, res) => {
  try { await db.get('SELECT 1 AS ok'); res.json({ ok: true, database: 'connected' }); }
  catch (e) { res.status(503).json({ ok: false, database: 'error' }); }
});
app.get('/api/config', (req, res) => res.json({
  discordInvite: process.env.DISCORD_INVITE_URL || '',
  discordServerCheckConfigured: Boolean(process.env.DISCORD_GUILD_ID && process.env.DISCORD_BOT_TOKEN),
  adminConfigured: Boolean(process.env.DISCORD_ADMIN_IDS)
}));
app.get('/api/me', async (req, res) => { const u = await currentUser(req); res.json({ user: u ? await publicUser(u) : null }); });
app.get('/api/members', async (req, res) => {
  const users = await db.all('SELECT * FROM users ORDER BY xp DESC, username ASC');
  res.json({ members: await getPublicUsers(users) });
});
app.get('/api/member/:id', async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id=$1', [Number(req.params.id)]);
  if (!u) return res.status(404).json({ error: 'Nicht gefunden' });
  const check = await syncDiscordMember(u.discord_id);
  if (check) {
    await db.run('UPDATE users SET discord_in_server=$1,discord_roles=$2,role=$3 WHERE id=$4', [check.inServer, JSON.stringify(check.roles), check.roles[0]?.name || (check.inServer ? 'Mitglied' : 'Nicht auf Server'), u.id]);
  }
  const fresh = await db.get('SELECT * FROM users WHERE id=$1', [u.id]);
  res.json({ member: await publicUser(fresh) });
});
app.get('/api/account', requireUser, async (req, res) => {
  const check = await syncDiscordMember(req.user.discord_id);
  if (check) {
    await db.run('UPDATE users SET discord_in_server=$1,discord_roles=$2,role=$3 WHERE id=$4', [check.inServer, JSON.stringify(check.roles), check.roles[0]?.name || (check.inServer ? 'Mitglied' : 'Nicht auf Server'), req.user.id]);
  }
  const u = await db.get('SELECT * FROM users WHERE id=$1', [req.user.id]);
  res.json({ account: await publicUser(u), discordCheckConfigured: Boolean(process.env.DISCORD_GUILD_ID && process.env.DISCORD_BOT_TOKEN) });
});
app.get('/api/leaderboard', async (req, res) => {
  const users = await db.all('SELECT * FROM users ORDER BY xp DESC, username ASC LIMIT 100');
  res.json({ members: await getPublicUsers(users) });
});
app.get('/api/chat/public', async (req, res) => {
  const rows = await db.all(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM public_messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 80`);
  res.json({ messages: rows.reverse() });
});
app.delete('/api/chat/public', requireAdmin, async (req, res) => {
  try {
    await db.exec('DELETE FROM public_messages');
    io.emit('public_chat_cleared');
    res.json({ ok: true });
  } catch (e) {
    console.error('public_chat_clear:', e.message);
    res.status(500).json({ error: 'Chat konnte nicht geleert werden.' });
  }
});

app.get('/api/chat/private/:id', requireUser, async (req, res) => {
  const other = Number(req.params.id);
  const rows = await db.all(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$3 AND receiver_id=$4) ORDER BY m.id ASC LIMIT 200`, [req.user.id, other, other, req.user.id]);
  res.json({ messages: rows });
});

async function friendPublicUser(id) {
  const u = await db.get('SELECT * FROM users WHERE id=$1', [id]);
  return u ? await publicUser(u) : null;
}
async function relationshipBetween(a, b) {
  return await db.get(`SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1) ORDER BY id DESC LIMIT 1`, [a,b]);
}
async function isBlockedEitherWay(a,b) {
  return Boolean(await db.get('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1',[a,b]));
}

app.get('/api/friends', requireUser, async (req, res) => {
  const id = req.user.id;
  const friends = await db.all(`
    SELECT u.*, f.id AS friendship_id,
      CASE WHEN f.requester_id=$1 THEN f.requester_favorite ELSE f.addressee_favorite END AS favorite
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status='accepted' AND (f.requester_id=$1 OR f.addressee_id=$1)
    ORDER BY favorite DESC, LOWER(COALESCE(u.global_name,u.username)) ASC`, [id]);
  const sent = await db.all(`SELECT u.*,f.id AS friendship_id,f.created_at FROM friendships f JOIN users u ON u.id=f.addressee_id WHERE f.requester_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`, [id]);
  const incoming = await db.all(`SELECT u.*,f.id AS friendship_id,f.created_at FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`, [id]);
  const blocked = await db.all(`SELECT u.*,b.id AS block_id,b.created_at FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`, [id]);
  res.json({
    friends: await Promise.all(friends.map(async u => ({...(await publicUser(u)), favorite:Boolean(u.favorite), friendship_id:u.friendship_id}))),
    sent: await getPublicUsers(sent), incoming: await getPublicUsers(incoming), blocked: await getPublicUsers(blocked)
  });
});

app.post('/api/friends/request/:id', requireUser, async (req,res) => {
  const targetId=Number(req.params.id), meId=req.user.id;
  if(!Number.isInteger(targetId) || targetId===meId) return res.status(400).json({error:'Ungültiger Freund'});
  if(!await db.get('SELECT id FROM users WHERE id=$1',[targetId])) return res.status(404).json({error:'Mitglied nicht gefunden'});
  if(await isBlockedEitherWay(meId,targetId)) return res.status(403).json({error:'Freundschaftsanfrage nicht möglich.'});
  const rel=await relationshipBetween(meId,targetId);
  if(rel && rel.status==='accepted') return res.status(409).json({error:'Ihr seid bereits Freunde.'});
  if(rel && rel.status==='pending') return res.status(409).json({error:rel.requester_id===meId?'Anfrage bereits gesendet.':'Diese Person hat dir bereits eine Anfrage gesendet.'});
  if(rel) await db.run('DELETE FROM friendships WHERE id=$1',[rel.id]);
  await db.run('INSERT INTO friendships(requester_id,addressee_id,status) VALUES($1,$2,\'pending\')',[meId,targetId]);
  res.json({ok:true});
});

app.post('/api/friends/:id/accept', requireUser, async (req,res) => {
  const friendshipId=Number(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  if(await isBlockedEitherWay(req.user.id,f.requester_id)) return res.status(403).json({error:'Diese Freundschaft ist blockiert.'});
  await db.run('UPDATE friendships SET status=\'accepted\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.post('/api/friends/accept-by-user/:id', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[targetId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'accepted\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[f.id]);
  res.json({ok:true});
});
app.post('/api/friends/decline-by-user/:id', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[targetId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'declined\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[f.id]);
  res.json({ok:true});
});
app.delete('/api/friends/cancel-by-user/:id', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  const f=await db.get(`SELECT id FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Gesendete Anfrage nicht gefunden'});
  await db.run('DELETE FROM friendships WHERE id=$1',[f.id]);
  res.json({ok:true});
});

app.delete('/api/friends/:id/request', requireUser, async (req,res) => {
  const friendshipId=Number(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND requester_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Gesendete Anfrage nicht gefunden'});
  await db.run('DELETE FROM friendships WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.post('/api/friends/:id/decline', requireUser, async (req,res) => {
  const friendshipId=Number(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'declined\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.delete('/api/friends/:id', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  const f=await db.get(`SELECT id FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Freundschaft nicht gefunden'});
  await db.run('DELETE FROM friendships WHERE id=$1',[f.id]);
  res.json({ok:true});
});

app.post('/api/friends/:id/favorite', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Freundschaft nicht gefunden'});
  const column=Number(f.requester_id)===Number(req.user.id)?'requester_favorite':'addressee_favorite';
  const value=req.body.favorite!==false;
  await db.run(`UPDATE friendships SET ${column}=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[value,f.id]);
  res.json({ok:true,favorite:value});
});

app.post('/api/friends/:id/block', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  if(!Number.isInteger(targetId)||targetId===req.user.id) return res.status(400).json({error:'Ungültiger Benutzer'});
  await db.run('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT(blocker_id,blocked_id) DO NOTHING',[req.user.id,targetId]);
  await db.run(`DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,[req.user.id,targetId]);
  res.json({ok:true});
});

app.delete('/api/friends/:id/block', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  await db.run('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[req.user.id,targetId]);
  res.json({ok:true});
});

function adminIds() {
  return String(process.env.DISCORD_ADMIN_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}
async function requireAdmin(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet' });
    if (!adminIds().includes(String(u.discord_id))) {
      return res.status(403).json({ error: 'Keine Admin-Berechtigung' });
    }
    req.user = u;
    next();
  } catch (e) {
    console.error('Admin-Prüfung:', e);
    res.status(500).json({ error: 'Serverfehler' });
  }
}

app.get('/api/admin/status', requireUser, async (req, res) => {
  res.json({ isAdmin: adminIds().includes(String(req.user.discord_id)) });
});

app.get('/api/admin/discord-roles', requireAdmin, async (req, res) => {
  const roles = await discordRequest(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`);
  if (!roles || !Array.isArray(roles)) return res.status(503).json({ error: 'Discord-Rollen konnten nicht geladen werden.' });
  res.json({
    roles: roles
      .filter(r => r.name !== '@everyone')
      .sort((a,b) => (b.position || 0) - (a.position || 0))
      .map(r => ({ id: r.id, name: r.name, color: r.color || 0, position: r.position || 0 }))
  });
});

app.post('/api/admin/member/:id', requireAdmin, async (req, res) => {
  const memberId = Number(req.params.id);
  if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Ungültige Mitglied-ID' });

  const target = await db.get('SELECT * FROM users WHERE id=$1', [memberId]);
  if (!target) return res.status(404).json({ error: 'Mitglied nicht gefunden' });

  let changed = [];
  if (req.body.level !== undefined && req.body.level !== '') {
    const level = Math.max(1, Math.min(1000, Math.floor(Number(req.body.level))));
    if (!Number.isFinite(level)) return res.status(400).json({ error: 'Ungültiges Level' });
    const xp = levelStartXP(level);
    await db.run('UPDATE users SET xp=$1 WHERE id=$2', [xp, memberId]);
    changed.push(`Level ${level}`);
  } else if (req.body.xp !== undefined) {
    const xp = Math.max(0, Math.min(1000000000, Math.floor(Number(req.body.xp))));
    if (!Number.isFinite(xp)) return res.status(400).json({ error: 'Ungültige XP' });
    await db.run('UPDATE users SET xp=$1 WHERE id=$2', [xp, memberId]);
    changed.push(`${xp} XP`);
  }

  // Optional: assign a real Discord role through the bot.
  if (req.body.roleId && process.env.DISCORD_GUILD_ID && process.env.DISCORD_BOT_TOKEN) {
    const role = await discordRequest(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`);
    const wanted = Array.isArray(role) ? role.find(r => r.id === String(req.body.roleId)) : null;
    if (!wanted || wanted.name === '@everyone') return res.status(400).json({ error: 'Ungültige Discord-Rolle' });

    const url = `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${target.discord_id}/roles/${wanted.id}`;
    const rr = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });
    if (!rr.ok) return res.status(502).json({ error: `Discord-Rolle konnte nicht gesetzt werden (${rr.status}).` });
    changed.push(`Rolle ${wanted.name}`);

    const check = await syncDiscordMember(target.discord_id);
    if (check) {
      await db.run(
        'UPDATE users SET discord_in_server=$1,discord_roles=$2,role=$3 WHERE id=$4',
        [check.inServer, JSON.stringify(check.roles), check.roles[0]?.name || (check.inServer ? 'Mitglied' : 'Nicht auf Server'), memberId]
      );
    }
  }

  const fresh = await db.get('SELECT * FROM users WHERE id=$1', [memberId]);
  res.json({ ok: true, changed, member: await publicUser(fresh) });
});

app.get('/api/settings', requireUser, async (req, res) => {
  let s = await db.get('SELECT * FROM settings WHERE user_id=$1', [req.user.id]);
  if (!s) { await db.run('INSERT INTO settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [req.user.id]); s = await db.get('SELECT * FROM settings WHERE user_id=$1', [req.user.id]); }
  res.json({ settings: s });
});
app.post('/api/settings', requireUser, async (req, res) => {
  const theme = ['dark', 'light', 'neon'].includes(req.body.theme) ? req.body.theme : 'neon';
  const notifications = req.body.notifications === false ? 0 : 1;
  await db.run(`INSERT INTO settings(user_id,theme,notifications) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET theme=EXCLUDED.theme,notifications=EXCLUDED.notifications`, [req.user.id, theme, notifications]);
  res.json({ ok: true });
});
app.post('/api/profile', requireUser, async (req, res) => {
  const bio = clean(req.body.bio).slice(0, 240);
  await db.run('UPDATE users SET bio=$1 WHERE id=$2', [bio, req.user.id]);
  res.json({ ok: true });
});

app.get('/auth/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(500).send('Discord OAuth ist noch nicht konfiguriert.');
  const state = crypto.randomBytes(20).toString('hex');
  res.cookie('zf_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify', state });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.cookies.zf_oauth_state) return res.status(400).send('Ungültige Discord-Anmeldung.');
    const body = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.DISCORD_REDIRECT_URI });
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!tokenRes.ok) throw new Error('Token request failed');
    const token = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userRes.ok) throw new Error('User request failed');
    const d = await userRes.json();
    const avatar = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=256` : `https://cdn.discordapp.com/embed/avatars/${Number(d.discriminator || 0) % 5}.png`;
    let u = await db.get('SELECT * FROM users WHERE discord_id=$1', [d.id]);
    if (!u) {
      const info = await db.get('INSERT INTO users(discord_id,username,global_name,avatar) VALUES($1,$2,$3,$4) RETURNING id', [d.id, d.username, d.global_name || d.username, avatar]);
      u = await db.get('SELECT * FROM users WHERE id=$1', [info.id]);
    } else {
      await db.run('UPDATE users SET username=$1,global_name=$2,avatar=$3,last_seen=CURRENT_TIMESTAMP WHERE id=$4', [d.username, d.global_name || d.username, avatar, u.id]);
      u = await db.get('SELECT * FROM users WHERE id=$1', [u.id]);
    }
    const discordMember = await syncDiscordMember(d.id);
    if (discordMember) await db.run('UPDATE users SET discord_in_server=$1,discord_roles=$2,role=$3 WHERE id=$4', [discordMember.inServer, JSON.stringify(discordMember.roles), discordMember.roles[0]?.name || (discordMember.inServer ? 'Mitglied' : 'Nicht auf Server'), u.id]);
    await awardDailyLogin(u.id);
    u = await db.get('SELECT * FROM users WHERE id=$1', [u.id]);
    const tokenValue = issueToken(u.id);
    await db.run('INSERT INTO auth_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [tokenHash(tokenValue.raw), u.id, tokenValue.expires]);
    await db.run('DELETE FROM auth_tokens WHERE expires_at <= $1', [Date.now()]);
    res.cookie('zf_token', tokenValue.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.clearCookie('zf_oauth_state');
    res.redirect('/');
  } catch (e) { console.error(e); res.status(500).send('Discord-Anmeldung fehlgeschlagen. Bitte Client-ID, Secret und Redirect-URI prüfen.'); }
});
app.post('/auth/logout', async (req, res) => {
  const v = req.cookies?.zf_token;
  if (v) { const raw = v.split('.')[0]; await db.run('DELETE FROM auth_tokens WHERE token_hash=$1', [tokenHash(raw)]); }
  res.clearCookie('zf_token'); res.json({ ok: true });
});

io.use(async (socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie || '';
    const match = cookie.match(/(?:^|; )zf_token=([^;]+)/);
    if (!match) return next();
    const value = decodeURIComponent(match[1]);
    if (!value.includes('.')) return next();
    const [raw, sig] = value.split('.');
    if (sig !== sign(raw)) return next();
    const u = await db.get('SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>$2', [tokenHash(raw), Date.now()]);
    if (u) socket.user = await publicUser(u);
  } catch (e) { console.error('Socket-Authentifizierung:', e.message); }
  next();
});

const online = new Map();
io.on('connection', socket => {
  if (socket.user) { online.set(socket.user.id, (online.get(socket.user.id) || 0) + 1); db.run('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=$1',[socket.user.id]).catch(()=>{}); io.emit('presence', { userId: socket.user.id, status: 'online' }); }
  socket.on('public_message', async data => {
    try {
      if (!socket.user) return;
      const message = clean(data?.message).slice(0, 1000); if (!message) return;
      const info = await db.get('INSERT INTO public_messages(user_id,message) VALUES($1,$2) RETURNING id', [socket.user.id, message]);
      const row = await db.get(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM public_messages m JOIN users u ON u.id=m.user_id WHERE m.id=$1`, [info.id]);
      const current = await db.get('SELECT xp FROM users WHERE id=$1', [socket.user.id]);
      const currentLevel = levelFromXP(current?.xp || 0);
      const xpGain = chatXPForLevel(currentLevel);
      await db.run('UPDATE users SET xp=xp+$1,points=points+1,last_seen=CURRENT_TIMESTAMP WHERE id=$2', [xpGain, socket.user.id]);
      row.xp_gain = xpGain;
      io.emit('public_message', row);
    } catch (e) { console.error('public_message:', e.message); }
  });
  socket.on('private_message', async data => {
    try {
      if (!socket.user) return;
      const receiverId = Number(data?.receiverId); const message = clean(data?.message).slice(0, 1000);
      if (!receiverId || !message || receiverId === socket.user.id) return;
      const target = await db.get('SELECT id FROM users WHERE id=$1', [receiverId]); if (!target) return;
      const info = await db.get('INSERT INTO private_messages(sender_id,receiver_id,message) VALUES($1,$2,$3) RETURNING id', [socket.user.id, receiverId, message]);
      const row = await db.get(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1`, [info.id]);
      for (const [, s] of io.sockets.sockets) if (s?.user?.id === receiverId || s?.user?.id === socket.user.id) s.emit('private_message', row);
    } catch (e) { console.error('private_message:', e.message); }
  });
  socket.on('disconnect', () => {
    if (socket.user) { const n = (online.get(socket.user.id) || 1) - 1; if (n <= 0) { online.delete(socket.user.id); io.emit('presence', { userId: socket.user.id, status: 'offline' }); } else online.set(socket.user.id, n); }
  });
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDatabase()
  .then(() => server.listen(PORT, '0.0.0.0', () => console.log(`Zockerfreunde läuft auf Port ${PORT}`)))
  .catch(err => { console.error('Datenbank konnte nicht initialisiert werden:', err); process.exit(1); });

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
