require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const compression = require('compression');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL fehlt. Bitte die Supabase/PostgreSQL-Verbindungs-URL als Environment Variable setzen.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  maxUses: 7500,
  allowExitOnIdle: true
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
      discord_guilds TEXT NOT NULL DEFAULT '[]',
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
    CREATE TABLE IF NOT EXISTS community_servers (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS community_server_members (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS community_channels (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','voice')),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS community_messages (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TIMESTAMPTZ,
      pinned BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS community_message_reactions (
      id BIGSERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id,user_id,emoji)
    );
    CREATE TABLE IF NOT EXISTS community_invites (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uses INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS friend_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      other_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      removed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, other_user_id),
      CHECK(user_id <> other_user_id)
    );
    CREATE TABLE IF NOT EXISTS community_sections (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(server_id,name)
    );
    CREATE TABLE IF NOT EXISTS community_roles (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8b93ad',
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(server_id,name)
    );
    CREATE TABLE IF NOT EXISTS community_attachments (
      id BIGSERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS community_poll_votes (
      id BIGSERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id,user_id,option_index)
    );
    ALTER TABLE community_channels ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES community_sections(id) ON DELETE SET NULL;
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_community_servers_discoverable ON community_servers (discoverable, created_at DESC);
    ALTER TABLE community_server_members ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES community_roles(id) ON DELETE SET NULL;
    ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS poll_data JSONB;
    CREATE INDEX IF NOT EXISTS idx_community_server_members_user ON community_server_members (user_id, server_id);
    CREATE INDEX IF NOT EXISTS idx_community_channels_server ON community_channels (server_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_community_messages_channel ON community_messages (channel_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_community_invites_code ON community_invites (code);
    CREATE INDEX IF NOT EXISTS idx_friend_history_user ON friend_history (user_id, other_user_id);
    CREATE INDEX IF NOT EXISTS idx_community_sections_server ON community_sections (server_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_community_roles_server ON community_roles (server_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_community_attachments_message ON community_attachments (message_id, id);
    CREATE INDEX IF NOT EXISTS idx_community_poll_votes_message ON community_poll_votes (message_id, option_index);
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_guilds TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '';
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS chat_bg TEXT NOT NULL DEFAULT '#0b1020';
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS chat_text TEXT NOT NULL DEFAULT '#f4f7ff';
    ALTER TABLE community_servers ADD COLUMN IF NOT EXISTS chat_bubble TEXT NOT NULL DEFAULT '#171e33';
    ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
    ALTER TABLE community_messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, id DESC);
    CREATE INDEX IF NOT EXISTS idx_community_reactions_message ON community_message_reactions (message_id, emoji);
  `);
  console.log('Supabase/PostgreSQL-Datenbank ist bereit.');
}

const app = express();
const chatCooldowns = new Map();
const CHAT_COOLDOWN_MS = 5000;
function enforceChatCooldown(userId) {
  const key = String(userId);
  const now = Date.now();
  const last = chatCooldowns.get(key) || 0;
  const remaining = CHAT_COOLDOWN_MS - (now - last);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  chatCooldowns.set(key, now);
  if (chatCooldowns.size > 5000) {
    for (const [id, stamp] of chatCooldowns) if (now - stamp > CHAT_COOLDOWN_MS * 2) chatCooldowns.delete(id);
  }
  return 0;
}

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
async function publicUser(u, messageCountOverride = null) {
  const roles = (() => { try { return JSON.parse(u.discord_roles || '[]'); } catch { return []; } })();
  const messageCount = messageCountOverride == null ? (await db.get('SELECT COUNT(*)::int AS count FROM public_messages WHERE user_id=$1', [u.id])).count : Number(messageCountOverride);
  const level = levelFromXP(u.xp);
  const start = levelStartXP(level);
  const next = levelNextXP(level);
  return {
    id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar,
    role: u.role, discord_id: u.discord_id, discord_in_server: Boolean(u.discord_in_server),
    discord_roles: roles, bio: u.bio, xp: u.xp, level, level_start_xp: start,
    level_next_xp: next, level_progress: Math.min(100, Math.max(0, ((u.xp - start) / (next - start)) * 100)),
    points: u.points, message_count: messageCount, games_played: u.games_played || 0, wins: u.wins || 0,
    last_seen: u.last_seen, created_at: u.created_at,
    community_role_name: u.community_role_name || '',
    community_role_color: u.community_role_color || '',
    membership_role: u.membership_role || 'member'
  };
}
async function getPublicUsers(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => Number(r.id));
  const counts = await db.all('SELECT user_id,COUNT(*)::int AS count FROM public_messages WHERE user_id = ANY($1::int[]) GROUP BY user_id', [ids]);
  const map = new Map(counts.map(r => [Number(r.user_id), Number(r.count)]));
  return Promise.all(rows.map(u => publicUser(u, map.get(Number(u.id)) || 0)));
}
async function requireUser(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet' });
    req.user = u;
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Serverfehler' }); }
}

app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(compression({ threshold: 1024, level: 6 }));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  immutable: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.webp') || filePath.endsWith('.svg') || filePath.endsWith('.ico')) {
      if (path.extname(filePath).toLowerCase() === '.html') res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      else res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  }
}));

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
  if (!Number.isInteger(other) || other <= 0 || other === Number(req.user.id)) return res.status(400).json({error:'Ungültiger Chat.'});
  if (!(await isPrivateChatAllowed(req.user.id, other))) return res.status(403).json({error:'Private Chats sind nur mit Freunden oder alten Freunden möglich.'});
  const rows = await db.all(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$3 AND receiver_id=$4) ORDER BY m.id ASC LIMIT 200`, [req.user.id, other, other, req.user.id]);
  res.json({ messages: rows });
});

app.post('/api/chat/private/:id', requireUser, async (req, res) => {
  const cooldown = enforceChatCooldown(req.user.id);
  if (cooldown) return res.status(429).json({error:`Bitte warte noch ${cooldown} Sekunden.`,retryAfter:cooldown});
  const receiverId = String(req.params.id);
  const message = clean(req.body?.message).slice(0, 1000);
  if (!/^\d+$/.test(receiverId) || receiverId === String(req.user.id)) {
    return res.status(400).json({error:'Ungültiger Empfänger'});
  }
  if (!message) return res.status(400).json({error:'Nachricht darf nicht leer sein.'});
  const target = await db.get('SELECT id FROM users WHERE id=$1',[receiverId]);
  if (!target) return res.status(404).json({error:'Mitglied nicht gefunden'});
  if (!(await isPrivateChatAllowed(req.user.id, Number(receiverId)))) return res.status(403).json({error:'Private Chats sind nur mit Freunden oder alten Freunden möglich.'});
  const info = await db.get(
    'INSERT INTO private_messages(sender_id,receiver_id,message) VALUES($1,$2,$3) RETURNING id',
    [req.user.id, receiverId, message]
  );
  const row = await db.get(
    `SELECT m.*,u.username,u.global_name,u.avatar,u.role
     FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1`,
    [info.id]
  );
  io.sockets.sockets.forEach(s => {
    if (s?.user && (Number(s.user.id) === Number(receiverId) || String(s.user.id) === String(req.user.id))) {
      s.emit('private_message', row);
    }
  });
  await notifyUser(Number(receiverId),'message','Neue private Nachricht',`${req.user.global_name||req.user.username} hat dir geschrieben.`,'private');
  res.json({ok:true,message:row});
});

async function notifyUser(userId, type, title, body='', link='') {
  try {
    const n=await db.get('INSERT INTO notifications(user_id,type,title,body,link) VALUES($1,$2,$3,$4,$5) RETURNING id,type,title,body,link,read,created_at',[userId,type,title,body,link]);
    io.sockets.sockets.forEach(s=>{if(s?.user&&Number(s.user.id)===Number(userId))s.emit('notification',n);});
  } catch(e) { console.warn('notification:',e.message); }
}

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

async function isPrivateChatAllowed(a,b) {
  const rel = await relationshipBetween(a,b);
  if (rel?.status === 'accepted') return true;
  return Boolean(await db.get('SELECT 1 FROM friend_history WHERE (user_id=$1 AND other_user_id=$2) OR (user_id=$2 AND other_user_id=$1) LIMIT 1',[a,b]));
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

app.get('/api/notifications', requireUser, async (req,res)=>{
  const rows=await db.all('SELECT id,type,title,body,link,read,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 40',[req.user.id]);
  const unread=await db.get('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read=FALSE',[req.user.id]);
  res.json({notifications:rows,unread:Number(unread?.count||0)});
});
app.post('/api/notifications/read', requireUser, async (req,res)=>{
  if(req.body?.id) await db.run('UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2',[Number(req.body.id),req.user.id]);
  else await db.run('UPDATE notifications SET read=TRUE WHERE user_id=$1',[req.user.id]);
  res.json({ok:true});
});
app.get('/api/search', requireUser, async (req,res)=>{
  const q=clean(req.query?.q||'').trim().slice(0,80);
  if(q.length<2)return res.json({members:[],messages:[]});
  const like=`%${q}%`;
  const people=await db.all('SELECT id,username,global_name,avatar,role FROM users WHERE LOWER(COALESCE(global_name,username)) LIKE LOWER($1) OR LOWER(username) LIKE LOWER($1) ORDER BY LOWER(COALESCE(global_name,username)) LIMIT 8',[like]);
  const messages=await db.all(`SELECT m.id,m.message,m.created_at,m.channel_id,c.name AS channel_name,s.id AS server_id,s.name AS server_name,u.global_name,u.username FROM community_messages m JOIN users u ON u.id=m.user_id JOIN community_channels c ON c.id=m.channel_id JOIN community_servers s ON s.id=c.server_id JOIN community_server_members sm ON sm.server_id=s.id AND sm.user_id=$2 WHERE m.message<>'' AND LOWER(m.message) LIKE LOWER($1) ORDER BY m.id DESC LIMIT 15`,[like,req.user.id]);
  res.json({members:people,messages});
});

app.get('/api/friends/history', requireUser, async (req,res)=>{
  const rows=await db.all(`SELECT u.* FROM friend_history h JOIN users u ON u.id=h.other_user_id WHERE h.user_id=$1 ORDER BY h.removed_at DESC`,[req.user.id]);
  res.json({friends:await getPublicUsers(rows)});
});
app.post('/api/friends/request/:id', requireUser, async (req,res) => {
  const targetId=String(req.params.id), meId=String(req.user.id);
  if(!/^\d+$/.test(targetId) || targetId===meId) return res.status(400).json({error:'Ungültiger Freund'});
  if(!await db.get('SELECT id FROM users WHERE id=$1',[targetId])) return res.status(404).json({error:'Mitglied nicht gefunden'});
  if(await isBlockedEitherWay(meId,targetId)) return res.status(403).json({error:'Freundschaftsanfrage nicht möglich.'});
  const rel=await relationshipBetween(meId,targetId);
  if(rel && rel.status==='accepted') return res.status(409).json({error:'Ihr seid bereits Freunde.'});
  if(rel && rel.status==='pending') return res.status(409).json({error:rel.requester_id===meId?'Anfrage bereits gesendet.':'Diese Person hat dir bereits eine Anfrage gesendet.'});
  // Alte abgelehnte/sonstige Beziehungen vollständig bereinigen, damit eine neue Anfrage wieder möglich ist.
  await db.run(`DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,[meId,targetId]);
  await db.run('INSERT INTO friendships(requester_id,addressee_id,status) VALUES($1,$2,\'pending\')',[meId,targetId]);
  await notifyUser(targetId,'friend','Neue Freundschaftsanfrage',`${req.user.global_name||req.user.username} möchte dein Freund werden.`,'friends');
  res.json({ok:true});
});

app.post('/api/friends/:id/accept', requireUser, async (req,res) => {
  const friendshipId=String(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  if(await isBlockedEitherWay(req.user.id,f.requester_id)) return res.status(403).json({error:'Diese Freundschaft ist blockiert.'});
  await db.run('UPDATE friendships SET status=\'accepted\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.post('/api/friends/accept-by-user/:id', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[targetId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'accepted\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[f.id]);
  res.json({ok:true});
});
app.post('/api/friends/decline-by-user/:id', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[targetId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'declined\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[f.id]);
  res.json({ok:true});
});
app.delete('/api/friends/cancel-by-user/:id', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  const f=await db.get(`SELECT id FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Gesendete Anfrage nicht gefunden'});
  await db.run('DELETE FROM friendships WHERE id=$1',[f.id]);
  res.json({ok:true});
});

app.delete('/api/friends/:id/request', requireUser, async (req,res) => {
  const friendshipId=String(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND requester_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Gesendete Anfrage nicht gefunden'});
  await db.run('DELETE FROM friendships WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.post('/api/friends/:id/decline', requireUser, async (req,res) => {
  const friendshipId=String(req.params.id);
  const f=await db.get('SELECT * FROM friendships WHERE id=$1 AND addressee_id=$2 AND status=\'pending\'',[friendshipId,req.user.id]);
  if(!f) return res.status(404).json({error:'Anfrage nicht gefunden'});
  await db.run('UPDATE friendships SET status=\'declined\',updated_at=CURRENT_TIMESTAMP WHERE id=$1',[friendshipId]);
  res.json({ok:true});
});

app.delete('/api/friends/:id', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  const f=await db.get(`SELECT id FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Freundschaft nicht gefunden'});
  await db.run('INSERT INTO friend_history(user_id,other_user_id) VALUES($1,$2) ON CONFLICT(user_id,other_user_id) DO UPDATE SET removed_at=CURRENT_TIMESTAMP',[req.user.id,targetId]);
  await db.run('INSERT INTO friend_history(user_id,other_user_id) VALUES($1,$2) ON CONFLICT(user_id,other_user_id) DO UPDATE SET removed_at=CURRENT_TIMESTAMP',[targetId,req.user.id]);
  await db.run('DELETE FROM friendships WHERE id=$1',[f.id]);
  res.json({ok:true});
});

app.post('/api/friends/:id/favorite', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  const f=await db.get(`SELECT * FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,[req.user.id,targetId]);
  if(!f) return res.status(404).json({error:'Freundschaft nicht gefunden'});
  const column=String(f.requester_id)===String(req.user.id)?'requester_favorite':'addressee_favorite';
  const value=req.body.favorite!==false;
  await db.run(`UPDATE friendships SET ${column}=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[value,f.id]);
  res.json({ok:true,favorite:value});
});

app.post('/api/friends/:id/block', requireUser, async (req,res) => {
  const targetId=String(req.params.id);
  if(!/^\d+$/.test(targetId)||targetId===String(req.user.id)) return res.status(400).json({error:'Ungültiger Benutzer'});
  const wasFriend=await db.get(`SELECT id FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,[req.user.id,targetId]);
  if(wasFriend){
    await db.run('INSERT INTO friend_history(user_id,other_user_id) VALUES($1,$2) ON CONFLICT(user_id,other_user_id) DO UPDATE SET removed_at=CURRENT_TIMESTAMP',[req.user.id,targetId]);
    await db.run('INSERT INTO friend_history(user_id,other_user_id) VALUES($1,$2) ON CONFLICT(user_id,other_user_id) DO UPDATE SET removed_at=CURRENT_TIMESTAMP',[targetId,req.user.id]);
  }
  await db.run('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT(blocker_id,blocked_id) DO NOTHING',[req.user.id,targetId]);
  await db.run(`DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,[req.user.id,targetId]);
  res.json({ok:true});
});

app.delete('/api/friends/:id/block', requireUser, async (req,res) => {
  const targetId=Number(req.params.id);
  if(!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(req.user.id)) {
    return res.status(400).json({error:'Ungültiger Benutzer'});
  }
  const result=await db.run('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[Number(req.user.id),targetId]);
  if(result.rowCount === 0) {
    return res.status(404).json({error:'Diese Person ist nicht (mehr) blockiert.'});
  }
  res.json({ok:true,removed:true});
});

// ZockerFreunde 4.0 private community servers
async function requireServerMember(req, res, next) {
  try {
    const serverId = Number(req.params.serverId || req.params.id);
    if (!Number.isInteger(serverId) || serverId <= 0) return res.status(400).json({ error: 'Ungültiger Server.' });
    const membership = await db.get(`
      SELECT s.*, s.discoverable, sm.role AS membership_role
      FROM community_servers s
      JOIN community_server_members sm ON sm.server_id=s.id AND sm.user_id=$1
      WHERE s.id=$2`, [req.user.id, serverId]);
    if (!membership) return res.status(404).json({ error: 'Server nicht gefunden.' });
    req.communityServer = membership;
    next();
  } catch (e) { console.error('Server-Mitgliedschaft:', e.message); res.status(500).json({ error: 'Serverfehler' }); }
}

function inviteCode() {
  return crypto.randomBytes(8).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
}

async function canAccessChannel(userId, serverId, channelId) {
  return Boolean(await db.get(`
    SELECT c.id FROM community_channels c
    JOIN community_server_members sm ON sm.server_id=c.server_id AND sm.user_id=$1
    WHERE c.id=$2 AND c.server_id=$3`, [userId, channelId, serverId]));
}


const DEFAULT_MEMBER_PERMISSIONS = {send_messages:true, connect_voice:true, use_voice:true, attach_files:true, create_polls:true};
const OWNER_ONLY_PERMISSIONS = ['manage_server','manage_channels','manage_roles','manage_members'];
const ALL_SERVER_PERMISSIONS = {manage_server:true, manage_channels:true, manage_roles:true, manage_members:true, manage_messages:true, send_messages:true, connect_voice:true, use_voice:true, attach_files:true, create_polls:true};
async function ensureCommunityDefaults(serverId){
  const section=await db.get('SELECT id FROM community_sections WHERE server_id=$1 ORDER BY position ASC,id ASC LIMIT 1',[serverId]);
  let sectionId=section?.id;
  if(!sectionId){
    const r=await db.get("INSERT INTO community_sections(server_id,name,position) VALUES($1,'Allgemein',0) RETURNING id",[serverId]);
    sectionId=r.id;
  }
  await db.run('UPDATE community_channels SET section_id=$1 WHERE server_id=$2 AND section_id IS NULL',[sectionId,serverId]);
  const role=await db.get('SELECT id FROM community_roles WHERE server_id=$1 ORDER BY position ASC,id ASC LIMIT 1',[serverId]);
  let roleId=role?.id;
  if(!roleId){
    const r=await db.get("INSERT INTO community_roles(server_id,name,color,permissions,position) VALUES($1,'Mitglied','#8b93ad',$2::jsonb,0) RETURNING id",[serverId,JSON.stringify(DEFAULT_MEMBER_PERMISSIONS)]);
    roleId=r.id;
  }
  await db.run('UPDATE community_server_members SET role_id=$1 WHERE server_id=$2 AND role_id IS NULL AND role<>\'owner\'',[roleId,serverId]);
  return {sectionId,roleId};
}
async function serverPermission(userId, serverId, permission){
  const s=await db.get('SELECT owner_id FROM community_servers WHERE id=$1',[serverId]);
  if(!s)return false;
  const ownerOnly=new Set(['manage_server','manage_channels','manage_roles','manage_members']);
  if(ownerOnly.has(permission)) return Number(s.owner_id)===Number(userId);
  if(Number(s.owner_id)===Number(userId)) return true;
  const m=await db.get(`SELECT sm.role,cr.permissions AS role_permissions FROM community_server_members sm LEFT JOIN community_roles cr ON cr.id=sm.role_id WHERE sm.server_id=$1 AND sm.user_id=$2`,[serverId,userId]);
  if(!m)return false;
  const perms=m.role_permissions||{};
  return Boolean(perms[permission]);
}
async function requireServerPermission(req,res,next,permission){
  try{ if(await serverPermission(req.user.id,req.communityServer.id,permission)) return next(); res.status(403).json({error:'Du hast diese Berechtigung nicht.'}); }
  catch(e){ console.error('Server-Berechtigung:',e.message); res.status(500).json({error:'Serverfehler'}); }
}
function normalizeInvite(raw){
  let value=clean(raw||'');
  try{const u=new URL(value); value=u.searchParams.get('invite')||value;}catch{}
  return value.replace(/^invite[:/]+/i,'').trim().replace(/[^A-Za-z0-9_-]/g,'').slice(0,32);
}
function parseDataUrl(value){
  const m=String(value||'').match(/^data:([^;]+);base64,(.+)$/);
  if(!m)return null;
  try{return {mime:m[1],data:Buffer.from(m[2],'base64')}}catch{return null}
}

app.get('/api/servers', requireUser, async (req,res) => {
  const rows = await db.all(`
    SELECT s.id,s.name,s.description,s.icon,s.owner_id,s.created_at,s.discoverable,sm.role AS membership_role,
      (SELECT COUNT(*)::int FROM community_server_members x WHERE x.server_id=s.id) AS member_count
    FROM community_servers s
    JOIN community_server_members sm ON sm.server_id=s.id AND sm.user_id=$1
    ORDER BY s.created_at ASC,s.id ASC`, [req.user.id]);
  res.json({ servers: rows });
});

app.post('/api/servers', requireUser, async (req,res) => {
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,48);
  if(name.length<2) return res.status(400).json({error:'Der Servername muss mindestens 2 Zeichen haben.'});
  const description=clean(req.body?.description||'').slice(0,240);
  const icon=clean(req.body?.icon||'').slice(0,400);
  const result=await db.get("INSERT INTO community_servers(owner_id,name,description,icon,chat_bg,chat_text,chat_bubble) VALUES($1,$2,$3,$4,'#0b1020','#f4f7ff','#171e33') RETURNING *",[req.user.id,name,description,icon]);
  await db.run("INSERT INTO community_server_members(server_id,user_id,role) VALUES($1,$2,'owner')",[result.id,req.user.id]);
  await db.run("INSERT INTO community_sections(server_id,name,position) VALUES($1,'Allgemein',0)",[result.id]);
  const sec=await db.get('SELECT id FROM community_sections WHERE server_id=$1 ORDER BY id DESC LIMIT 1',[result.id]);
  await db.run('INSERT INTO community_channels(server_id,name,type,position,section_id) VALUES($1,\'allgemein\',\'text\',0,$2),($1,\'Lounge\',\'voice\',1,$2)',[result.id,sec.id]);
  await db.run("INSERT INTO community_roles(server_id,name,color,permissions,position) VALUES($1,'Mitglied','#8b93ad',$2::jsonb,0)",[result.id,JSON.stringify(DEFAULT_MEMBER_PERMISSIONS)]);
  res.json({ok:true,server:result});
});

app.get('/api/servers/discover', requireUser, async (req,res)=>{
  const q=clean(req.query?.q||'').slice(0,60);
  const like=`%${q}%`;
  const rows=await db.all(`SELECT s.id,s.name,s.description,s.icon,s.owner_id,s.created_at,(SELECT COUNT(*)::int FROM community_server_members sm2 WHERE sm2.server_id=s.id) AS member_count FROM community_servers s WHERE s.discoverable=TRUE AND (s.name ILIKE $1 OR COALESCE(s.description,'') ILIKE $1) ORDER BY member_count DESC,s.created_at DESC LIMIT 60`,[like]);
  const joined=await db.all('SELECT server_id FROM community_server_members WHERE user_id=$1',[req.user.id]);
  const set=new Set(joined.map(x=>Number(x.server_id)));
  res.json({servers:rows.map(x=>({...x,joined:set.has(Number(x.id))}))});
});
app.get('/api/servers/:id', requireUser, async (req,res,next) => { req.params.serverId=req.params.id; next(); }, requireServerMember, async (req,res) => {
  const serverId=req.communityServer.id;
  await ensureCommunityDefaults(serverId);
  const channels=await db.all('SELECT id,name,type,position,section_id FROM community_channels WHERE server_id=$1 ORDER BY position ASC,id ASC',[serverId]);
  const sections=await db.all('SELECT id,name,position FROM community_sections WHERE server_id=$1 ORDER BY position ASC,id ASC',[serverId]);
  const roles=await db.all('SELECT id,name,color,permissions,position FROM community_roles WHERE server_id=$1 ORDER BY position DESC,id ASC',[serverId]);
  const members=await db.all(`SELECT u.id,u.discord_id,u.username,u.global_name,u.avatar,u.role,u.bio,u.xp,u.points,u.created_at,u.last_seen,u.discord_in_server,u.discord_roles,u.games_played,u.wins,u.last_login_reward,sm.role AS membership_role,sm.role_id,cr.name AS community_role_name,cr.color AS community_role_color FROM community_server_members sm JOIN users u ON u.id=sm.user_id LEFT JOIN community_roles cr ON cr.id=sm.role_id WHERE sm.server_id=$1 ORDER BY LOWER(COALESCE(u.global_name,u.username)) ASC`,[serverId]);
  const invites=await db.all(`SELECT code,uses,max_uses,expires_at,created_at FROM community_invites WHERE server_id=$1 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) ORDER BY id DESC LIMIT 10`,[serverId]);
  const canManage=await serverPermission(req.user.id,serverId,'manage_server');
  const canChannels=await serverPermission(req.user.id,serverId,'manage_channels');
  const canRoles=await serverPermission(req.user.id,serverId,'manage_roles');
  const canMessages=await serverPermission(req.user.id,serverId,'manage_messages');
  res.json({server:{id:req.communityServer.id,name:req.communityServer.name,description:req.communityServer.description||'',icon:req.communityServer.icon||'',owner_id:req.communityServer.owner_id,created_at:req.communityServer.created_at,membership_role:req.communityServer.membership_role,discoverable:Boolean(req.communityServer.discoverable),chat_bg:req.communityServer.chat_bg||'#0b1020',chat_text:req.communityServer.chat_text||'#f4f7ff',chat_bubble:req.communityServer.chat_bubble||'#171e33'},channels,sections,roles,members:await getPublicUsers(members),membersMeta:members.map(m=>({id:m.id,role_id:m.role_id,community_role_name:m.community_role_name,community_role_color:m.community_role_color,membership_role:m.membership_role})),invites,permissions:{manage_server:canManage,manage_channels:canChannels,manage_roles:canRoles,manage_members:await serverPermission(req.user.id,serverId,'manage_members'),manage_messages:canMessages,send_messages:await serverPermission(req.user.id,serverId,'send_messages'),attach_files:await serverPermission(req.user.id,serverId,'attach_files'),create_polls:await serverPermission(req.user.id,serverId,'create_polls'),connect_voice:await serverPermission(req.user.id,serverId,'connect_voice')}});
});

app.patch('/api/servers/:serverId', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_server'))) return res.status(403).json({error:'Keine Berechtigung zum Bearbeiten des Servers.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,48);
  if(name.length<2)return res.status(400).json({error:'Der Servername muss mindestens 2 Zeichen haben.'});
  const description=clean(req.body?.description||'').slice(0,240);
  const icon=clean(req.body?.icon||'').slice(0,400);
  const discoverable=Boolean(req.body?.discoverable);
  const validColor=v=>/^#[0-9a-fA-F]{6}$/.test(String(v||''));
  const chatBg=validColor(req.body?.chatBg)?String(req.body.chatBg):String(req.communityServer.chat_bg||'#0b1020');
  const chatText=validColor(req.body?.chatText)?String(req.body.chatText):String(req.communityServer.chat_text||'#f4f7ff');
  const chatBubble=validColor(req.body?.chatBubble)?String(req.body.chatBubble):String(req.communityServer.chat_bubble||'#171e33');
  const s=await db.get('UPDATE community_servers SET name=$1,description=$2,icon=$3,discoverable=$4,chat_bg=$5,chat_text=$6,chat_bubble=$7 WHERE id=$8 RETURNING id,name,description,icon,owner_id,created_at,discoverable,chat_bg,chat_text,chat_bubble',[name,description,icon,discoverable,chatBg,chatText,chatBubble,req.communityServer.id]);
  res.json({ok:true,server:s});
});
app.delete('/api/servers/:serverId', requireUser, requireServerMember, async (req,res) => {
  if(Number(req.communityServer.owner_id)!==Number(req.user.id)) return res.status(403).json({error:'Nur der Besitzer kann den Server löschen.'});
  await db.run('DELETE FROM community_servers WHERE id=$1',[req.communityServer.id]);
  res.json({ok:true});
});
app.post('/api/servers/:serverId/leave', requireUser, requireServerMember, async (req,res) => {
  if(Number(req.communityServer.owner_id)===Number(req.user.id)) return res.status(400).json({error:'Als Besitzer musst du den Server löschen oder vorher den Besitz übertragen.'});
  await db.run('DELETE FROM community_server_members WHERE server_id=$1 AND user_id=$2',[req.communityServer.id,req.user.id]);
  res.json({ok:true});
});

app.post('/api/servers/:serverId/sections', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32); if(!name)return res.status(400).json({error:'Abschnittsname fehlt.'});
  const max=await db.get('SELECT COALESCE(MAX(position),-1)+1 AS p FROM community_sections WHERE server_id=$1',[req.communityServer.id]);
  const sec=await db.get('INSERT INTO community_sections(server_id,name,position) VALUES($1,$2,$3) RETURNING id,name,position',[req.communityServer.id,name,max.p]);
  res.json({ok:true,section:sec});
});
app.patch('/api/servers/:serverId/sections/:sectionId', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const id=Number(req.params.sectionId),name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32); if(!name)return res.status(400).json({error:'Name fehlt.'});
  const sec=await db.get('UPDATE community_sections SET name=$1 WHERE id=$2 AND server_id=$3 RETURNING id,name,position',[name,id,req.communityServer.id]); if(!sec)return res.status(404).json({error:'Abschnitt nicht gefunden.'}); res.json({ok:true,section:sec});
});
app.delete('/api/servers/:serverId/sections/:sectionId', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const id=Number(req.params.sectionId); const sec=await db.get('SELECT id,name FROM community_sections WHERE id=$1 AND server_id=$2',[id,req.communityServer.id]); if(!sec)return res.status(404).json({error:'Abschnitt nicht gefunden.'});
  await db.run('UPDATE community_channels SET section_id=NULL WHERE section_id=$1',[id]); await db.run('DELETE FROM community_sections WHERE id=$1',[id]); await ensureCommunityDefaults(req.communityServer.id); res.json({ok:true});
});

app.post('/api/servers/:serverId/channels', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32); const type=req.body?.type==='voice'?'voice':'text'; if(!name)return res.status(400).json({error:'Kanalname fehlt.'});
  const sectionId=Number(req.body?.sectionId)|| (await ensureCommunityDefaults(req.communityServer.id)).sectionId;
  const validSection=await db.get('SELECT id FROM community_sections WHERE id=$1 AND server_id=$2',[sectionId,req.communityServer.id]);
  if(!validSection)return res.status(400).json({error:'Ungültiger Abschnitt.'});
  const max=await db.get('SELECT COALESCE(MAX(position),-1)+1 AS p FROM community_channels WHERE server_id=$1',[req.communityServer.id]);
  const c=await db.get('INSERT INTO community_channels(server_id,name,type,position,section_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,type,position,section_id',[req.communityServer.id,name,type,max.p,sectionId]);
  res.json({ok:true,channel:c});
});
app.patch('/api/servers/:serverId/channels/:channelId', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const id=Number(req.params.channelId); const c=await db.get('SELECT id,name,type FROM community_channels WHERE id=$1 AND server_id=$2',[id,req.communityServer.id]); if(!c)return res.status(404).json({error:'Kanal nicht gefunden.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32)||c.name; const sectionId=Number(req.body?.sectionId)||null;
  if(sectionId){const validSection=await db.get('SELECT id FROM community_sections WHERE id=$1 AND server_id=$2',[sectionId,req.communityServer.id]);if(!validSection)return res.status(400).json({error:'Ungültiger Abschnitt.'});}
  const updated=await db.get('UPDATE community_channels SET name=$1,section_id=$2 WHERE id=$3 AND server_id=$4 RETURNING id,name,type,position,section_id',[name,sectionId,id,req.communityServer.id]); res.json({ok:true,channel:updated});
});
app.delete('/api/servers/:serverId/channels/:channelId', requireUser, requireServerMember, async (req,res) => {
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_channels'))) return res.status(403).json({error:'Keine Berechtigung.'});
  const channelId=Number(req.params.channelId); const c=await db.get('SELECT * FROM community_channels WHERE id=$1 AND server_id=$2',[channelId,req.communityServer.id]); if(!c)return res.status(404).json({error:'Kanal nicht gefunden.'});
  if(c.name.toLowerCase()==='allgemein')return res.status(400).json({error:'Der Kanal Allgemein kann nicht gelöscht werden.'}); await db.run('DELETE FROM community_channels WHERE id=$1',[channelId]); res.json({ok:true});
});

app.get('/api/servers/:serverId/roles', requireUser, requireServerMember, async (req,res)=>{ await ensureCommunityDefaults(req.communityServer.id); res.json({roles:await db.all('SELECT id,name,color,permissions,position FROM community_roles WHERE server_id=$1 ORDER BY position DESC,id ASC',[req.communityServer.id])}); });
app.post('/api/servers/:serverId/roles', requireUser, requireServerMember, async (req,res)=>{
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_roles')))return res.status(403).json({error:'Keine Berechtigung.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32); if(!name)return res.status(400).json({error:'Rollenname fehlt.'});
  const color=/^#[0-9a-fA-F]{6}$/.test(String(req.body?.color||''))?String(req.body.color):'#8b93ad';
  const permissions=typeof req.body?.permissions==='object'&&req.body.permissions?{...req.body.permissions}:{}; OWNER_ONLY_PERMISSIONS.forEach(k=>delete permissions[k]);
  const max=await db.get('SELECT COALESCE(MAX(position),0)+1 AS p FROM community_roles WHERE server_id=$1',[req.communityServer.id]);
  const role=await db.get('INSERT INTO community_roles(server_id,name,color,permissions,position) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id,name,color,permissions,position',[req.communityServer.id,name,color,JSON.stringify(permissions),max.p]); res.json({ok:true,role});
});
app.patch('/api/servers/:serverId/roles/:roleId', requireUser, requireServerMember, async (req,res)=>{
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_roles')))return res.status(403).json({error:'Keine Berechtigung.'});
  const id=Number(req.params.roleId); const old=await db.get('SELECT * FROM community_roles WHERE id=$1 AND server_id=$2',[id,req.communityServer.id]); if(!old)return res.status(404).json({error:'Rolle nicht gefunden.'});
  const name=clean(req.body?.name).replace(/\s+/g,' ').slice(0,32)||old.name; const color=/^#[0-9a-fA-F]{6}$/.test(String(req.body?.color||''))?String(req.body.color):old.color; const permissions=typeof req.body?.permissions==='object'&&req.body.permissions?{...req.body.permissions}:{...(old.permissions||{})}; OWNER_ONLY_PERMISSIONS.forEach(k=>delete permissions[k]);
  const role=await db.get('UPDATE community_roles SET name=$1,color=$2,permissions=$3::jsonb WHERE id=$4 AND server_id=$5 RETURNING id,name,color,permissions,position',[name,color,JSON.stringify(permissions),id,req.communityServer.id]); res.json({ok:true,role});
});
app.delete('/api/servers/:serverId/roles/:roleId', requireUser, requireServerMember, async (req,res)=>{ if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_roles')))return res.status(403).json({error:'Keine Berechtigung.'}); const id=Number(req.params.roleId); await db.run('UPDATE community_server_members SET role_id=NULL WHERE server_id=$1 AND role_id=$2',[req.communityServer.id,id]); await db.run('DELETE FROM community_roles WHERE id=$1 AND server_id=$2',[id,req.communityServer.id]); await ensureCommunityDefaults(req.communityServer.id); res.json({ok:true}); });
app.post('/api/servers/:serverId/roles/reorder', requireUser, requireServerMember, async (req,res)=>{
  try{if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_roles')))return res.status(403).json({error:'Keine Berechtigung.'});
  const ids=Array.isArray(req.body?.roleIds)?req.body.roleIds.map(Number).filter(Number.isFinite):[];
  const roles=await db.all('SELECT id FROM community_roles WHERE server_id=$1 ORDER BY position DESC,id ASC',[req.communityServer.id]);
  const valid=new Set(roles.map(r=>Number(r.id)));
  const ordered=[...ids.filter(id=>valid.has(id)),...roles.map(r=>Number(r.id)).filter(id=>!ids.includes(id))];
  for(let i=0;i<ordered.length;i++) await db.run('UPDATE community_roles SET position=$1 WHERE id=$2 AND server_id=$3',[ordered.length-i,ordered[i],req.communityServer.id]);
  res.json({ok:true});
  }catch(e){console.error('role reorder',e);res.status(500).json({error:'Rollenreihenfolge konnte nicht gespeichert werden.'})}
});
app.post('/api/servers/:serverId/members/:memberId/role', requireUser, requireServerMember, async (req,res)=>{ if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_members')))return res.status(403).json({error:'Keine Berechtigung.'}); const memberId=Number(req.params.memberId),roleId=Number(req.body?.roleId)||null; const member=await db.get('SELECT user_id FROM community_server_members WHERE server_id=$1 AND user_id=$2',[req.communityServer.id,memberId]); if(!member)return res.status(404).json({error:'Mitglied nicht gefunden.'}); if(roleId){const role=await db.get('SELECT id FROM community_roles WHERE id=$1 AND server_id=$2',[roleId,req.communityServer.id]);if(!role)return res.status(404).json({error:'Rolle nicht gefunden.'});} await db.run('UPDATE community_server_members SET role_id=$1 WHERE server_id=$2 AND user_id=$3',[roleId,req.communityServer.id,memberId]); res.json({ok:true}); });

app.get('/api/servers/:serverId/channels/:channelId/messages', requireUser, requireServerMember, async (req,res) => {
  const channelId=Number(req.params.channelId); if(!(await canAccessChannel(req.user.id,req.communityServer.id,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  const rows=await db.all(`SELECT m.id,m.channel_id,m.user_id,m.message,m.created_at,m.edited_at,m.pinned,m.message_type,m.poll_data,u.username,u.global_name,u.avatar,u.role FROM community_messages m JOIN users u ON u.id=m.user_id WHERE m.channel_id=$1 ORDER BY m.id DESC LIMIT 150`,[channelId]);
  if (!rows.length) return res.json({messages:[]});
  const ids=rows.map(r=>Number(r.id));
  const [attachments,reactions,pollCounts,myVotes]=await Promise.all([
    db.all('SELECT id,message_id,filename,mime,size FROM community_attachments WHERE message_id = ANY($1::int[]) ORDER BY id ASC',[ids]),
    db.all('SELECT message_id,emoji,COUNT(*)::int AS count,BOOL_OR(user_id=$2) AS mine,MIN(id) AS first_id FROM community_message_reactions WHERE message_id = ANY($1::int[]) GROUP BY message_id,emoji ORDER BY first_id',[ids,req.user.id]),
    db.all('SELECT message_id,option_index,COUNT(*)::int AS count FROM community_poll_votes WHERE message_id = ANY($1::int[]) GROUP BY message_id,option_index',[ids]),
    db.all('SELECT message_id,option_index FROM community_poll_votes WHERE message_id = ANY($1::int[]) AND user_id=$2',[ids,req.user.id])
  ]);
  const attachmentMap=new Map(),reactionMap=new Map(),countMap=new Map(),voteMap=new Map();
  for(const x of attachments){const a=attachmentMap.get(Number(x.message_id))||[];a.push(x);attachmentMap.set(Number(x.message_id),a)}
  for(const x of reactions){const a=reactionMap.get(Number(x.message_id))||[];a.push({emoji:x.emoji,count:Number(x.count),mine:Boolean(x.mine)});reactionMap.set(Number(x.message_id),a)}
  for(const x of pollCounts){const a=countMap.get(Number(x.message_id))||{};a[x.option_index]=Number(x.count);countMap.set(Number(x.message_id),a)}
  for(const x of myVotes){const a=voteMap.get(Number(x.message_id))||[];a.push(Number(x.option_index));voteMap.set(Number(x.message_id),a)}
  for(const row of rows){
    row.attachments=attachmentMap.get(Number(row.id))||[];
    row.reactions=reactionMap.get(Number(row.id))||[];
    if(row.message_type==='poll'&&row.poll_data){row.poll_data={...row.poll_data,counts:countMap.get(Number(row.id))||{},myVotes:voteMap.get(Number(row.id))||[]};}
  }
  res.json({messages:rows.reverse()});
});
app.post('/api/servers/:serverId/channels/:channelId/messages', requireUser, requireServerMember, async (req,res) => {
  const cooldown = enforceChatCooldown(req.user.id);
  if (cooldown) return res.status(429).json({error:`Bitte warte noch ${cooldown} Sekunden.`,retryAfter:cooldown});
  const channelId=Number(req.params.channelId); if(!(await canAccessChannel(req.user.id,req.communityServer.id,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  const channel=await db.get('SELECT type FROM community_channels WHERE id=$1 AND server_id=$2',[channelId,req.communityServer.id]); if(channel?.type!=='text')return res.status(400).json({error:'In einem Sprachkanal kann nicht geschrieben werden.'});
  if(!(await serverPermission(req.user.id,req.communityServer.id,'send_messages')))return res.status(403).json({error:'Du darfst hier nicht schreiben.'});
  const message=clean(req.body?.message).slice(0,1000); const attachments=Array.isArray(req.body?.attachments)?req.body.attachments:[]; const poll=(req.body?.poll&&typeof req.body.poll==='object')?req.body.poll:null;
  if(!message&&!attachments.length&&!poll)return res.status(400).json({error:'Nachricht darf nicht leer sein.'});
  if(attachments.length && !(await serverPermission(req.user.id,req.communityServer.id,'attach_files')))return res.status(403).json({error:'Du darfst keine Dateien hochladen.'});
  if(poll && !(await serverPermission(req.user.id,req.communityServer.id,'create_polls')))return res.status(403).json({error:'Du darfst keine Abstimmungen erstellen.'});
  const type=poll?'poll':'text'; const info=await db.get('INSERT INTO community_messages(channel_id,user_id,message,message_type,poll_data) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id',[channelId,req.user.id,message,type,poll?JSON.stringify(poll):null]);
  for(const a of attachments.slice(0,8)){const parsed=parseDataUrl(a.data);const size=parsed?.data?.length||0;if(!parsed||size>12*1024*1024)continue;await db.run('INSERT INTO community_attachments(message_id,filename,mime,size,data) VALUES($1,$2,$3,$4,$5)',[info.id,String(a.filename||'Datei').slice(0,120),parsed.mime,size,parsed.data]);}
  const row=await db.get(`SELECT m.id,m.channel_id,m.user_id,m.message,m.created_at,m.edited_at,m.pinned,m.message_type,m.poll_data,u.username,u.global_name,u.avatar,u.role FROM community_messages m JOIN users u ON u.id=m.user_id WHERE m.id=$1`,[info.id]); row.attachments=await db.all('SELECT id,filename,mime,size FROM community_attachments WHERE message_id=$1 ORDER BY id ASC',[info.id]); row.reactions=[];
  io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===req.communityServer.id&&s.serverTextChannel===channelId)s.emit('server_channel_message',row)}); res.json({ok:true,message:row});
});
app.delete('/api/servers/:serverId/channels/:channelId/messages/:messageId', requireUser, requireServerMember, async (req,res)=>{const id=Number(req.params.messageId);const m=await db.get('SELECT user_id FROM community_messages WHERE id=$1 AND channel_id=$2',[id,Number(req.params.channelId)]);if(!m)return res.status(404).json({error:'Nachricht nicht gefunden.'});const own=Number(m.user_id)===Number(req.user.id);if(!own&&!(await serverPermission(req.user.id,req.communityServer.id,'manage_messages')))return res.status(403).json({error:'Du darfst diese Nachricht nicht löschen.'});await db.run('DELETE FROM community_messages WHERE id=$1',[id]);io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===req.communityServer.id&&s.serverTextChannel===Number(req.params.channelId))s.emit('server_message_deleted',{messageId:id});});res.json({ok:true});});
app.get('/api/community-attachments/:id', requireUser, async (req,res)=>{const a=await db.get('SELECT a.*,m.channel_id,cc.server_id FROM community_attachments a JOIN community_messages m ON m.id=a.message_id JOIN community_channels cc ON cc.id=m.channel_id WHERE a.id=$1',[Number(req.params.id)]);if(!a)return res.status(404).end();if(!(await canAccessChannel(req.user.id,a.server_id,a.channel_id)))return res.status(403).end();res.setHeader('Content-Type',a.mime);res.setHeader('Content-Disposition',`inline; filename="${String(a.filename).replace(/"/g,'')}"`);res.send(a.data);});

app.patch('/api/servers/:serverId/channels/:channelId/messages/:messageId', requireUser, requireServerMember, async (req,res)=>{
  const channelId=Number(req.params.channelId),messageId=Number(req.params.messageId);
  if(!(await canAccessChannel(req.user.id,req.communityServer.id,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  const m=await db.get('SELECT id,user_id FROM community_messages WHERE id=$1 AND channel_id=$2',[messageId,channelId]);
  if(!m)return res.status(404).json({error:'Nachricht nicht gefunden.'});
  if(Number(m.user_id)!==Number(req.user.id))return res.status(403).json({error:'Du darfst nur eigene Nachrichten bearbeiten.'});
  const message=clean(req.body?.message).slice(0,1000);
  if(!message)return res.status(400).json({error:'Nachricht darf nicht leer sein.'});
  const row=await db.get('UPDATE community_messages SET message=$1,edited_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,message,edited_at',[message,messageId]);
  const editedPayload={...row,channelId}; io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===req.communityServer.id&&s.serverTextChannel===channelId)s.emit('server_message_edited',editedPayload)});
  res.json({ok:true,message:row});
});
app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/pin', requireUser, requireServerMember, async (req,res)=>{
  const channelId=Number(req.params.channelId),messageId=Number(req.params.messageId);
  if(!(await canAccessChannel(req.user.id,req.communityServer.id,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  if(!(await serverPermission(req.user.id,req.communityServer.id,'manage_messages')))return res.status(403).json({error:'Keine Berechtigung.'});
  const pinned=req.body?.pinned!==false;
  const row=await db.get('UPDATE community_messages SET pinned=$1 WHERE id=$2 AND channel_id=$3 RETURNING id,pinned',[pinned,messageId,channelId]);
  if(!row)return res.status(404).json({error:'Nachricht nicht gefunden.'});
  const pinPayload={...row,channelId}; io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===req.communityServer.id&&s.serverTextChannel===channelId)s.emit('server_message_pinned',pinPayload)});
  res.json({ok:true,...row});
});
app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/reaction', requireUser, requireServerMember, async (req,res)=>{
  const channelId=Number(req.params.channelId),messageId=Number(req.params.messageId); const emoji=String(req.body?.emoji||'').trim().slice(0,8);
  if(!emoji)return res.status(400).json({error:'Emoji fehlt.'});
  if(!(await canAccessChannel(req.user.id,req.communityServer.id,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  const messageRow=await db.get('SELECT id FROM community_messages WHERE id=$1 AND channel_id=$2',[messageId,channelId]); if(!messageRow)return res.status(404).json({error:'Nachricht nicht gefunden.'}); const exists=await db.get('SELECT id FROM community_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',[messageId,req.user.id,emoji]);
  if(exists)await db.run('DELETE FROM community_message_reactions WHERE id=$1',[exists.id]);
  else await db.run('INSERT INTO community_message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3)',[messageId,req.user.id,emoji]);
  const reactions=await db.all('SELECT emoji,COUNT(*)::int AS count,BOOL_OR(user_id=$2) AS mine FROM community_message_reactions WHERE message_id=$1 GROUP BY emoji ORDER BY MIN(id)',[messageId,req.user.id]);
  const payload={messageId,reactions}; io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===req.communityServer.id&&s.serverTextChannel===channelId)s.emit('server_message_reactions',payload)});
  res.json({ok:true,...payload});
});

