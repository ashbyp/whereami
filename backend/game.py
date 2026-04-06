from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .scoring import haversine_distance_meters, score_guess

LOCATIONS_PATH = Path(__file__).with_name("locations.json")
ROUNDS_PER_GAME = 5
DIFFICULTY_LEVELS = ("easy", "medium", "hard", "impossible")
SUBJECTS: tuple[dict[str, str], ...] = (
    {"id": "european-capitals", "label": "European Capitals"},
    {"id": "us-states", "label": "US States"},
    {"id": "world-capitals", "label": "World Capitals"},
    {"id": "towns-in-england", "label": "Towns In England"},
    {"id": "uk-countryside", "label": "UK Countryside"},
)
SUBJECT_IDS = tuple(subject["id"] for subject in SUBJECTS)
SUBJECT_RULE_DIFFICULTY = "medium"
GAME_MODES: tuple[dict[str, str], ...] = (
    {"id": "easy", "label": "Easy"},
    {"id": "medium", "label": "Medium"},
    {"id": "hard", "label": "Hard"},
    {"id": "impossible", "label": "Impossible"},
    *SUBJECTS,
)
GAME_MODE_LABELS = {mode["id"]: mode["label"] for mode in GAME_MODES}

DIFFICULTY_RULES: dict[str, dict[str, Any]] = {
    "easy": {
        "movement_allowed": True,
        "zoom_allowed": True,
        "heading_variation": 25,
        "radius_multiplier": 0.75,
    },
    "medium": {
        "movement_allowed": True,
        "zoom_allowed": True,
        "heading_variation": 40,
        "radius_multiplier": 1.0,
    },
    "hard": {
        "movement_allowed": False,
        "zoom_allowed": True,
        "heading_variation": 70,
        "radius_multiplier": 1.25,
    },
    "impossible": {
        "movement_allowed": False,
        "zoom_allowed": False,
        "heading_variation": 110,
        "radius_multiplier": 1.5,
    },
}


@dataclass
class RoundState:
    round_id: str
    location: dict[str, Any]
    guessed: bool = False


@dataclass
class GameState:
    game_id: str
    owner_token: str
    mode: str
    rules_difficulty: str
    rounds: list[RoundState]
    started_at: float
    current_round_index: int = 0
    total_score: int = 0

    @property
    def current_round(self) -> RoundState | None:
        if self.current_round_index >= len(self.rounds):
            return None
        return self.rounds[self.current_round_index]


