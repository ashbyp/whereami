from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .scoring import haversine_distance_meters, score_guess

LOCATIONS_PATH = Path(__file__).with_name("locations.json")
ROUNDS_PER_GAME = 5


@dataclass
class RoundState:
    round_id: str
    location: dict[str, Any]
    guessed: bool = False


@dataclass
class GameState:
    game_id: str
    rounds: list[RoundState]
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

    def create_game(self) -> GameState:
        if len(self._locations) < ROUNDS_PER_GAME:
            msg = "locations.json must contain at least five locations."
            raise ValueError(msg)

        sampled_locations = random.sample(self._locations, k=ROUNDS_PER_GAME)
        rounds = [
            RoundState(
                round_id=str(uuid4()),
                location=self._build_round_location(location),
            )
            for location in sampled_locations
        ]

        game = GameState(game_id=str(uuid4()), rounds=rounds)
        self._games[game.game_id] = game
        return game

    def _build_round_location(self, seed_location: dict[str, Any]) -> dict[str, Any]:
        radius_meters = seed_location.get("radius_meters", 900)
        lat, lng = self._random_offset(
            seed_location["lat"],
            seed_location["lng"],
            radius_meters=radius_meters,
        )

        heading = (seed_location.get("heading", random.randint(0, 359)) +
                   random.randint(-45, 45)) % 360

        return {
            **seed_location,
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "heading": heading,
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

    def get_game(self, game_id: str) -> GameState:
        return self._games[game_id]

    def build_round_payload(self, game: GameState) -> dict[str, Any]:
        current_round = game.current_round
        if current_round is None:
            return {
                "game_id": game.game_id,
                "status": "finished",
                "round_number": len(game.rounds),
                "total_score": game.total_score,
            }

        location = current_round.location
        return {
            "game_id": game.game_id,
            "status": "in_progress",
            "round_id": current_round.round_id,
            "round_number": game.current_round_index + 1,
            "rounds_total": len(game.rounds),
            "prompt": {
                "lat": location["lat"],
                "lng": location["lng"],
                "heading": location.get("heading", 0),
                "pitch": location.get("pitch", 0),
                "zoom": location.get("zoom", 1),
            },
            "total_score": game.total_score,
        }

    def submit_guess(
        self,
        game_id: str,
        round_id: str,
        guess_lat: float,
        guess_lng: float,
    ) -> dict[str, Any]:
        game = self.get_game(game_id)
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
            "actual": {
                "lat": location["lat"],
                "lng": location["lng"],
                "label": location["label"],
                "country": location["country"],
            },
            "next_round_available": game.current_round is not None,
        }
