# Flight Prep app 3.7.0-B737 – one-time set-up (about 10 minutes)

The app files hold **no flight data and no company data**. Flights and library files are loaded from the Files app
on your iPad and never uploaded anywhere.

## 1. Put the app online once (GitHub Pages, free)
1. Make a free account at https://github.com (any device). You make the account yourself – Claude does not.
2. Tap **+** (top right) → **New repository**. Name: `flightprep`. Visibility: **Public** (free Pages need a public
   repository; the app files hold no company data). Tap **Create repository**.
3. On the new repository page tap **uploading an existing file**. Unzip `flightprep_app_v3.7.0_B737.zip` and pick
   **everything** inside it, including the folders `.github`, `tools` and `data` (drag the folders in, so GitHub
   keeps the structure). Tap **Commit changes**.
4. **Settings** → **Pages** → Build and deployment: Source **Deploy from a branch**, Branch **main**,
   folder **/(root)** → **Save**.
5. Wait 1–2 minutes. The page shows your address: `https://YOUR-NAME.github.io/flightprep/`

## 2. Install it on the iPad
1. Open that address in **Safari**.
2. **Share** → **Add to Home Screen** → **Add**. The Flight Prep icon appears.
3. Open the app from the icon once while online. FLIGHTS shows "Flight Prep 3.7.0-B737 … works offline on this device".
4. Test: switch on airplane mode, close the app, open it again – it still works.
5. Open the settings panel (sliders icon, top right) and enter your **1-hour one-engine distance** in NM, from your own
   operations manual. It is not set by default and stays on the iPad. Until it is set the app draws no 1-hour rings.

## 3. Load a flight
- **Flight file from Claude:** save the `*_flight.json` file Claude sends to the Files app, then
  **FLIGHTS → Load OFP (PDF), flight or library files** → pick it.
- **OFP alone:** the same button also takes an OFP PDF and builds the flight in the app, offline. Two layouts are read:
  a Lido OFP, and (from 3.7.0) the **flydubai Skybook briefing pack** – the whole PDF exported from Skybook
  ("OPERATIONAL FLIGHT PLAN PAGE 1/n" plus weather, NOTAMs and charts). From the Skybook pack the app reads the header,
  route, fuel and weights, alternates, the navlog with coordinates, FIR times, the critical terrain scenario (T-points,
  escape aerodromes), METAR/TAF, SIGMETs, NOTAMs and company notices. The pack is laid out in two columns, so a NOTAM or
  TAF that runs over a page break is marked or shown only in part – the pack prevails. The coverage list on DASH says what
  was read. If something is missing, give that list and the PDF to Claude so it can adapt `fp_ofp.js`.

## 4. Library files (load once, used by every flight after that)
Claude builds these from **your** company documents. They stay in the Files app on the iPad.
**Never put a library or flight file in the GitHub repository – the repository is public.**

| File | What it adds |
|---|---|
| `apt_*.json` | Airport packs: briefing summary, ground chart, runways, ILS, frequencies, diversion card |
| `fir_library.json` | FIR comms: VHF in the order you use them, CPDLC log-on, HF, notes per FIR |
| `regs_library.json` | Country rules and regional procedures for the REGS page |
| `mel_library.json` | The MEL – pick today's item and it appears on DASH, in TEM and on the rows |
| `route_*.json` | Route packs: what is written once for a city pair (FIR procedures on that routing, threats) |

Select several files at once; FLIGHTS lists what is stored.

## 5. Live weather (and NOTAMs) while you still have internet
The app is a static page, so a scheduled job in your own repository fetches the weather and writes it next to the app.
1. The zip already contains `.github/workflows/wx.yml`, `tools/wx_fetch.py`, `tools/notam_fetch.py` and
   `data/stations.txt`. After uploading, open the repository's **Actions** tab once and allow workflows.
2. It writes `data/wx.json` (METAR / TAF) and `data/sigmet.json` twice an hour.
3. In the app: **WX · NOTAM → Refresh weather / NOTAMs**. A newer report is shown as **LIVE** next to the OFP one;
   the OFP is never overwritten.
4. Edit `data/stations.txt` in the repository so it lists your airports (one or more ICAO codes per line).
5. NOTAMs are optional: register free at https://api.faa.gov (NOTAM API), then in the repository
   **Settings → Secrets and variables → Actions** add `FAA_CLIENT_ID` and `FAA_CLIENT_SECRET`. It is a cross-check,
   not a replacement for the OFP bulletin (no company NOTAMs, not every AIP supplement).

## 6. Updating the app later
Upload the new files over the old ones in the repository, open the app online and tap **Update now**.

Preparation aid only – the OFP, official company documentation and ATC prevail.
