# whereami

`whereami` is a lightweight GeoGuessr-style prototype for personal use. It uses a simple Python backend and Google Maps Platform from the outset: the frontend shows a Street View image for each round, the player clicks on a Google map to guess the location, and the backend scores the guess by distance.

This version is intentionally small:

- FastAPI backend
- Plain HTML, CSS, and JavaScript frontend
- In-memory game sessions
- Seeded landmark dataset in JSON
- Google Maps JavaScript API for the guess map
- Google Street View Static API for round images

The current goal is to keep the core game loop simple first, then add persistence, user management, and saved games later.

## What the project does

Each game currently runs as a 5-round session:

1. The backend picks random locations from `backend/locations.json`.
2. The frontend loads a Street View image for the current location using your Google API key.
3. The player clicks on a Google map to place a guess.
4. The frontend sends the guess to the backend.
5. The backend calculates distance and score, then returns the result.

## Project structure

```text
whereami/
  backend/
    app.py
    game.py
    locations.json
    scoring.py
  frontend/
    index.html
    app.js
    styles.css
  .env.example
  .gitignore
  pyproject.toml
  README.md
```

## Requirements

- Python 3.14
- A working virtual environment in `.venv`
- A Google Maps Platform API key
- Billing enabled in Google Cloud for the project that owns the API key

## Google Maps setup

Create a Google Cloud project and enable billing, then enable these APIs:

- Google Cloud Console: https://console.cloud.google.com/
- Maps JavaScript API
- Street View Static API

Create an API key and restrict it for browser use. For local development, allow referrers such as:

- `http://localhost:*/*`
- `http://127.0.0.1:*/*`

Then create a `.env` file in the repo root:

```env
GOOGLE_MAPS_API_KEY=your_actual_key_here
```

The app loads `.env` automatically on startup.

## Setup

From the repository root:

```powershell
.venv\Scripts\python.exe -m pip install -e .
```

This installs the project dependencies from `pyproject.toml`, including:

- `fastapi`
- `uvicorn`
- `python-dotenv`

## Run the app

Start the development server from the repo root:

```powershell
.venv\Scripts\uvicorn.exe backend.app:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

## How the backend works

The backend lives in `backend/`:

- `backend/app.py`
  - FastAPI app
  - serves the frontend
  - exposes the API endpoints
  - loads `.env`
- `backend/game.py`
  - in-memory game store
  - round selection
  - session progression
  - guess submission
- `backend/scoring.py`
  - haversine distance calculation
  - round scoring
- `backend/locations.json`
  - starter location dataset

### API endpoints

- `GET /`
  - serves the frontend page
- `GET /api/config`
  - returns whether the Google API key is configured
- `POST /api/game/new`
  - starts a new 5-round game
- `GET /api/game/{game_id}`
  - returns the current round or final game state
- `POST /api/game/{game_id}/guess`
  - submits a guess and returns the result

## How the frontend works

The frontend lives in `frontend/`:

- `frontend/index.html`
  - main page structure
- `frontend/app.js`
  - game flow
  - Google Maps loading
  - round rendering
  - guess submission
- `frontend/styles.css`
  - visual styling

The frontend:

- fetches config from the backend
- loads the Google Maps JavaScript API
- requests new rounds from the backend
- builds Street View Static image URLs
- submits guesses and displays scores

## Current limitations

This is an MVP scaffold, so a few things are intentionally simple:

- no database
- no user accounts
- no saved games
- no multiplayer
- no admin tools
- small hardcoded location dataset
- API key currently exposed to the browser, which is expected for Maps JavaScript API usage

## Next steps

Good next improvements would be:

- add SQLite persistence
- save completed games and scores
- add user accounts
- expand `locations.json`
- support categories or map packs
- improve scoring curves
- move from landmark-only rounds to a broader Street View location set

## Troubleshooting

### Editable install fails with package discovery errors

If you saw an error about:

```text
Multiple top-level packages discovered in a flat-layout
```

that was caused by setuptools trying to package both `backend/` and `frontend/`. The project is now configured to package only the Python backend, so rerun:

```powershell
.venv\Scripts\python.exe -m pip install -e .
```

### The app says the Google API key is missing

Make sure:

- `.env` exists in the repo root
- it contains `GOOGLE_MAPS_API_KEY=...`
- the server was restarted after editing `.env`

### Google Maps loads but Street View does not

Check:

- the correct APIs are enabled
- billing is enabled
- your API key restrictions allow local development
- the key is valid for the APIs used by this app

## Development notes

This project is structured so the backend can stay simple now and grow later. The intended progression is:

1. get the game loop working
2. refine gameplay and location data
3. add persistence
4. add user management

That keeps the early work focused on the core experience rather than infrastructure too soon.
