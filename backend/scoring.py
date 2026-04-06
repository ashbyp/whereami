from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_METERS = 6_371_000
MAX_ROUND_SCORE = 5_000


def haversine_distance_meters(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
) -> float:
    lat1_rad = radians(lat1)
    lng1_rad = radians(lng1)
    lat2_rad = radians(lat2)
    lng2_rad = radians(lng2)

    delta_lat = lat2_rad - lat1_rad
    delta_lng = lng2_rad - lng1_rad

    haversine = (
        sin(delta_lat / 2) ** 2
        + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lng / 2) ** 2
    )
    central_angle = 2 * asin(sqrt(haversine))
    return EARTH_RADIUS_METERS * central_angle


def score_guess(distance_meters: float) -> int:
    distance_km = distance_meters / 1_000
    score = round(MAX_ROUND_SCORE * (2.71828 ** (-distance_km / 2_000)))
    return max(0, min(MAX_ROUND_SCORE, score))

