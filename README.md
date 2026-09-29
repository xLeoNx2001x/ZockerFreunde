# Zockerfreunde Community 3.0

Eine komplette Gaming-Community-Webseite mit Discord OAuth, Mitgliederprofilen, öffentlichem Chat, privaten Chats, Online-Status, Rangliste, Einstellungen und Browsergames.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Node: 20+
- PORT wird automatisch von Render gesetzt.

## Umgebungsvariablen
`DISCORD_CLIENT_ID`
`DISCORD_CLIENT_SECRET`
`DISCORD_REDIRECT_URI`
`SESSION_SECRET`
`DISCORD_INVITE_URL`

Die Redirect-URI im Discord Developer Portal muss exakt der `DISCORD_REDIRECT_URI` entsprechen.

## Hinweis
Die Datenbank liegt unter `data/zockerfreunde.db`. Für dauerhafte Daten auf Render sollte ein persistenter Disk-/Volume-Speicher für `data` eingerichtet werden. Ohne persistenten Speicher kann die lokale SQLite-Datei bei einem neuen Deploy/Instanzwechsel verloren gehen.
