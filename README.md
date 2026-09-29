# Zockerfreunde 3.4.1 – Supabase / PostgreSQL

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


## Admin-Funktionen (3.4)
Setze auf Render die Environment Variable `DISCORD_ADMIN_IDS` auf eine oder mehrere Discord-User-IDs, kommasepariert.
Beispiel: `123456789012345678,987654321098765432`

Admins sehen unter **Einstellungen → Server & Level bearbeiten** die Mitgliederverwaltung. Dort können Level gesetzt und Discord-Rollen über den Bot vergeben werden. Dafür benötigt der Discord-Bot die passenden Server-/Rollenrechte.


## 3.4.2 Feinschliff
- Aktive Mitglieder werden über `last_seen` und Socket-Verbindungen aktualisiert.
- Öffentlicher Chat kann von konfigurierten Admins geleert werden.
- Discord-Beitreten verwendet `DISCORD_INVITE_URL`.
- Chat-XP startet bei 5 XP und verdoppelt sich pro erreichtem Level: 5, 10, 20, 40, ...

- Online-Erkennung akzeptiert jetzt PostgreSQL-/ISO-Zeitstempel korrekt.
- Der eigene eingeloggte Account wird auf der Startseite sofort als aktiv behandelt.
- Level-Up-Animation bei echtem Levelsprung ergänzt.
- Discord-Beitreten zeigt bei fehlender `DISCORD_INVITE_URL` jetzt einen verständlichen Hinweis statt eines leeren Links.
