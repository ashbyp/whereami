from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "whereami.db"


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Database:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_salt TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    avatar_url TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id TEXT,
                    guest_name TEXT,
                    guest_avatar TEXT,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS game_results (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    guest_name TEXT,
                    difficulty TEXT NOT NULL,
                    total_score INTEGER NOT NULL,
                    elapsed_seconds INTEGER NOT NULL,
                    completed_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
                """
            )

    def _hash_password(self, password: str, salt: str) -> str:
        password_bytes = password.encode("utf-8")
        salt_bytes = salt.encode("utf-8")
        return hashlib.pbkdf2_hmac(
            "sha256",
            password_bytes,
            salt_bytes,
            120_000,
        ).hex()

    def _serialize_user(self, row: sqlite3.Row) -> dict[str, Any]:
        row_keys = set(row.keys())
        user_id_key = "user_id" if "user_id" in row_keys else "id"
        email_key = "user_email" if "user_email" in row_keys else "email"
        avatar_key = "user_avatar_url" if "user_avatar_url" in row_keys else "avatar_url"

        email = row[email_key]
        display_name = email.split("@", 1)[0]
        return {
            "kind": "user",
            "id": row[user_id_key],
            "email": email,
            "display_name": display_name,
            "avatar_url": row[avatar_key] or "",
        }

    def _serialize_guest(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "kind": "guest",
            "id": f"guest:{row['token']}",
            "email": "",
            "display_name": row["guest_name"] or "Guest",
            "avatar_url": row["guest_avatar"] or "",
        }

    def create_user(self, email: str, password: str, avatar_url: str = "") -> dict[str, Any]:
        user_id = str(uuid4())
        salt = secrets.token_hex(16)
        password_hash = self._hash_password(password, salt)
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO users (id, email, password_salt, password_hash, avatar_url, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, email.lower(), salt, password_hash, avatar_url, utc_now()),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("An account with that email already exists.") from exc
        return self.get_user_by_id(user_id)

    def get_user_by_id(self, user_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            raise KeyError("User not found.")
        return self._serialize_user(row)

    def authenticate_user(self, email: str, password: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE email = ?",
                (email.lower(),),
            ).fetchone()
        if row is None:
            raise ValueError("Invalid email or password.")

        expected_hash = self._hash_password(password, row["password_salt"])
        if not hmac.compare_digest(expected_hash, row["password_hash"]):
            raise ValueError("Invalid email or password.")
        return self._serialize_user(row)

    def create_session(
        self,
        *,
        user_id: str | None = None,
        guest_name: str | None = None,
        guest_avatar: str = "",
    ) -> str:
        token = secrets.token_urlsafe(32)
        now = utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO sessions (token, user_id, guest_name, guest_avatar, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token, user_id, guest_name, guest_avatar, now, now),
            )
        return token

    def create_guest_session(self, guest_name: str | None = None) -> dict[str, Any]:
        suffix = secrets.randbelow(9000) + 1000
        name = guest_name.strip() if guest_name else f"Guest {suffix}"
        token = self.create_session(user_id=None, guest_name=name)
        return self.get_session(token)

    def get_session(self, token: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    sessions.token,
                    sessions.user_id AS session_user_id,
                    sessions.guest_name,
                    sessions.guest_avatar,
                    users.id AS user_id,
                    users.email AS user_email,
                    users.avatar_url AS user_avatar_url
                FROM sessions
                LEFT JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()
            if row is None:
                raise KeyError("Session not found.")
            connection.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE token = ?",
                (utc_now(), token),
            )

        user = self._serialize_user(row) if row["user_id"] else self._serialize_guest(row)
        return {
            "token": row["token"],
            "user": user,
        }

    def delete_session(self, token: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token = ?", (token,))

    def update_avatar(self, user_id: str, avatar_url: str) -> dict[str, Any]:
        with self._connect() as connection:
            connection.execute(
                "UPDATE users SET avatar_url = ? WHERE id = ?",
                (avatar_url, user_id),
            )
        return self.get_user_by_id(user_id)

    def record_game_result(
        self,
        *,
        user_id: str | None,
        guest_name: str | None,
        mode: str,
        total_score: int,
        elapsed_seconds: int,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO game_results (id, user_id, guest_name, difficulty, total_score, elapsed_seconds, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    user_id,
                    guest_name,
                    mode,
                    total_score,
                    elapsed_seconds,
                    utc_now(),
                ),
            )

    def get_best_scores(self, user_id: str) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT difficulty AS mode, MAX(total_score) AS best_score
                FROM game_results
                WHERE user_id = ?
                GROUP BY difficulty
                """,
                (user_id,),
            ).fetchall()
        return {row["mode"]: int(row["best_score"]) for row in rows}

    def clear_best_score(self, user_id: str, mode: str) -> None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id
                FROM game_results
                WHERE user_id = ? AND difficulty = ?
                ORDER BY total_score DESC, completed_at ASC
                LIMIT 1
                """,
                (user_id, mode),
            ).fetchone()
            if row is None:
                return
            connection.execute(
                "DELETE FROM game_results WHERE id = ?",
                (row["id"],),
            )

    # Backward-compatible aliases for older callers.
    def get_best_times(self, user_id: str) -> dict[str, int]:
        return self.get_best_scores(user_id)

    def clear_best_time(self, user_id: str, mode: str) -> None:
        self.clear_best_score(user_id, mode)
