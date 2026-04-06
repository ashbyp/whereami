const state = {
  apiKey: "",
  gameId: null,
  roundId: null,
  difficulty: "easy",
  difficulties: [],
  totalScore: 0,
  startView: null,
  guessMarker: null,
  guessLatLng: null,
  actualMarker: null,
  resultLine: null,
  map: null,
  google: null,
  panorama: null,
  streetViewService: null,
  ready: false,
  mapPinnedOpen: false,
};

const elements = {
  startGame: document.querySelector("#start-game"),
  backToStart: document.querySelector("#back-to-start"),
  submitGuess: document.querySelector("#submit-guess"),
  statusMessage: document.querySelector("#status-message"),
  roundCounter: document.querySelector("#round-counter"),
  scoreCounter: document.querySelector("#score-counter"),
  difficultyPicker: document.querySelector("#difficulty-picker"),
  toggleMapSize: document.querySelector("#toggle-map-size"),
  mapOverlay: document.querySelector("#map-overlay"),
  nextRoundInline: document.querySelector("#next-round-inline"),
  streetViewFrame: document.querySelector("#street-view-frame"),
  streetViewCanvas: document.querySelector("#street-view-canvas"),
  streetViewEmpty: document.querySelector("#street-view-empty"),
  mapResult: document.querySelector("#map-result"),
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
      elements.statusMessage.textContent = "Missing Google Maps API key.";
      return;
    }

    state.apiKey = config.google_maps_api_key;
    state.difficulties = config.difficulties || [];
    await loadGoogleMapsScript(state.apiKey);
    hydrateDifficultyPicker();
    createMap();
    createPanorama();
    state.ready = true;
    elements.startGame.disabled = false;
    elements.statusMessage.textContent = "";
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

function hydrateDifficultyPicker() {
  const chips = elements.difficultyPicker.querySelectorAll("[data-difficulty]");
  for (const chip of chips) {
    const difficulty = chip.dataset.difficulty;
    chip.hidden = !state.difficulties.includes(difficulty);
    chip.classList.toggle("active", difficulty === state.difficulty);
  }
}

function syncMapSize() {
  if (!state.google || !state.map) {
    return;
  }

  window.setTimeout(() => {
    state.google.maps.event.trigger(state.map, "resize");
  }, 0);

  window.setTimeout(() => {
    state.google.maps.event.trigger(state.map, "resize");
  }, 240);
}

function toggleMapSize() {
  state.mapPinnedOpen = !state.mapPinnedOpen;
  setMapExpanded(state.mapPinnedOpen);
}

function setMapExpanded(expanded) {
  elements.mapOverlay.classList.toggle("expanded", expanded);
  elements.toggleMapSize.textContent = expanded ? "Close" : "Open";
  elements.toggleMapSize.setAttribute("aria-expanded", String(state.mapPinnedOpen));
  syncMapSize();
}

function createPanorama() {
  state.streetViewService = new state.google.maps.StreetViewService();
  state.panorama = new state.google.maps.StreetViewPanorama(
    elements.streetViewCanvas,
    {
      addressControl: false,
      clickToGo: true,
      fullscreenControl: false,
      linksControl: true,
      motionTracking: false,
      showRoadLabels: false,
      disableDefaultUI: false,
      visible: true,
    }
  );
}

function applyPromptRules(prompt) {
  if (!state.panorama) {
    return;
  }

  state.panorama.setOptions({
    clickToGo: prompt.movement_allowed,
    linksControl: prompt.movement_allowed,
    panControl: true,
    zoomControl: prompt.zoom_allowed,
    scrollwheel: prompt.zoom_allowed,
  });
}

function clearRoundMarkers() {
  if (state.guessMarker) {
    state.guessMarker.setMap(null);
    state.guessMarker = null;
  }
  if (state.actualMarker) {
    state.actualMarker.setMap(null);
    state.actualMarker = null;
  }
  if (state.resultLine) {
    state.resultLine.setMap(null);
    state.resultLine = null;
  }
}

function showStreetViewMessage(message) {
  elements.streetViewFrame.classList.add("empty-state");
  elements.streetViewEmpty.textContent = message;
}

function showStreetViewCanvas() {
  elements.streetViewFrame.classList.remove("empty-state");
  elements.streetViewEmpty.textContent = "";
}

function loadPanorama(prompt) {
  return new Promise((resolve, reject) => {
    state.streetViewService.getPanorama(
      {
        location: { lat: prompt.lat, lng: prompt.lng },
        radius: 250,
        source: state.google.maps.StreetViewSource.OUTDOOR,
        preference: state.google.maps.StreetViewPreference.NEAREST,
      },
      (data, status) => {
        if (status !== "OK" || !data?.location?.latLng) {
          reject(new Error("No Street View coverage was found for this round."));
          return;
        }

        state.panorama.setOptions({
          pano: data.location.pano,
          pov: {
            heading: prompt.heading,
            pitch: prompt.pitch,
          },
          linksControl: true,
          zoom: prompt.zoom,
        });
        state.startView = {
          pano: data.location.pano,
          pov: {
            heading: prompt.heading,
            pitch: prompt.pitch,
          },
          zoom: prompt.zoom,
        };
        resolve();
      }
    );
  });
}

