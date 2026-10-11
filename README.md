# CalTimer

Countdown-Widgets für Termine aus deinem iCloud-Kalender. Läuft als Docker-Container (z. B. auf einem ZimaBoard) und wird im Heimnetz vom Handy aus als Web-App genutzt.

- **Startseite:** deine Timer-Kacheln, sortiert nach dem nächsten Termin, live heruntergezählt
- **Vorschläge:** CalTimer schaut die nächsten 120 Tage durch und schlägt Termine vor, für die sich ein Countdown lohnt (mehrtägig, ganztägig, Stichwörter wie Urlaub, Flug, Geburtstag, Konzert, Prüfung, Deadline …; wöchentliche/monatliche Routine-Termine fallen raus). **+ Als Widget** übernimmt direkt, **×** blendet den Termin-Titel dauerhaft aus.
- **Nächste Termine:** die nächsten 5 Termine direkt auf der Startseite, ein Tipp legt ein Widget an
- **„Widget erstellen“:** Termin aus Liste (nächste 60 Tage) oder Monatsansicht wählen, Titel anpassen, fertig
- **Kachel antippen:** löschen

## Sicherheit

CalTimer bekommt **keinen Zugang zu deinem iCloud-Account**. Du gibst einzelne Kalender als „Öffentlicher Kalender“ frei; CalTimer liest nur diese per geheimem Link – kein Zugriff auf Mail, Kontakte, Fotos oder andere Kalender.

- **Login:** Passphrase (scrypt-gehasht), Sitzungs-Cookie `HttpOnly` + `SameSite=Strict`, 90 Tage gültig. Nach 5 Fehlversuchen steigende Sperrzeiten.
- **Ersteinrichtung:** nur mit einmaligem Code aus dem Container-Log – niemand anderes im WLAN kann die Passphrase festlegen.
- **Kalender-Links:** werden nur per HTTPS von `*.icloud.com` abgerufen (keine Anfragen an andere Server oder dein Heimnetz), verlassen den Server nie wieder und liegen nur für den Container-User lesbar in `/data`.
- **Browser-Schutz:** Host-Header-Prüfung (gegen DNS-Rebinding), Origin-Prüfung, Content-Security-Policy, kein Einbetten in fremde Seiten.
- **Container:** schreibgeschütztes Dateisystem, keine Linux-Capabilities, `no-new-privileges`, läuft als unprivilegierter User.

Grenzen, die du kennen solltest:

- Die Verbindung im Heimnetz ist **HTTP, nicht HTTPS**. Passphrase und Termine gehen unverschlüsselt durchs WLAN – im eigenen, WPA2/3-geschützten WLAN vertretbar, in fremden Netzen nicht. Port 3000 **nicht** im Router freigeben und keinen Fernzugriff von ZimaOS auf diesen Port legen.
- Wer einen Kalender-Link kennt, kann diesen Kalender lesen. Link verloren oder unsicher? Auf dem iPhone „Öffentlicher Kalender“ aus- und wieder einschalten – dann ist der alte Link ungültig.
- Wer Root-Zugriff auf das ZimaBoard hat, kommt an die Daten in `/data`.

## Als App in ZimaOS installieren (empfohlen)

Das Image wird bei jedem Push auf `main` automatisch gebaut und unter `ghcr.io/maxseidlitz/caltimer:latest` veröffentlicht.

1. Per SSH den Datenordner anlegen: `sudo mkdir -p /DATA/AppData/caltimer-data && sudo chown 1000:1000 /DATA/AppData/caltimer-data`
2. ZimaOS → App Store → **Benutzerdefinierte Installation** → **Import** → **Compose** → Inhalt von [`zimaos-compose.yml`](zimaos-compose.yml) einfügen → installieren
3. Einrichtungscode anzeigen: `sudo docker logs caltimer`

Updates: in ZimaOS bei CalTimer auf **Aktualisieren** bzw. App neu installieren – die Daten in `/DATA/AppData/caltimer-data` bleiben erhalten.

## Auf dem ZimaBoard per Kommandozeile starten (Alternative)

Auf ZimaOS braucht `docker compose` mit `sudo` einen beschreibbaren Konfig-Ordner, daher `env DOCKER_CONFIG=/DATA/.docker`.

```bash
mkdir -p /DATA/AppData && cd /DATA/AppData
curl -L https://github.com/maxseidlitz/CalTimer/archive/refs/heads/main.tar.gz | tar xz && mv CalTimer-main caltimer && cd caltimer
sudo mkdir -p /DATA/.docker
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d --build
sudo docker logs caltimer        # zeigt den Einrichtungscode
```

Dann am Handy `http://<IP-des-ZimaBoards>:3000` öffnen, Einrichtungscode + eigene Passphrase eingeben, in Safari **Teilen → Zum Home-Bildschirm**. Die Home-Bildschirm-App hat einen eigenen Speicher – dort einmal mit der Passphrase anmelden.

## Kalender freigeben

1. iPhone: **Kalender**-App → unten **Kalender** → **(i)** neben dem Kalender
2. **Öffentlicher Kalender** einschalten → **Link teilen …** → **Kopieren**
3. In CalTimer: **Kalender verbinden** (bzw. Einstellungen → **+ Kalender hinzufügen**) → Link einfügen

Für jeden weiteren Kalender wiederholen. Freigegebene Kalender anderer Personen und der Geburtstagskalender lassen sich so nicht einbinden.

## Passphrase vergessen / zurücksetzen

```bash
sudo docker exec caltimer rm /data/auth.json /data/sessions.json
sudo docker restart caltimer
sudo docker logs caltimer        # neuer Einrichtungscode
```

Widgets und Kalender bleiben erhalten.

## Konfiguration

| Variable        | Standard        | Bedeutung                                                        |
|-----------------|-----------------|------------------------------------------------------------------|
| `PORT`          | `3000`          | HTTP-Port                                                        |
| `DATA_DIR`      | `./data`        | Speicherort für Passphrase-Hash, Sitzungen, Kalender, Widgets    |
| `TZ`            | `Europe/Berlin` | Zeitzone für Termine ohne Zeitzone                               |
| `ALLOWED_HOSTS` | –               | Zusätzliche Hostnamen (kommagetrennt). IPs, `localhost` und `*.local` sind immer erlaubt |
| `DEMO`          | –               | `1` = Demo-Kalender statt iCloud                                 |

## Lokal entwickeln

Backend: Node + Express (`src/`). Frontend: React + Vite + Tailwind + [shadcn/ui](https://ui.shadcn.com) (`web/`).

```bash
npm install && (cd web && npm install)
DEMO=1 npm run dev           # API auf :3000, Beispieltermine statt iCloud
cd web && npm run dev        # Frontend auf :5173, /api wird an :3000 weitergereicht
```

Produktion: `cd web && npm run build` erzeugt `web/dist`, das der Express-Server ausliefert (im Dockerfile automatisch).