app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/poll-vote', requireUser, requireServerMember, async (req,res)=>{
  const serverId=req.communityServer.id,channelId=Number(req.params.channelId),messageId=Number(req.params.messageId),option=Number(req.body?.optionIndex);
  if(!Number.isInteger(option)||option<0)return res.status(400).json({error:'Ungültige Antwort.'});
  if(!(await canAccessChannel(req.user.id,serverId,channelId)))return res.status(404).json({error:'Kanal nicht gefunden.'});
  const m=await db.get('SELECT poll_data,message_type FROM community_messages WHERE id=$1 AND channel_id=$2',[messageId,channelId]);
  if(!m||m.message_type!=='poll'||!m.poll_data)return res.status(404).json({error:'Abstimmung nicht gefunden.'});
  const options=Array.isArray(m.poll_data.options)?m.poll_data.options:[];if(option>=options.length)return res.status(400).json({error:'Ungültige Antwort.'});
  if(m.poll_data.multi!==true)await db.run('DELETE FROM community_poll_votes WHERE message_id=$1 AND user_id=$2',[messageId,req.user.id]);
  else if(await db.get('SELECT id FROM community_poll_votes WHERE message_id=$1 AND user_id=$2 AND option_index=$3',[messageId,req.user.id,option])){await db.run('DELETE FROM community_poll_votes WHERE message_id=$1 AND user_id=$2 AND option_index=$3',[messageId,req.user.id,option]);}
  else await db.run('INSERT INTO community_poll_votes(message_id,user_id,option_index) VALUES($1,$2,$3)',[messageId,req.user.id,option]);
  const counts=(await db.all('SELECT option_index,COUNT(*)::int AS count FROM community_poll_votes WHERE message_id=$1 GROUP BY option_index',[messageId])).reduce((a,x)=>(a[x.option_index]=x.count,a),{});
  const myVotes=(await db.all('SELECT option_index FROM community_poll_votes WHERE message_id=$1 AND user_id=$2',[messageId,req.user.id])).map(x=>x.option_index);
  const payload={messageId,counts,myVotes};
  io.sockets.sockets.forEach(s=>{if(s?.user&&s.serverMembershipId===serverId&&s.serverTextChannel===channelId)s.emit('server_poll_updated',payload)});
  res.json({ok:true,...payload});
});

