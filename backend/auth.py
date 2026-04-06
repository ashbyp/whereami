from __future__ import annotations

from typing import Any

from .db import Database


class AuthService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def register(self, email: str, password: str, avatar_url: str = "") -> dict[str, Any]:
        if "@" not in email:
            raise ValueError("Enter a valid email address.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")

        user = self.database.create_user(email, password, avatar_url)
        token = self.database.create_session(user_id=user["id"])
        return {
            "token": token,
            "user": user,
            "best_times": {},
        }

    def login(self, email: str, password: str) -> dict[str, Any]:
        user = self.database.authenticate_user(email, password)
        token = self.database.create_session(user_id=user["id"])
        return {
            "token": token,
            "user": user,
            "best_times": self.database.get_best_times(user["id"]),
        }

    def guest(self, guest_name: str = "") -> dict[str, Any]:
        session = self.database.create_guest_session(guest_name or None)
        return {
            "token": session["token"],
            "user": session["user"],
            "best_times": {},
        }

    def get_session(self, token: str) -> dict[str, Any]:
        session = self.database.get_session(token)
        user = session["user"]
        best_times = (
            self.database.get_best_times(user["id"])
            if user["kind"] == "user"
            else {}
        )
        return {
            "token": session["token"],
            "user": user,
            "best_times": best_times,
        }

    def update_avatar(self, token: str, avatar_url: str) -> dict[str, Any]:
        session = self.database.get_session(token)
        user = session["user"]
        if user["kind"] != "user":
            raise ValueError("Guests cannot save avatars.")
        updated_user = self.database.update_avatar(user["id"], avatar_url)
        return {
            "token": token,
            "user": updated_user,
            "best_times": self.database.get_best_times(updated_user["id"]),
        }

    def logout(self, token: str) -> None:
        self.database.delete_session(token)

    def clear_best_time(self, token: str, difficulty: str) -> dict[str, Any]:
        session = self.database.get_session(token)
        user = session["user"]
        if user["kind"] != "user":
            raise ValueError("Guests do not have saved best times.")
        self.database.clear_best_time(user["id"], difficulty)
        return {
            "token": token,
            "user": user,
            "best_times": self.database.get_best_times(user["id"]),
        }
