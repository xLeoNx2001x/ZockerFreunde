# ZockerFreunde 4.2 – Server UI Overhaul

Enthält den neuen Server-Bereich mit In-App-GUIs, Serverwechsel, Kanalverwaltung inklusive Löschen, Voice-Lobby mit explizitem Beitreten, Rollenverwaltung, Server-Entdeckung sowie Owner-gesteuertem Chat-Theme (Hintergrund, Schrift und Speech-Bubble).

Wichtig: Die Server-GUIs verwenden keine Browser-Prompts für Serveraktionen.


## 4.4 Performance
- HTTP-Kompression für größere Antworten
- stärkere Browser-Caches für statische Assets
- reduzierte Datenbankabfragen beim Mitglieder- und Server-Chat-Laden
- gebündelte Chat-Anhänge/Reaktionen/Poll-Abfragen
- paralleles Initial-Laden von Session, Config, Settings und Basisdaten
- Presence/Mitglieder-Refresh nur noch im sichtbaren Tab und seltener
- PostgreSQL-Verbindungen effizienter wiederverwenden