app.patch('/api/servers/:serverId/discoverability', requireUser, requireServerMember, async (req,res)=>{
  if(Number(req.communityServer.owner_id)!==Number(req.user.id)) return res.status(403).json({error:'Nur der Serverbesitzer kann die Auffindbarkeit ändern.'});
  const value=Boolean(req.body?.discoverable);
  const r=await db.get('UPDATE community_servers SET discoverable=$1 WHERE id=$2 RETURNING id,name,discoverable',[value,req.communityServer.id]);
  res.json({ok:true,server:r});
});
app.post('/api/servers/:serverId/invites', requireUser, requireServerMember, async (req,res) => {
  const code=inviteCode();
  const expiresHours=Number(req.body?.expiresHours);
  const expires=Number.isFinite(expiresHours)&&expiresHours>0&&expiresHours<=168 ? new Date(Date.now()+expiresHours*3600*1000) : null;
  const maxUses=Number(req.body?.maxUses);
  const max=Number.isInteger(maxUses)&&maxUses>0&&maxUses<=1000 ? maxUses : null;
  const row=await db.get('INSERT INTO community_invites(server_id,code,created_by,max_uses,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING code,uses,max_uses,expires_at,created_at',[req.communityServer.id,code,req.user.id,max,expires]);
  res.json({ok:true,invite:row});
});

