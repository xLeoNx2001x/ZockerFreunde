require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = Number(process.env.PORT || 10000);
const SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
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
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'neon',
      notifications INTEGER NOT NULL DEFAULT 1
    );
  `);
  console.log('PostgreSQL-Datenbank bereit');
}

const germanDay = () => new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const levelFromXP = xp => Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1);
const levelStartXP = level => Math.max(0, Math.pow(Math.max(1, level - 1), 2) * 100);
const levelNextXP = level => Math.pow(Math.max(1, level), 2) * 100;

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
    const [member, roles] = await Promise.all([
      discordRequest(`/guilds/${guildId}/members/${discordId}`),
      discordRequest(`/guilds/${guildId}/roles`)
    ]);

    if (!member || member.notFound) {
      return { inServer: false, roles: [] };
    }

    const roleMap = new Map((roles || []).map(r => [r.id, r]));

    const memberRoles = (member.roles || [])
      .map(id => {
        const r = roleMap.get(id);
        return r ? {
          id: r.id,
          name: r.name,
          color: r.color || 0
        } : null;
      })
      .filter(Boolean)
      .filter(r => r.name !== '@everyone');

    return {
      inServer: true,
      roles: memberRoles
    };
  } catch (e) {
    console.error('Discord-Mitglied konnte nicht geprüft werden:', e.message);
    return null;
  }
}

async function awardDailyLogin(userId) {
  const today = germanDay();

  const r = await query(
    'SELECT last_login_reward FROM users WHERE id=$1',
    [userId]
  );

  const u = r.rows[0];

  if (!u || u.last_login_reward === today) return false;

  await query(
    'UPDATE users SET xp=xp+25,last_login_reward=$1 WHERE id=$2',
    [today, userId]
  );

  return true;
}

const clean = s =>
  String(s ?? '').replace(/[<>]/g, '').trim();

const tokenHash = token =>
  crypto.createHash('sha256').update(token).digest('hex');

const sign = value =>
  crypto.createHmac('sha256', SECRET).update(value).digest('hex');

async function issueToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;

  await query(
    'INSERT INTO auth_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)',
    [tokenHash(raw), userId, expires]
  );

  return `${raw}.${sign(raw)}`;
}
async function currentUser(req) {
  const value = req.cookies?.zf_token;
  if (!value || !value.includes('.')) return null;

  const [raw, sig] = value.split('.');
  const expected = sign(raw);

  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  const r = await query(
    'SELECT u.* FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>$2',
    [tokenHash(raw), Date.now()]
  );

  const row = r.rows[0];

  if (row) {
    await query('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=$1', [row.id]);
  }

  return row || null;
}

async function publicUser(u) {
  const roles = (() => {
    try { return JSON.parse(u.discord_roles || '[]'); } catch { return []; }
  })();

  const countResult = await query(
    'SELECT COUNT(*)::int AS count FROM public_messages WHERE user_id=$1',
    [u.id]
  );

  const messageCount = countResult.rows[0].count;
  const level = levelFromXP(u.xp);
  const start = levelStartXP(level);
  const next = levelNextXP(level);

  return {
    id: u.id,
    username: u.username,
    global_name: u.global_name,
    avatar: u.avatar,
    role: u.role,
    discord_id: u.discord_id,
    discord_in_server: Boolean(u.discord_in_server),
    discord_roles: roles,
    bio: u.bio,
    xp: Number(u.xp) || 0,
    level,
    level_xp: Math.max(0, (Number(u.xp) || 0) - start),
    level_needed: Math.max(1, next - start),
    points: Number(u.points) || 0,
    games_played: Number(u.games_played) || 0,
    wins: Number(u.wins) || 0,
    message_count: messageCount,
    created_at: u.created_at,
    last_seen: u.last_seen
  };
}
function setSessionCookie(res, token) {
  res.cookie('zf_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

function clearSessionCookie(res) {
  res.clearCookie('zf_token');
}
async function requireUser(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet' });
    req.user = u;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
}

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (e) {
    console.error('Health DB error:', e.message);
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

app.get('/api/config', (req, res) => res.json({
  discordInvite: process.env.DISCORD_INVITE_URL || '',
  discordServerCheckConfigured: Boolean(
    process.env.DISCORD_GUILD_ID &&
    process.env.DISCORD_BOT_TOKEN
  )
}));

app.get('/api/me', async (req, res) => {
  try {
    const u = await currentUser(req);
    res.json({ user: u ? await publicUser(u) : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM users ORDER BY xp DESC, username ASC'
    );

    res.json({
      members: await Promise.all(r.rows.map(publicUser))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/member/:id', async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM users WHERE id=$1',
      [Number(req.params.id)]
    );

    const u = r.rows[0];

    if (!u) {
      return res.status(404).json({ error: 'Nicht gefunden' });
    }

    res.json({ member: await publicUser(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/account', requireUser, async (req, res) => {
  try {
    const check = await syncDiscordMember(req.user.discord_id);

    if (check) {
      await query(
        'UPDATE users SET discord_in_server=$1,discord_roles=$2,role=$3 WHERE id=$4',
        [
          check.inServer,
          JSON.stringify(check.roles),
          check.roles[0]?.name ||
            (check.inServer ? 'Mitglied' : 'Nicht auf Server'),
          req.user.id
        ]
      );
    }

    const r = await query(
      'SELECT * FROM users WHERE id=$1',
      [req.user.id]
    );

    res.json({
      account: await publicUser(r.rows[0]),
      discordCheckConfigured: Boolean(
        process.env.DISCORD_GUILD_ID &&
        process.env.DISCORD_BOT_TOKEN
      )
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});
app.get('/api/leaderboard', async (req, res) => {
  try {
    const r = await query('SELECT * FROM users ORDER BY xp DESC, username ASC LIMIT 100');
    res.json({ members: await Promise.all(r.rows.map(publicUser)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/chat/public', async (req, res) => {
  try {
    const r = await query(`
      SELECT m.*,u.username,u.global_name,u.avatar,u.role
      FROM public_messages m
      JOIN users u ON u.id=m.user_id
      ORDER BY m.id DESC LIMIT 80
    `);
    res.json({ messages: r.rows.reverse() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/chat/private/:id', requireUser, async (req, res) => {
  try {
    const other = Number(req.params.id);
    const r = await query(`
      SELECT m.*,u.username,u.global_name,u.avatar,u.role
      FROM private_messages m
      JOIN users u ON u.id=m.sender_id
      WHERE (sender_id=$1 AND receiver_id=$2)
         OR (sender_id=$3 AND receiver_id=$4)
      ORDER BY m.id ASC LIMIT 200
    `, [req.user.id, other, other, req.user.id]);

    res.json({ messages: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/settings', requireUser, async (req, res) => {
  try {
    let r = await query(
      'SELECT * FROM settings WHERE user_id=$1',
      [req.user.id]
    );

    if (!r.rows[0]) {
      await query(
        'INSERT INTO settings(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',
        [req.user.id]
      );

      r = await query(
        'SELECT * FROM settings WHERE user_id=$1',
        [req.user.id]
      );
    }

    res.json({ settings: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.post('/api/settings', requireUser, async (req, res) => {
  try {
    const theme = ['dark', 'light', 'neon'].includes(req.body.theme)
      ? req.body.theme
      : 'neon';

    const notifications = req.body.notifications === false ? 0 : 1;

    await query(`
      INSERT INTO settings(user_id,theme,notifications)
      VALUES($1,$2,$3)
      ON CONFLICT(user_id)
      DO UPDATE SET
        theme=EXCLUDED.theme,
        notifications=EXCLUDED.notifications
    `, [req.user.id, theme, notifications]);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.post('/api/profile', requireUser, async (req, res) => {
  try {
    const bio = clean(req.body.bio).slice(0, 240);

    await query(
      'UPDATE users SET bio=$1 WHERE id=$2',
      [bio, req.user.id]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});
app.post('/api/chat/public', requireUser, async (req, res) => {
  try {
    const message = clean(req.body.message).slice(0, 1000);

    if (!message) {
      return res.status(400).json({ error: 'Nachricht fehlt' });
    }

    const r = await query(`
      INSERT INTO public_messages(user_id,message)
      VALUES($1,$2)
      RETURNING *
    `, [req.user.id, message]);

    await query(
      'UPDATE users SET xp=xp+5 WHERE id=$1',
      [req.user.id]
    );

    const full = await query(`
      SELECT m.*,u.username,u.global_name,u.avatar,u.role
      FROM public_messages m
      JOIN users u ON u.id=m.user_id
      WHERE m.id=$1
    `, [r.rows[0].id]);

    const msg = full.rows[0];

    io.emit('public_message', msg);

    res.json({ message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.post('/api/chat/private/:id', requireUser, async (req, res) => {
  try {
    const receiverId = Number(req.params.id);
    const message = clean(req.body.message).slice(0, 1000);

    if (!Number.isFinite(receiverId) || !message) {
      return res.status(400).json({ error: 'Ungültige Daten' });
    }

    const receiver = await query(
      'SELECT id FROM users WHERE id=$1',
      [receiverId]
    );

    if (!receiver.rows[0]) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const r = await query(`
      INSERT INTO private_messages(sender_id,receiver_id,message)
      VALUES($1,$2,$3)
      RETURNING *
    `, [req.user.id, receiverId, message]);

    const msg = r.rows[0];

    io.to(`user:${receiverId}`).emit('private_message', msg);
    io.to(`user:${req.user.id}`).emit('private_message', msg);

    res.json({ message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

app.get('/api/discord/check', requireUser, async (req, res) => {
  try {
    const check = await syncDiscordMember(req.user.discord_id);

    if (!check) {
      return res.json({
        configured: false,
        inServer: Boolean(req.user.discord_in_server),
        roles: []
      });
    }

    await query(`
      UPDATE users
      SET discord_in_server=$1,
          discord_roles=$2,
          role=$3
      WHERE id=$4
    `, [
      check.inServer,
      JSON.stringify(check.roles),
      check.roles[0]?.name || (check.inServer ? 'Mitglied' : 'Nicht auf Server'),
      req.user.id
    ]);

    res.json({
      configured: true,
      inServer: check.inServer,
      roles: check.roles
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Discord-Prüfung fehlgeschlagen' });
  }
});
app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send('Discord OAuth ist nicht konfiguriert.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify'
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');

    if (!code) {
      return res.status(400).send('Discord-Code fehlt.');
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send('Discord OAuth ist nicht konfiguriert.');
    }

    const tokenResponse = await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      }
    );

    if (!tokenResponse.ok) {
      throw new Error(`Discord Token ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch(
      'https://discord.com/api/v10/users/@me',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    if (!userResponse.ok) {
      throw new Error(`Discord User ${userResponse.status}`);
    }

    const discordUser = await userResponse.json();

    const existing = await query(
      'SELECT * FROM users WHERE discord_id=$1',
      [discordUser.id]
    );

    let user;

    if (existing.rows[0]) {
      user = existing.rows[0];

      await query(`
        UPDATE users
        SET username=$1,
            global_name=$2,
            avatar=$3,
            last_seen=CURRENT_TIMESTAMP
        WHERE id=$4
      `, [
        discordUser.username,
        discordUser.global_name || '',
        discordUser.avatar || '',
        user.id
      ]);
    } else {
      const created = await query(`
        INSERT INTO users
          (discord_id,username,global_name,avatar)
        VALUES($1,$2,$3,$4)
        RETURNING *
      `, [
        discordUser.id,
        discordUser.username,
        discordUser.global_name || '',
        discordUser.avatar || ''
      ]);

      user = created.rows[0];
    }

    await awardDailyLogin(user.id);

    const token = await issueToken(user.id);

    setSessionCookie(res, token);

    res.redirect('/');
  } catch (e) {
    console.error('Discord Login Fehler:', e);
    res.status(500).send('Discord Login fehlgeschlagen.');
  }
});

