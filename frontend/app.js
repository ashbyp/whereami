const state = {
  apiKey: "",
  gameId: null,
  roundId: null,
  totalScore: 0,
  guessMarker: null,
  guessLatLng: null,
  actualMarker: null,
  map: null,
  google: null,
};

const elements = {
  startGame: document.querySelector("#start-game"),
  submitGuess: document.querySelector("#submit-guess"),
  nextRound: document.querySelector("#next-round"),
  statusMessage: document.querySelector("#status-message"),
  roundCounter: document.querySelector("#round-counter"),
  scoreCounter: document.querySelector("#score-counter"),
  streetViewFrame: document.querySelector("#street-view-frame"),
  resultPanel: document.querySelector("#result-panel"),
  resultSummary: document.querySelector("#result-summary"),
  map: document.querySelector("#map"),
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Request failed.");
  }

  return response.json();
}

async function bootstrap() {
  try {
    const config = await fetchJson("/api/config");
    if (!config.configured) {
      elements.statusMessage.textContent =
        "Set GOOGLE_MAPS_API_KEY before starting the game.";
      return;
    }

    state.apiKey = config.google_maps_api_key;
    await loadGoogleMapsScript(state.apiKey);
    createMap();
    elements.statusMessage.textContent =
      "Ready when you are. Start a game to get the first round.";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      state.google = window.google;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => {
      state.google = window.google;
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load Google Maps."));
    document.head.append(script);
  });
}

function createMap() {
  state.map = new state.google.maps.Map(elements.map, {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
  });

  state.map.addListener("click", (event) => {
    state.guessLatLng = event.latLng.toJSON();

    if (!state.guessMarker) {
      state.guessMarker = new state.google.maps.Marker({
        map: state.map,
      });
    }

    state.guessMarker.setPosition(state.guessLatLng);
    elements.submitGuess.disabled = false;
  });
}

function renderRound(round) {
  state.roundId = round.round_id;
  state.totalScore = round.total_score;
  state.guessLatLng = null;
  elements.submitGuess.disabled = true;
  elements.resultPanel.classList.add("hidden");
  elements.roundCounter.textContent =
    `Round ${round.round_number} / ${round.rounds_total}`;
  elements.scoreCounter.textContent = `Score ${round.total_score}`;

  if (state.guessMarker) {
    state.guessMarker.setMap(null);
    state.guessMarker = null;
  }
  if (state.actualMarker) {
    state.actualMarker.setMap(null);
    state.actualMarker = null;
  }

  const { lat, lng, heading, pitch, zoom } = round.prompt;
  const imageUrl =
    "https://maps.googleapis.com/maps/api/streetview" +
    `?size=1200x700&location=${lat},${lng}` +
    `&heading=${heading}&pitch=${pitch}&fov=${Math.max(30, 90 - zoom * 10)}` +
    `&key=${encodeURIComponent(state.apiKey)}`;

  elements.streetViewFrame.classList.remove("empty-state");
  elements.streetViewFrame.innerHTML =
    `<img src="${imageUrl}" alt="Street View prompt for the current round." />`;
}

async function startGame() {
  elements.statusMessage.textContent = "Creating a new game...";
  const round = await fetchJson("/api/game/new", { method: "POST" });
  state.gameId = round.game_id;
  renderRound(round);
  elements.statusMessage.textContent = "Round ready. Make your guess.";
}

async function submitGuess() {
  if (!state.guessLatLng || !state.gameId || !state.roundId) {
    return;
  }

  elements.submitGuess.disabled = true;

  const result = await fetchJson(`/api/game/${state.gameId}/guess`, {
    method: "POST",
    body: JSON.stringify({
      round_id: state.roundId,
      guess_lat: state.guessLatLng.lat,
      guess_lng: state.guessLatLng.lng,
    }),
  });

  state.totalScore = result.total_score;
  elements.scoreCounter.textContent = `Score ${result.total_score}`;

  state.actualMarker = new state.google.maps.Marker({
    map: state.map,
    position: result.actual,
    title: result.actual.label,
    icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png",
  });

  const bounds = new state.google.maps.LatLngBounds();
  bounds.extend(state.guessLatLng);
  bounds.extend(result.actual);
  state.map.fitBounds(bounds);

  const distanceKm = (result.distance_meters / 1000).toFixed(1);
  elements.resultSummary.textContent =
    `${result.actual.label}, ${result.actual.country}. ` +
    `You were ${distanceKm} km away and scored ${result.round_score} points.`;
  elements.resultPanel.classList.remove("hidden");
  elements.nextRound.textContent = result.next_round_available
    ? "Next round"
    : "See final score";
  elements.statusMessage.textContent = result.next_round_available
    ? "Nice. Move on when you're ready."
    : `Game complete. Final score: ${result.total_score}.`;
}

async function nextRound() {
  if (!state.gameId) {
    return;
  }

  const round = await fetchJson(`/api/game/${state.gameId}`);
  if (round.status === "finished") {
    elements.resultSummary.textContent =
      `Game finished with ${round.total_score} points across ${round.round_number} rounds.`;
    elements.resultPanel.classList.remove("hidden");
    elements.nextRound.textContent = "Start over";
    state.gameId = null;
    state.roundId = null;
    return;
  }

  renderRound(round);
  elements.statusMessage.textContent = "Next round loaded.";
}

elements.startGame.addEventListener("click", () => {
  startGame().catch((error) => {
    elements.statusMessage.textContent = error.message;
  });
});

elements.submitGuess.addEventListener("click", () => {
  submitGuess().catch((error) => {
    elements.statusMessage.textContent = error.message;
  });
});

elements.nextRound.addEventListener("click", () => {
  if (state.gameId) {
    nextRound().catch((error) => {
      elements.statusMessage.textContent = error.message;
    });
    return;
  }

  startGame().catch((error) => {
    elements.statusMessage.textContent = error.message;
  });
});

bootstrap();