app.post('/api/invites/join', requireUser, async (req,res) => {
  let raw=normalizeInvite(req.body?.invite);
  if(!raw) return res.status(400).json({error:'Einladung fehlt.'});
  const invite=await db.get(`SELECT i.*,s.name,s.owner_id FROM community_invites i JOIN community_servers s ON s.id=i.server_id WHERE i.code=$1 AND (i.expires_at IS NULL OR i.expires_at>CURRENT_TIMESTAMP)`,[raw]);
  if(!invite) return res.status(404).json({error:'Einladung ist ungültig oder abgelaufen.'});
  if(invite.max_uses!==null && invite.uses>=invite.max_uses) return res.status(409).json({error:'Diese Einladung wurde bereits zu oft verwendet.'});
  const existing=await db.get('SELECT id FROM community_server_members WHERE server_id=$1 AND user_id=$2',[invite.server_id,req.user.id]);
  if(!existing){
    await db.run('INSERT INTO community_server_members(server_id,user_id,role) VALUES($1,$2,\'member\')',[invite.server_id,req.user.id]);
    await db.run('UPDATE community_invites SET uses=uses+1 WHERE id=$1',[invite.id]);
  }
  res.json({ok:true,serverId:invite.server_id,serverName:invite.name,alreadyMember:Boolean(existing)});
});

