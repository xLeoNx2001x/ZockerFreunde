# Zockerfreunde 3.3 – Supabase / PostgreSQL

Die Website verwendet **PostgreSQL über Supabase** statt einer lokalen SQLite-Datei. Dadurch bleiben Accounts, XP, Level, Rangliste, Chats, Profile und Einstellungen auch nach Render-Restarts und neuen Deploys erhalten – ohne Render Persistent Disk.

## Render Environment Variables

Setze in deinem Render Web Service:

- `DATABASE_URL` = PostgreSQL Connection String aus Supabase
- `DATABASE_SSL` = `true`
- `DB_POOL_MAX` = `5`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DISCORD_GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_INVITE_URL`
- `SESSION_SECRET` (Render kann automatisch einen Wert erzeugen)

Die Datenbanktabellen werden beim Start automatisch mit `CREATE TABLE IF NOT EXISTS` angelegt. Es ist kein manuelles SQL-Skript für die erste Einrichtung nötig.

## Supabase

In Supabase findest du den Connection String unter den Datenbank-/Connect-Einstellungen. Für einen normalen dauerhaften Render-Webservice kannst du den dort bereitgestellten PostgreSQL-Connection-String verwenden.

## Lokal testen

```bash
npm install
npm start
```

Dafür müssen die Environment Variables gesetzt sein. Der Healthcheck ist unter `/health` erreichbar und meldet `database: connected`, wenn PostgreSQL erreichbar ist.

## Render

`render.yaml` enthält bereits die benötigten Environment-Variablen und startet den Server mit `npm start`.