app.post('/auth/logout', async (req, res) => {
  try {
    const token = req.cookies?.zf_token;

    if (token && token.includes('.')) {
      const [raw] = token.split('.');

      await query(
        'DELETE FROM auth_tokens WHERE token_hash=$1',
        [tokenHash(raw)]
      );
    }

    clearSessionCookie(res);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Logout fehlgeschlagen' });
  }
});
io.use(async (socket, next) => {
  try {
    const cookies = socket.handshake.headers.cookie || '';
    const match = cookies.match(/(?:^|;\s*)zf_token=([^;]+)/);

    if (!match) {
      socket.user = null;
      return next();
    }

    const value = decodeURIComponent(match[1]);

    if (!value.includes('.')) {
      socket.user = null;
      return next();
    }

    const [raw, sig] = value.split('.');
    const expected = sign(raw);

    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expected)
      )
    ) {
      socket.user = null;
      return next();
    }

    const r = await query(`
      SELECT u.*
      FROM auth_tokens t
      JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=$1
        AND t.expires_at>$2
    `, [tokenHash(raw), Date.now()]);

    socket.user = r.rows[0] || null;
    next();
  } catch (e) {
    console.error('Socket Auth Fehler:', e);
    socket.user = null;
    next();
  }
});

io.on('connection', socket => {
  if (!socket.user) return;

  const userId = String(socket.user.id);

  socket.join(`user:${userId}`);

  socket.emit('presence', {
    online: true
  });

  socket.on('disconnect', () => {
    socket.emit('presence', {
      online: false
    });
  });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await initDb();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Zockerfreunde läuft auf Port ${PORT}`);
    });
  } catch (e) {
    console.error('Datenbank konnte nicht gestartet werden:', e);
    process.exit(1);
  }
}

start();
