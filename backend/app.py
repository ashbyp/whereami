from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from .game import GameStore

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="whereami")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")

game_store = GameStore()


class GuessRequest(BaseModel):
    round_id: str
    guess_lat: float
    guess_lng: float


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/config")
def get_config() -> dict[str, str | bool]:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    return {
        "google_maps_api_key": api_key,
        "configured": bool(api_key),
    }


@app.post("/api/game/new")
def new_game() -> dict[str, object]:
    game = game_store.create_game()
    return game_store.build_round_payload(game)


@app.get("/api/game/{game_id}")
def get_game(game_id: str) -> dict[str, object]:
    try:
        game = game_store.get_game(game_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Game not found.") from exc
    return game_store.build_round_payload(game)


@app.post("/api/game/{game_id}/guess")
def submit_guess(game_id: str, payload: GuessRequest) -> dict[str, object]:
    try:
        return game_store.submit_guess(
            game_id=game_id,
            round_id=payload.round_id,
            guess_lat=payload.guess_lat,
            guess_lng=payload.guess_lng,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Game not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