app.get('/api/invites/:code', async (req,res) => {
  const code=String(req.params.code||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,32);
  const invite=await db.get(`SELECT i.code,i.uses,i.max_uses,i.expires_at,s.id AS server_id,s.name,s.owner_id FROM community_invites i JOIN community_servers s ON s.id=i.server_id WHERE i.code=$1 AND (i.expires_at IS NULL OR i.expires_at>CURRENT_TIMESTAMP)`,[code]);
  if(!invite) return res.status(404).json({error:'Einladung nicht gefunden.'});
  if(invite.max_uses!==null && invite.uses>=invite.max_uses) return res.status(409).json({error:'Diese Einladung ist aufgebraucht.'});
  const memberCount=await db.get('SELECT COUNT(*)::int AS count FROM community_server_members WHERE server_id=$1',[invite.server_id]);
  res.json({invite:{code:invite.code,server_id:invite.server_id,server_name:invite.name,member_count:memberCount.count,expires_at:invite.expires_at}});
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
  const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify guilds', state });
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
    let discordGuilds = [];
    try {
      const guildRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (guildRes.ok) {
        const rawGuilds = await guildRes.json();
        discordGuilds = Array.isArray(rawGuilds) ? rawGuilds.map(g => ({ id:String(g.id), name:String(g.name||'Unbenannter Server'), icon:g.icon?`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=256`:'', owner:Boolean(g.owner), permissions:String(g.permissions||'') })).sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'})) : [];
      }
    } catch (e) { console.warn('Discord-Guilds konnten nicht geladen werden:', e.message); }
    const avatar = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=256` : `https://cdn.discordapp.com/embed/avatars/${Number(d.discriminator || 0) % 5}.png`;
    let u = await db.get('SELECT * FROM users WHERE discord_id=$1', [d.id]);
    if (!u) {
      const info = await db.get('INSERT INTO users(discord_id,username,global_name,avatar,discord_guilds) VALUES($1,$2,$3,$4,$5) RETURNING id', [d.id, d.username, d.global_name || d.username, avatar, JSON.stringify(discordGuilds)]);
      u = await db.get('SELECT * FROM users WHERE id=$1', [info.id]);
    } else {
      await db.run('UPDATE users SET username=$1,global_name=$2,avatar=$3,discord_guilds=$4,last_seen=CURRENT_TIMESTAMP WHERE id=$5', [d.username, d.global_name || d.username, avatar, JSON.stringify(discordGuilds), u.id]);
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
app.get('/api/discord/guilds', requireUser, async (req,res)=>{
  try { const row=await db.get('SELECT discord_guilds FROM users WHERE id=$1',[req.user.id]); let guilds=[]; try{guilds=JSON.parse(row?.discord_guilds||'[]')}catch{}; guilds=Array.isArray(guilds)?guilds:[]; guilds.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'})); res.json({guilds}); }
  catch(e){ console.error(e); res.status(500).json({error:'Discord-Server konnten nicht geladen werden.'}); }
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
      const cooldown = enforceChatCooldown(socket.user.id);
      if (cooldown) { socket.emit('public_message_error', {error:`Bitte warte noch ${cooldown} Sekunden.`, retryAfter:cooldown}); return; }
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
  socket.on('server_channel_watch', async data => {
    try {
      if(!socket.user)return;
      const serverId=Number(data?.serverId),channelId=Number(data?.channelId);
      if(!Number.isInteger(serverId)||!Number.isInteger(channelId))return;
      const ok=await canAccessChannel(socket.user.id,serverId,channelId);
      const channel=await db.get('SELECT type FROM community_channels WHERE id=$1 AND server_id=$2',[channelId,serverId]);
      if(!ok || channel?.type!=='text')return;
      socket.serverMembershipId=serverId;
      socket.serverTextChannel=channelId;
    }catch(e){console.error('server_channel_watch:',e.message)}
  });
  socket.on('server_voice_join', async data => {
    try {
      if(!socket.user) return;
      const serverId=Number(data?.serverId), channelId=Number(data?.channelId);
      if(!Number.isInteger(serverId)||!Number.isInteger(channelId)) return;
      const membership=await db.get('SELECT role FROM community_server_members WHERE server_id=$1 AND user_id=$2',[serverId,socket.user.id]);
      const channel=await db.get('SELECT id,type FROM community_channels WHERE id=$1 AND server_id=$2',[channelId,serverId]);
      if(!membership || !channel || channel.type!=='voice') return socket.emit('server_voice_error',{error:'Sprachkanal nicht verfügbar.'});
      if(!(await serverPermission(socket.user.id,serverId,'connect_voice'))) return socket.emit('server_voice_error',{error:'Du darfst diesen Sprachkanal nicht betreten.'});
      if(socket.voiceServerId&&socket.voiceChannelId){ const oldServer=socket.voiceServerId,oldChannel=socket.voiceChannelId; for(const [,s] of io.sockets.sockets){if(s!==socket&&s.voiceServerId===oldServer&&s.voiceChannelId===oldChannel)s.emit('server_voice_peer_left',{socketId:socket.id});} }
      for(const [,s] of io.sockets.sockets){ if(s!==socket && s.voiceServerId===serverId && s.voiceChannelId===channelId) socket.emit('server_voice_peer', {socketId:s.id,user:s.socketUserSummary||s.user}); }
      socket.voiceServerId=serverId; socket.voiceChannelId=channelId; socket.socketUserSummary={id:socket.user.id,username:socket.user.username,global_name:socket.user.global_name,avatar:socket.user.avatar};
      for(const [,s] of io.sockets.sockets){ if(s!==socket && s.voiceServerId===serverId && s.voiceChannelId===channelId) s.emit('server_voice_peer_joined',{socketId:socket.id,user:socket.socketUserSummary}); }
    } catch(e){ console.error('server_voice_join:',e.message); }
  });
  socket.on('server_voice_leave', () => {
    const sid=socket.voiceServerId,cid=socket.voiceChannelId;
    if(!sid||!cid)return;
    for(const [,s] of io.sockets.sockets){ if(s!==socket && s.voiceServerId===sid && s.voiceChannelId===cid) s.emit('server_voice_peer_left',{socketId:socket.id}); }
    socket.voiceServerId=null; socket.voiceChannelId=null;
  });
  socket.on('server_voice_signal', data => {
    const target=io.sockets.sockets.get(String(data?.target));
    if(!target||!socket.voiceServerId||target.voiceServerId!==socket.voiceServerId||target.voiceChannelId!==socket.voiceChannelId)return;
    target.emit('server_voice_signal',{from:socket.id,data:data.data});
  });

  socket.on('private_message', async data => {
    try {
      if (!socket.user) return;
      const receiverId = Number(data?.receiverId); const message = clean(data?.message).slice(0, 1000);
      if (!receiverId || !message || receiverId === Number(socket.user.id)) return;
      const target = await db.get('SELECT id FROM users WHERE id=$1', [receiverId]); if (!target) return;
      if (!(await isPrivateChatAllowed(socket.user.id, receiverId))) { socket.emit('private_message_error',{error:'Private Chats sind nur mit Freunden oder alten Freunden möglich.'}); return; }
      const info = await db.get('INSERT INTO private_messages(sender_id,receiver_id,message) VALUES($1,$2,$3) RETURNING id', [socket.user.id, receiverId, message]);
      const row = await db.get(`SELECT m.*,u.username,u.global_name,u.avatar,u.role FROM private_messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1`, [info.id]);
      for (const [, s] of io.sockets.sockets) if (s?.user && (String(s.user.id) === receiverId || Number(s.user.id) === Number(socket.user.id))) s.emit('private_message', row);
    } catch (e) { console.error('private_message:', e.message); }
  });
  socket.on('disconnect', () => {
    const sid=socket.voiceServerId,cid=socket.voiceChannelId;
    if(sid&&cid){ for(const [,s] of io.sockets.sockets){ if(s!==socket && s.voiceServerId===sid && s.voiceChannelId===cid) s.emit('server_voice_peer_left',{socketId:socket.id}); } }
    if (socket.user) { const n = (online.get(socket.user.id) || 1) - 1; if (n <= 0) { online.delete(socket.user.id); io.emit('presence', { userId: socket.user.id, status: 'offline' }); } else online.set(socket.user.id, n); }
  });
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDatabase()
  .then(() => server.listen(PORT, '0.0.0.0', () => console.log(`Zockerfreunde läuft auf Port ${PORT}`)))
  .catch(err => { console.error('Datenbank konnte nicht initialisiert werden:', err); process.exit(1); });

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