function resetToStartView() {
  if (!state.panorama || !state.startView) {
    return;
  }

  state.panorama.setOptions({
    pano: state.startView.pano,
    pov: state.startView.pov,
    zoom: state.startView.zoom,
  });
}

async function renderRound(round) {
  state.roundId = round.round_id;
  state.difficulty = round.difficulty || state.difficulty;
  state.totalScore = round.total_score;
  state.startView = null;
  state.guessLatLng = null;
  state.mapPinnedOpen = false;
  setMapExpanded(false);
  elements.backToStart.disabled = true;
  elements.submitGuess.disabled = true;
  elements.mapResult.classList.add("hidden");
  elements.nextRoundInline.classList.add("hidden");
  elements.roundCounter.textContent =
    `Round ${round.round_number} / ${round.rounds_total}`;
  elements.scoreCounter.textContent = `Score ${round.total_score}`;
  hydrateDifficultyPicker();
  clearRoundMarkers();

  try {
    showStreetViewCanvas();
    applyPromptRules(round.prompt);
    await loadPanorama(round.prompt);
    elements.backToStart.disabled = false;
  } catch (error) {
    showStreetViewMessage(error.message);
    throw error;
  }
}

async function startGame() {
  if (!state.ready) {
    elements.statusMessage.textContent = "Loading Google Maps...";
    return;
  }

  elements.statusMessage.textContent = "Creating a new game...";
  const round = await fetchJson("/api/game/new", {
    method: "POST",
    body: JSON.stringify({ difficulty: state.difficulty }),
  });
  state.gameId = round.game_id;
  await renderRound(round);
  elements.statusMessage.textContent = "";
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
    icon: {
      path: state.google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: "#1b6b5c",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
    },
  });

  state.resultLine = new state.google.maps.Polyline({
    map: state.map,
    path: [state.guessLatLng, result.actual],
    geodesic: true,
    strokeColor: "#12483f",
    strokeOpacity: 0.9,
    strokeWeight: 3,
  });

  const bounds = new state.google.maps.LatLngBounds();
  bounds.extend(state.guessLatLng);
  bounds.extend(result.actual);
  state.map.fitBounds(bounds);

  const distanceKm = (result.distance_meters / 1000).toFixed(1);
  elements.resultSummary.textContent =
    `${result.actual.label}, ${result.actual.country}. ` +
    `You were ${distanceKm} km away and scored ${result.round_score} points.`;
  elements.mapResult.classList.remove("hidden");
  elements.nextRoundInline.classList.remove("hidden");
  elements.nextRoundInline.textContent = result.next_round_available
    ? "Next round"
    : "See final score";
  elements.statusMessage.textContent = result.next_round_available
    ? ""
    : `Game complete. Final score: ${result.total_score}.`;
  setMapExpanded(true);
}

async function nextRound() {
  if (!state.gameId) {
    return;
  }

  const round = await fetchJson(`/api/game/${state.gameId}`);
  if (round.status === "finished") {
    elements.resultSummary.textContent =
      `Game finished with ${round.total_score} points across ${round.round_number} rounds.`;
    elements.mapResult.classList.remove("hidden");
    elements.nextRoundInline.classList.remove("hidden");
    elements.nextRoundInline.textContent = "Start over";
    state.gameId = null;
    state.roundId = null;
    return;
  }

  await renderRound(round);
  elements.statusMessage.textContent = "";
}

elements.startGame.addEventListener("click", () => {
  startGame().catch((error) => {
    elements.statusMessage.textContent = error.message;
  });
});

elements.backToStart.addEventListener("click", () => {
  resetToStartView();
});

elements.difficultyPicker.addEventListener("click", (event) => {
  const target = event.target.closest("[data-difficulty]");
  if (!target) {
    return;
  }

  state.difficulty = target.dataset.difficulty;
  hydrateDifficultyPicker();
});

elements.toggleMapSize.addEventListener("click", () => {
  toggleMapSize();
});

elements.mapOverlay.addEventListener("mouseenter", () => {
  if (!state.mapPinnedOpen) {
    setMapExpanded(true);
  }
});

elements.mapOverlay.addEventListener("mouseleave", () => {
  if (!state.mapPinnedOpen) {
    setMapExpanded(false);
  }
});

elements.submitGuess.addEventListener("click", () => {
  submitGuess().catch((error) => {
    elements.statusMessage.textContent = error.message;
  });
});

elements.nextRoundInline.addEventListener("click", () => {
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
