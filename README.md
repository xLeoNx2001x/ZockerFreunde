# Zockerfreunde Community 3.2

Gaming-Community-Webseite mit Discord OAuth, Mitgliederprofilen, öffentlichem Chat, privaten Chats, Online-Status, Discord-Server-Check, Discord-Rollen, XP-Levelsystem, Rangliste und Einstellungen.

## XP-System
- Öffentliche Nachricht: **+2 XP**
- Discord-Login: **+25 XP einmal pro Kalendertag** (Europe/Berlin)
- Level werden automatisch aus der XP-Zahl berechnet.
- Spiele wurden aus der Webseite entfernt.

## Discord-Server-Check und Rollen
Zusätzlich zu Discord OAuth benötigt die Webseite einen Bot, der sich auf deinem Discord-Server befindet.

Render-Variablen:
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `SESSION_SECRET`
- `DISCORD_INVITE_URL`
- `DISCORD_GUILD_ID` = ID deines Discord-Servers
- `DISCORD_BOT_TOKEN` = Token deines Discord-Bots (nur als geheime Render-Variable)
- `PORT` wird von Render gesetzt.

Der Bot-Token darf **nicht** in GitHub, `app.js` oder dem Browser landen.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Node: 24.21.0

## SQLite
Die Datenbank liegt unter `data/zockerfreunde.db`. Für dauerhafte Daten auf Render sollte ein persistenter Disk-/Volume-Speicher für `data` eingerichtet werden.
