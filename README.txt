ZOCKERFREUNDE – ÖFFENTLICHE VERSION

Diese Version ist für öffentliches Hosting vorbereitet.

EMPFOHLEN: Render
1. Erstelle einen kostenlosen Account bei Render.
2. Lade dieses Projekt als GitHub-Repository hoch.
3. In Render: New -> Web Service -> Repository auswählen.
4. Build Command: npm install
5. Start Command: npm start
6. Render erzeugt eine öffentliche https://...onrender.com Adresse.

DISCORD OAUTH:
Im Discord Developer Portal unter OAuth2 -> Redirects exakt diese URL eintragen:
https://DEINE-RENDER-DOMAIN/auth/discord/callback

Danach bei Render Environment folgende Variablen setzen:
DISCORD_CLIENT_ID = deine Client ID
DISCORD_CLIENT_SECRET = dein Client Secret
DISCORD_REDIRECT_URI = https://DEINE-RENDER-DOMAIN/auth/discord/callback
SESSION_SECRET = langer zufälliger Wert (Render kann ihn generieren)

WICHTIG:
- Nicht localhost als Redirect URL verwenden, wenn die Website öffentlich läuft.
- Das Client Secret niemals in HTML/JavaScript veröffentlichen.
- Die Session wird nach dem OAuth-Callback explizit gespeichert. Dadurch wird die wiederholte Autorisierung verhindert.
- Für eine dauerhaft produktive Community sollte die SQLite-Datenbank später durch eine verwaltete PostgreSQL-Datenbank ersetzt werden, weil ein kostenloser Web-Service Dateispeicher verlieren kann.
