# CCR Chauffeur L&D Tracker

Training tracker for ECO Mobility CCR chauffeurs. Live site: https://chauffeur-training-tracker.vercel.app

## How it fits together

| Part | Where it lives | Files |
|---|---|---|
| Website (screens) | Vercel | `index.html`, `app.js`, `styles.css`, `config.js`, `logo.webp` |
| Backend API (logins, saving, feedback) | Google Apps Script, attached to the tracker's Google Sheet | `apps-script/Code.gs` |
| Data | The Google Sheet (tabs: Chauffeurs, Attendance, Modules, Users, Settings, Regions, FeedbackLinks, Feedback Inbox, Not in Master, Master View) | – |

The website has no build step: Vercel serves the files as they are. `config.js` holds the Apps Script web app URL.

## Changing things

- **Website:** edit the files here and deploy to Vercel (automatic once the Vercel project is linked to this repository). Bump the `?v=` number on `styles.css` / `app.js` in `index.html` so browsers load the new version.
- **Backend:** paste `apps-script/Code.gs` into the Apps Script editor (Extensions → Apps Script in the Sheet), save, then Deploy → Manage deployments → edit → New version. The web app URL stays the same.

## Known gaps

- `logo.webp` must be added to the repository (download it from the live site).
- `feedback.html` (the chauffeur feedback form behind the Feedback QR button) was not found in the recovered files.
