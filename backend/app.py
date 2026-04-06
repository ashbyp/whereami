from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from .auth import AuthService
from .db import Database
from .game import DIFFICULTY_LEVELS, GameStore

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = BASE_DIR / "backend" / "uploads"

load_dotenv(BASE_DIR / ".env")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="whereami")
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

database = Database()
auth_service = AuthService(database)
game_store = GameStore()


class GuessRequest(BaseModel):
    round_id: str
    guess_lat: float
    guess_lng: float


class NewGameRequest(BaseModel):
    difficulty: str = "easy"


class AuthRequest(BaseModel):
    email: str
    password: str


class GuestRequest(BaseModel):
    guest_name: str = ""


def require_session(x_session_token: str | None) -> dict[str, Any]:
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Sign in or continue as guest first.")
    try:
        return auth_service.get_session(x_session_token)
    except KeyError as exc:
        raise HTTPException(status_code=401, detail="Session expired.") from exc


async def save_avatar_upload(avatar: UploadFile | None) -> str:
    if avatar is None or not avatar.filename:
        return ""

    content_type = avatar.content_type or ""
    if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(status_code=400, detail="Avatar must be a JPG, PNG, GIF, or WebP image.")

    extension_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    extension = extension_map[content_type]
    filename = f"{uuid4()}{extension}"
    target = UPLOADS_DIR / filename
    data = await avatar.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Avatar must be smaller than 3MB.")
    target.write_bytes(data)
    return f"/uploads/{filename}"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    return {
        "google_maps_api_key": api_key,
        "configured": bool(api_key),
        "difficulties": list(DIFFICULTY_LEVELS),
    }


@app.post("/api/auth/register")
async def register(
    email: str = Form(...),
    password: str = Form(...),
    avatar: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    try:
        avatar_url = await save_avatar_upload(avatar)
        return auth_service.register(email, password, avatar_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/auth/login")
def login(payload: AuthRequest) -> dict[str, Any]:
    try:
        return auth_service.login(payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/auth/guest")
def guest(payload: GuestRequest) -> dict[str, Any]:
    return auth_service.guest(payload.guest_name)


@app.get("/api/auth/me")
def me(x_session_token: str | None = Header(default=None)) -> dict[str, Any]:
    return require_session(x_session_token)


@app.put("/api/auth/profile")
async def update_profile(
    avatar: UploadFile | None = File(default=None),
    x_session_token: str | None = Header(default=None),
) -> dict[str, Any]:
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Missing session.")
    try:
        avatar_url = await save_avatar_upload(avatar)
        if not avatar_url:
            raise HTTPException(status_code=400, detail="Choose an image to upload.")
        return auth_service.update_avatar(x_session_token, avatar_url)
    except KeyError as exc:
        raise HTTPException(status_code=401, detail="Session expired.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/auth/logout")
def logout(x_session_token: str | None = Header(default=None)) -> dict[str, bool]:
    if x_session_token:
        auth_service.logout(x_session_token)
    return {"ok": True}


@app.post("/api/game/new")
def new_game(
    payload: NewGameRequest,
    x_session_token: str | None = Header(default=None),
) -> dict[str, object]:
    session = require_session(x_session_token)
    try:
        game = game_store.create_game(session["token"], payload.difficulty)
        return game_store.build_round_payload(game)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/game/{game_id}")
def get_game(
    game_id: str,
    x_session_token: str | None = Header(default=None),
) -> dict[str, object]:
    session = require_session(x_session_token)
    try:
        game = game_store.get_game(game_id, session["token"])
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Game not found.") from exc
    return game_store.build_round_payload(game)


@app.post("/api/game/{game_id}/guess")
def submit_guess(
    game_id: str,
    payload: GuessRequest,
    x_session_token: str | None = Header(default=None),
) -> dict[str, object]:
    session = require_session(x_session_token)
    try:
        result = game_store.submit_guess(
            game_id=game_id,
            owner_token=session["token"],
            round_id=payload.round_id,
            guess_lat=payload.guess_lat,
            guess_lng=payload.guess_lng,
        )
        if not result["next_round_available"]:
            user = session["user"]
            database.record_game_result(
                user_id=user["id"] if user["kind"] == "user" else None,
                guest_name=user["display_name"] if user["kind"] == "guest" else None,
                difficulty=game_store.get_game(game_id, session["token"]).difficulty,
                total_score=result["total_score"],
                elapsed_seconds=result["elapsed_seconds"],
            )
            result["best_times"] = (
                database.get_best_times(user["id"]) if user["kind"] == "user" else {}
            )
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Game not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
