# whereami

`whereami` is a personal GeoGuessr-style game built with FastAPI and plain browser JavaScript. It uses live Google Maps and Street View, supports guest play or email/password login, stores users and best times in SQLite, and keeps uploaded avatars plus app data in a dedicated `data/` folder.

## Features

- Interactive Google Street View rounds
- Guessing map with result markers and distance line
- 5-round games with timer and scoring
- Difficulty modes: `easy`, `medium`, `hard`, `impossible`
- Guest play
- Email/password accounts
- Avatar upload
- SQLite-backed users, sessions, and best times
- Final results dialog with per-round summary

## Project structure

```text
whereami/
  backend/
    app.py
    auth.py
    db.py
    game.py
    locations.json
    scoring.py
  frontend/
    index.html
    app.js
    styles.css
  data/
    whereami.db
    uploads/
  .dockerignore
  .env.example
  .gitignore
  Dockerfile
  pyproject.toml
  README.md
```

## Requirements

- Python 3.14 for local runs
- Docker Desktop if you want to run in Docker
- A Google Maps Platform API key
- Billing enabled in the Google Cloud project that owns the key

## Google Maps setup

Create a Google Cloud project and enable billing, then enable these APIs:

- Google Cloud Console: https://console.cloud.google.com/
- Maps JavaScript API

For local development and Docker on your own machine, allow browser referrers such as:

- `http://localhost:*/*`
- `http://127.0.0.1:*/*`

Create a `.env` file in the repo root:

```env
GOOGLE_MAPS_API_KEY=your_actual_key_here
```

The app loads `.env` automatically on startup.

## Local setup

From the repo root:

```powershell
.venv\Scripts\python.exe -m pip install -e .
```

## Local run

Run the app on port `8766`:

```powershell
.venv\Scripts\uvicorn.exe backend.app:app --reload --host 0.0.0.0 --port 8766
```

Then open:

```text
http://127.0.0.1:8766
```

## Docker build

Build the image from the repo root:

```powershell
docker build -t whereami .
```

## Docker run

Run the container on port `8766` and mount the app data folder:

```powershell
docker run --rm -p 8766:8766 --env-file .env -v "${PWD}/data:/app/data" whereami
```

Then open:

```text
http://127.0.0.1:8766
```

Notes:

- `--env-file .env` passes in your Google Maps API key
- `-v "${PWD}/data:/app/data"` keeps the SQLite database and uploaded avatars outside the container
- The container itself listens on port `8766`

## Run from Docker Desktop

If you want to run it from Docker Desktop instead of the command line:

1. Open Docker Desktop.
2. Go to `Images`.
3. Find the `whereami` image after building it.
4. Click `Run`.
5. Set the container port mapping to `8766` host -> `8766` container.
6. Add an environment variable:
   `GOOGLE_MAPS_API_KEY=your_actual_key_here`
7. Add a volume mount:
   host path: your repo `data` folder (eg: C:\Users\ashbyp\dev\databases\whereami)
   container path: `/app/data`
8. Start the container.
9. Open `http://127.0.0.1:8766`

If Docker Desktop asks whether to use a bind mount or volume, a bind mount to your repo's `data` folder is the easiest option for this app.

## Backend overview

Main backend files:

- `backend/app.py`
  - FastAPI app
  - serves the frontend
  - exposes auth, game, and stats endpoints
  - loads `.env`
  - serves uploaded avatars from `data/uploads`
- `backend/auth.py`
  - login, register, guest session, avatar update logic
- `backend/db.py`
  - SQLite storage for users, sessions, and best times
- `backend/game.py`
  - in-memory active game store
  - difficulty handling
  - round progression
- `backend/locations.json`
  - seed locations for round generation

Key endpoints:

- `GET /`
- `GET /api/config`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/guest`
- `GET /api/auth/me`
- `PUT /api/auth/profile`
- `POST /api/auth/logout`
- `POST /api/game/new`
- `GET /api/game/{game_id}`
- `POST /api/game/{game_id}/guess`
- `DELETE /api/stats/best-time/{difficulty}`

## Frontend overview

Frontend files:

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`

The frontend:

- loads config from the backend
- loads Google Maps JavaScript API in the browser
- starts guest or authenticated sessions
- renders Street View and the map overlay
- submits guesses and shows results

## Data and persistence

Runtime state now lives in `data/`:

- `data/whereami.db`
  - SQLite database for users, sessions, and best times
- `data/uploads/`
  - uploaded avatar images

That folder is the one to mount into Docker.

## Troubleshooting

### The app says the Google API key is missing

Make sure:

- `.env` exists in the repo root
- it contains `GOOGLE_MAPS_API_KEY=...`
- the app was restarted after editing `.env`

### Google Maps or Street View is blank

Check:

- billing is enabled
- the Maps JavaScript API is enabled
- your API key referrer restrictions allow `localhost`
- the key value is being passed into the app correctly

### Docker starts but avatars or login data disappear

Make sure you mounted the `data/` folder:

```powershell
-v "${PWD}/data:/app/data"
```

Without that mount, the database and uploaded files live only inside the container.
