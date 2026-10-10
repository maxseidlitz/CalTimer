# CalTimer

Countdown-Widgets für Termine aus deinem iCloud-Kalender. Läuft als Docker-Container (z. B. auf einem ZimaBoard) und wird im Heimnetz vom Handy aus als Web-App genutzt.

- **Startseite:** nur deine Timer-Kacheln, sortiert nach dem nächsten Termin, live heruntergezählt
- **„Widget erstellen“:** beim ersten Mal iCloud verbinden, dann Termin aus Liste (nächste 60 Tage) oder Monatsansicht wählen, Titel anpassen, fertig
- **Kachel antippen:** löschen

## Auf dem ZimaBoard starten

```bash
git clone https://github.com/maxseidlitz/CalTimer.git
cd CalTimer
docker compose up -d --build
```

Danach am Handy `http://<IP-des-ZimaBoards>:3000` öffnen und in Safari über **Teilen → Zum Home-Bildschirm** hinzufügen. Dann startet CalTimer im Vollbild wie eine App.

Daten (Zugangsdaten + Widgets) liegen im Docker-Volume `caltimer-data`. Wer lieber einen Ordner auf dem ZimaBoard nutzt, siehe Kommentar in `docker-compose.yml`.

## iCloud verbinden

Web-Apps können nicht direkt auf den Kalender des Handys zugreifen. CalTimer liest den Kalender deshalb serverseitig per CalDAV:

1. [account.apple.com](https://account.apple.com/account/manage) → *Anmelden und Sicherheit* → *App-spezifische Passwörter* → neues Passwort „CalTimer“ erstellen
2. In CalTimer auf **Widget erstellen** tippen, Apple-ID und dieses Passwort eintragen

Das Passwort wird auf dem Server in `/data/credentials.json` (nur für den Container-User lesbar) gespeichert und lässt sich bei Apple jederzeit widerrufen. Es gibt keinen Login: Jeder im Heimnetz, der die Adresse kennt, sieht die Widgets und die Terminliste. Die App deshalb nicht ins Internet freigeben.

## Lokal entwickeln

```bash
npm install
DEMO=1 npm run dev     # Beispieltermine, kein iCloud nötig
```

| Variable   | Standard        | Bedeutung                                |
|------------|-----------------|------------------------------------------|
| `PORT`     | `3000`          | HTTP-Port                                |
| `DATA_DIR` | `./data`        | Speicherort für Zugangsdaten und Widgets |
| `TZ`       | `Europe/Berlin` | Zeitzone für Termine ohne Zeitzone       |
| `DEMO`     | –               | `1` = Demo-Kalender statt iCloud         |
