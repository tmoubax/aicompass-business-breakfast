# Business Breakfast — The AI Compass · september 2026

Landingspagina voor de besloten ontbijtsessies rond [The AI Compass](https://www.theaicompassbook.com) (Thierry Moubax). Vier ochtenden — Mechelen, Antwerpen, Brugge-Oostkamp — telkens max. 6 CEO's per tafel.

## Structuur

| Pad | Wat |
|---|---|
| `index.html` | De pagina. Afbeeldingen en video laden via jsDelivr-CDN uit deze repo (`assets/`), dus het bestand werkt overal — ook als custom code in GoHighLevel. |
| `assets/` | Foto's, logo's en de boekvideo (bron van de CDN-URL's — repo moet **public** blijven). |
| `google-apps-script.gs` | Backend: inschrijvingen → Google Sheet, capaciteitsbewaking (6/tafel), bevestigingsmail + agenda-uitnodiging, notificatie naar Thierry. **Zet nooit een echte `GHL_WEBHOOK_URL` in deze repo** — vul die enkel in de Apps Script-editor in. |
| `archief/` | Eerdere versies (donkere v1, zelfstandige lichte versie met ingebedde afbeeldingen). |

## Deployen

De pagina staat op Vercel (project via team AIC). Nieuwe versie? Pas `index.html` aan, commit & push, en deploy opnieuw.

Eén ding invullen vóór livegang: de Apps Script web-app-URL in `index.html` (zoek naar `PLAK_HIER_JE_APPS_SCRIPT_URL`) — zie `SETUP-GIDS.md` in de projectmap (niet in deze repo).

Let op: jsDelivr cachet `@main`-URL's tot ±12 uur. Vervang je een afbeelding onder dezelfde naam, dan kan de oude nog even zichtbaar blijven.