class GameStore:
    def __init__(self, locations_path: Path = LOCATIONS_PATH) -> None:
        with locations_path.open("r", encoding="utf-8") as handle:
            self._locations: list[dict[str, Any]] = json.load(handle)
        self._games: dict[str, GameState] = {}

    def create_game(self, owner_token: str, mode: str) -> GameState:
        if mode not in GAME_MODE_LABELS:
            msg = f"Mode must be one of: {', '.join(GAME_MODE_LABELS)}."
            raise ValueError(msg)

        if mode in DIFFICULTY_LEVELS:
            rules_difficulty = mode
            eligible_locations = [
                location
                for location in self._locations
                if rules_difficulty in location.get("difficulties", [])
            ]
        else:
            rules_difficulty = SUBJECT_RULE_DIFFICULTY
            eligible_locations = [
                location
                for location in self._locations
                if mode in location.get("subjects", [])
            ]
        if len(eligible_locations) < ROUNDS_PER_GAME:
            msg = f"Not enough locations configured for '{mode}'."
            raise ValueError(msg)

        sampled_locations = random.sample(eligible_locations, k=ROUNDS_PER_GAME)
        rounds = [
            RoundState(
                round_id=str(uuid4()),
                location=self._build_round_location(location, rules_difficulty),
            )
            for location in sampled_locations
        ]

        game = GameState(
            game_id=str(uuid4()),
            owner_token=owner_token,
            mode=mode,
            rules_difficulty=rules_difficulty,
            rounds=rounds,
            started_at=time.time(),
        )
        self._games[game.game_id] = game
        return game

    def _build_round_location(
        self,
        seed_location: dict[str, Any],
        difficulty: str,
    ) -> dict[str, Any]:
        rules = DIFFICULTY_RULES[difficulty]
        radius_meters = seed_location.get("radius_meters", 900) * rules["radius_multiplier"]
        lat, lng = self._random_offset(
            seed_location["lat"],
            seed_location["lng"],
            radius_meters=radius_meters,
        )

        heading = (
            seed_location.get("heading", random.randint(0, 359))
            + random.randint(-rules["heading_variation"], rules["heading_variation"])
        ) % 360

        return {
            **seed_location,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "heading": heading,
            "difficulty": difficulty,
            "movement_allowed": rules["movement_allowed"],
            "zoom_allowed": rules["zoom_allowed"],
            "zoom": 1 if rules["zoom_allowed"] else 0,
        }

    def _random_offset(
        self,
        lat: float,
        lng: float,
        radius_meters: float,
    ) -> tuple[float, float]:
        # Uniform random point inside a circle around the seed coordinate.
        distance = radius_meters * math.sqrt(random.random())
        bearing = random.random() * 2 * math.pi

        delta_north = math.cos(bearing) * distance
        delta_east = math.sin(bearing) * distance

        lat_offset = delta_north / 111_320
        lng_scale = 111_320 * math.cos(math.radians(lat))
        lng_offset = 0 if abs(lng_scale) < 1e-6 else delta_east / lng_scale

        return lat + lat_offset, lng + lng_offset

    def get_game(self, game_id: str, owner_token: str) -> GameState:
        game = self._games[game_id]
        if game.owner_token != owner_token:
            raise KeyError("Game not found.")
        return game

    def elapsed_seconds(self, game: GameState) -> int:
        return max(0, int(time.time() - game.started_at))

    def build_round_payload(self, game: GameState) -> dict[str, Any]:
        current_round = game.current_round
        if current_round is None:
            return {
                "game_id": game.game_id,
                "mode": game.mode,
                "mode_label": GAME_MODE_LABELS[game.mode],
                "status": "finished",
                "round_number": len(game.rounds),
                "total_score": game.total_score,
                "elapsed_seconds": self.elapsed_seconds(game),
            }

        location = current_round.location
        return {
            "game_id": game.game_id,
            "mode": game.mode,
            "mode_label": GAME_MODE_LABELS[game.mode],
            "status": "in_progress",
            "round_id": current_round.round_id,
            "round_number": game.current_round_index + 1,
            "rounds_total": len(game.rounds),
            "elapsed_seconds": self.elapsed_seconds(game),
            "prompt": {
                "lat": location["lat"],
                "lng": location["lng"],
                "heading": location.get("heading", 0),
                "pitch": location.get("pitch", 0),
                "zoom": location.get("zoom", 1),
                "movement_allowed": location.get("movement_allowed", True),
                "zoom_allowed": location.get("zoom_allowed", True),
            },
            "total_score": game.total_score,
        }

    def submit_guess(
        self,
        game_id: str,
        owner_token: str,
        round_id: str,
        guess_lat: float,
        guess_lng: float,
    ) -> dict[str, Any]:
        game = self.get_game(game_id, owner_token)
        current_round = game.current_round
        if current_round is None:
            msg = "Game is already finished."
            raise ValueError(msg)
        if current_round.round_id != round_id:
            msg = "Round does not match the active round."
            raise ValueError(msg)
        if current_round.guessed:
            msg = "Round has already been scored."
            raise ValueError(msg)

        location = current_round.location
        distance_meters = haversine_distance_meters(
            guess_lat,
            guess_lng,
            location["lat"],
            location["lng"],
        )
        round_score = score_guess(distance_meters)
        game.total_score += round_score
        current_round.guessed = True
        game.current_round_index += 1

        return {
            "game_id": game.game_id,
            "round_id": current_round.round_id,
            "distance_meters": round(distance_meters, 2),
            "round_score": round_score,
            "total_score": game.total_score,
            "elapsed_seconds": self.elapsed_seconds(game),
            "actual": {
                "lat": location["lat"],
                "lng": location["lng"],
                "label": location["label"],
                "country": location["country"],
            },
            "next_round_available": game.current_round is not None,
        }
