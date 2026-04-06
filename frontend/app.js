const state = {
  apiKey: "",
  sessionToken: window.localStorage.getItem("whereami.sessionToken") || "",
  user: null,
  bestTimes: {},
  roundResults: [],
  lastCompletedMode: "",
  gameId: null,
  roundId: null,
  mode: "easy",
  gameModes: [],
  totalScore: 0,
  timerBaseSeconds: 0,
  timerStartedAt: 0,
  timerHandle: null,
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
  initializing: false,
  mapPinnedOpen: false,
};

const LAST_EMAIL_KEY = "whereami.lastEmail";

const elements = {
  startGame: document.querySelector("#start-game"),
  registerButton: document.querySelector("#register-button"),
  loginButton: document.querySelector("#login-button"),
  guestButton: document.querySelector("#guest-button"),
  logoutButton: document.querySelector("#logout-button"),
  avatarButton: document.querySelector("#avatar-button"),
  backToStart: document.querySelector("#back-to-start"),
  submitGuess: document.querySelector("#submit-guess"),
  statusMessage: document.querySelector("#status-message"),
  roundCounter: document.querySelector("#round-counter"),
  scoreCounter: document.querySelector("#score-counter"),
  timerCounter: document.querySelector("#timer-counter"),
  authCard: document.querySelector("#auth-card"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authAvatar: document.querySelector("#auth-avatar"),
  profileAvatarInput: document.querySelector("#profile-avatar-input"),
  guestName: document.querySelector("#guest-name"),
  sessionSummary: document.querySelector("#session-summary"),
  sessionName: document.querySelector("#session-name"),
  sessionKind: document.querySelector("#session-kind"),
  avatarImage: document.querySelector("#avatar-image"),
  avatarFallback: document.querySelector("#avatar-fallback"),
  modePicker: document.querySelector("#mode-picker"),
  toggleMapSize: document.querySelector("#toggle-map-size"),
  mapOverlay: document.querySelector("#map-overlay"),
  nextRoundInline: document.querySelector("#next-round-inline"),
  streetViewFrame: document.querySelector("#street-view-frame"),
  streetViewCanvas: document.querySelector("#street-view-canvas"),
  streetViewEmpty: document.querySelector("#street-view-empty"),
  mapResult: document.querySelector("#map-result"),
  resultSummary: document.querySelector("#result-summary"),
  resultsModal: document.querySelector("#results-modal"),
  resultsModalSummary: document.querySelector("#results-modal-summary"),
  resultsModalMode: document.querySelector("#results-modal-mode"),
  resultsModalBestTimeRow: document.querySelector("#results-modal-best-time-row"),
  resultsModalBestTime: document.querySelector("#results-modal-best-time"),
  resultsModalBody: document.querySelector("#results-modal-body"),
  clearBestTime: document.querySelector("#clear-best-time"),
  closeResultsModal: document.querySelector("#close-results-modal"),
  map: document.querySelector("#map"),
};

async function fetchJson(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  if (state.sessionToken) {
    headers["X-Session-Token"] = state.sessionToken;
  }
  const response = await fetch(url, {
    headers,
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "Request failed.");
  }

  return response.json();
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initialsForUser(user) {
  if (!user?.display_name) {
    return "?";
  }
  return user.display_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("");
}

function renderSession() {
  const user = state.user;
  elements.startGame.disabled = !state.ready;

  if (!user) {
    elements.authCard.classList.remove("hidden");
    elements.sessionSummary.classList.add("hidden");
    return;
  }

  elements.authCard.classList.add("hidden");
  elements.sessionSummary.classList.remove("hidden");
  elements.sessionName.textContent = user.display_name;
  elements.sessionKind.textContent =
    user.kind === "guest" ? "Guest session" : user.email;
  elements.avatarButton.disabled = user.kind !== "user";

  if (user.avatar_url) {
    elements.avatarImage.src = user.avatar_url;
    elements.avatarImage.classList.remove("hidden");
    elements.avatarFallback.classList.add("hidden");
  } else {
    elements.avatarImage.classList.add("hidden");
    elements.avatarFallback.classList.remove("hidden");
    elements.avatarFallback.textContent = initialsForUser(user);
  }
}

function hydrateModePicker() {
  if (!elements.modePicker) {
    return;
  }
  const optionsMarkup = state.gameModes
    .map((mode) => `<option value="${mode.id}">${mode.label}</option>`)
    .join("");
  elements.modePicker.innerHTML = optionsMarkup;
  if (state.gameModes.some((mode) => mode.id === state.mode)) {
    elements.modePicker.value = state.mode;
  }
}

function renderResultsTable() {
  elements.resultsModalBody.innerHTML = "";
  for (const round of state.roundResults) {
    const row = document.createElement("tr");
    const roundCell = document.createElement("td");
    roundCell.textContent = String(round.roundNumber);
    const locationCell = document.createElement("td");
    locationCell.textContent = round.location;
    const distanceCell = document.createElement("td");
    distanceCell.textContent = round.distance;
    row.append(roundCell, locationCell, distanceCell);
    elements.resultsModalBody.appendChild(row);
  }
}

function formatModeLabel(modeId) {
  const mode = state.gameModes.find((entry) => entry.id === modeId);
  if (mode) {
    return mode.label;
  }
  if (!modeId) {
    return "";
  }
  return modeId.charAt(0).toUpperCase() + modeId.slice(1);
}

function syncResultsMeta() {
  elements.resultsModalMode.textContent = formatModeLabel(state.lastCompletedMode);

  const bestTime = state.bestTimes?.[state.lastCompletedMode];
  const showBestTime =
    state.user?.kind === "user" && typeof bestTime === "number";

  elements.resultsModalBestTimeRow.classList.toggle("hidden", !showBestTime);
  elements.clearBestTime.classList.toggle("hidden", !showBestTime);
  if (showBestTime) {
    elements.resultsModalBestTime.textContent = formatDuration(bestTime);
  } else {
    elements.resultsModalBestTime.textContent = "";
  }
}

function showResultsModal(message) {
  elements.resultsModalSummary.textContent = message;
  renderResultsTable();
  syncResultsMeta();
  elements.resultsModal.classList.remove("hidden");
}

function hideResultsModal() {
  elements.resultsModal.classList.add("hidden");
}

function loadRememberedEmail() {
  const rememberedEmail = window.localStorage.getItem(LAST_EMAIL_KEY) || "";
  if (rememberedEmail) {
    elements.authEmail.value = rememberedEmail;
  }
}

function rememberEmail(email) {
  const normalizedEmail = email.trim();
  if (normalizedEmail) {
    window.localStorage.setItem(LAST_EMAIL_KEY, normalizedEmail);
  } else {
    window.localStorage.removeItem(LAST_EMAIL_KEY);
  }
}

function storeSession(session) {
  state.sessionToken = session.token;
  state.user = session.user;
  state.bestTimes = session.best_times || {};
  window.localStorage.setItem("whereami.sessionToken", state.sessionToken);
  renderSession();
}

function clearSession() {
  state.sessionToken = "";
  state.user = null;
  state.bestTimes = {};
  state.roundResults = [];
  state.lastCompletedMode = "";
  state.gameId = null;
  state.roundId = null;
  window.localStorage.removeItem("whereami.sessionToken");
  stopTimer();
  elements.roundCounter.textContent = "0/5";
  elements.scoreCounter.textContent = "0";
  elements.timerCounter.textContent = "00:00";
  renderSession();
}

function startTimer(baseSeconds = 0) {
  stopTimer();
  state.timerBaseSeconds = baseSeconds;
  state.timerStartedAt = Date.now();
  const tick = () => {
    const elapsed = state.timerBaseSeconds + Math.floor((Date.now() - state.timerStartedAt) / 1000);
    elements.timerCounter.textContent = formatDuration(elapsed);
  };
  tick();
  state.timerHandle = window.setInterval(tick, 1000);
}

function stopTimer(finalSeconds = null) {
  if (state.timerHandle) {
    window.clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
  if (typeof finalSeconds === "number") {
    elements.timerCounter.textContent = formatDuration(finalSeconds);
  }
}

async function restoreSession() {
  if (!state.sessionToken) {
    renderSession();
    return;
  }

  try {
    const session = await fetchJson("/api/auth/me");
    storeSession(session);
  } catch {
    clearSession();
  }
}

async function bootstrap() {
  try {
    loadRememberedEmail();
    const config = await fetchJson("/api/config");
    if (!config.configured) {
      elements.statusMessage.textContent = "Missing Google Maps API key.";
      return;
    }

    state.apiKey = config.google_maps_api_key;
    state.gameModes = config.game_modes || [];
    if (state.gameModes.length > 0 && !state.gameModes.some((mode) => mode.id === state.mode)) {
      state.mode = state.gameModes[0].id;
    }
    await initializeMaps();
    renderSession();
    await restoreSession();
    elements.statusMessage.textContent = "";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
}

async function initializeMaps() {
  if (state.ready) {
    return;
  }
  if (state.initializing) {
    return;
  }

  state.initializing = true;
  try {
    await loadGoogleMapsScript(state.apiKey);
    hydrateModePicker();
    if (!state.map) {
      createMap();
    }
    if (!state.panorama) {
      createPanorama();
    }
    state.ready = true;
    elements.startGame.disabled = false;
  } finally {
    state.initializing = false;
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

function resetMapViewport() {
  if (!state.map) {
    return;
  }
  state.map.setCenter({ lat: 20, lng: 0 });
  state.map.setZoom(2);
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
  const isExpanded = elements.mapOverlay.classList.contains("expanded");
  if (isExpanded) {
    state.mapPinnedOpen = false;
    setMapExpanded(false);
    return;
  }

  state.mapPinnedOpen = true;
  setMapExpanded(true);
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
  state.mode = round.mode || state.mode;
  state.totalScore = round.total_score;
  state.startView = null;
  state.guessLatLng = null;
  state.mapPinnedOpen = false;
  setMapExpanded(false);
  resetMapViewport();
  elements.backToStart.disabled = true;
  elements.submitGuess.disabled = true;
  elements.mapResult.classList.add("hidden");
  elements.nextRoundInline.classList.add("hidden");
  hideResultsModal();
  elements.roundCounter.textContent =
    `Round ${round.round_number} / ${round.rounds_total}`;
  elements.scoreCounter.textContent = `Score ${round.total_score}`;
  startTimer(round.elapsed_seconds || 0);
  hydrateModePicker();
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
    await initializeMaps();
    if (!state.ready) {
      return;
    }
  }

  if (!state.user) {
    const guestSession = await fetchJson("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({
        guest_name: elements.guestName.value,
      }),
    });
    storeSession(guestSession);
  }

  elements.statusMessage.textContent = "Creating a new game...";
  const round = await fetchJson("/api/game/new", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode }),
  });
  state.roundResults = [];
  state.lastCompletedMode = "";
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
  state.roundResults.push({
    roundNumber: state.roundResults.length + 1,
    location: `${result.actual.label}, ${result.actual.country}`,
    distance: `${distanceKm} km`,
  });
  elements.resultSummary.innerHTML =
    `<strong>${result.actual.label}, ${result.actual.country}</strong>` +
    `You were <span class="result-metric">${distanceKm} km</span> away ` +
    `and scored <span class="result-metric">${result.round_score} points</span>.`;
  elements.mapResult.classList.remove("hidden");
  elements.nextRoundInline.classList.remove("hidden");
  elements.nextRoundInline.textContent = result.next_round_available
    ? "Next round"
    : "Final results";
  elements.statusMessage.textContent = "";
  if (result.next_round_available) {
    startTimer(result.elapsed_seconds || 0);
  } else {
    stopTimer(result.elapsed_seconds || 0);
    state.lastCompletedMode = state.mode;
    if (result.best_times) {
      state.bestTimes = result.best_times;
    }
    showResultsModal(
      `Final score: ${result.total_score}. Total time: ${formatDuration(result.elapsed_seconds || 0)}.`
    );
  }
  setMapExpanded(true);
}

async function nextRound() {
  if (!state.gameId) {
    return;
  }

  const round = await fetchJson(`/api/game/${state.gameId}`);
  if (round.status === "finished") {
    state.gameId = null;
    state.roundId = null;
    stopTimer(round.elapsed_seconds || 0);
    elements.nextRoundInline.classList.add("hidden");
    state.lastCompletedMode = state.lastCompletedMode || state.mode;
    showResultsModal(
      `Final score: ${round.total_score}. Total time: ${formatDuration(round.elapsed_seconds || 0)} across ${round.round_number} rounds.`
    );
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

elements.registerButton.addEventListener("click", async () => {
  try {
    const formData = new FormData();
    formData.set("email", elements.authEmail.value);
    formData.set("password", elements.authPassword.value);
    const avatarFile = elements.authAvatar.files?.[0];
    if (avatarFile) {
      formData.set("avatar", avatarFile);
    }
    const session = await fetchJson("/api/auth/register", {
      method: "POST",
      body: formData,
    });
    rememberEmail(elements.authEmail.value);
    storeSession(session);
    elements.statusMessage.textContent = "";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
});

elements.loginButton.addEventListener("click", async () => {
  try {
    const session = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: elements.authEmail.value,
        password: elements.authPassword.value,
      }),
    });
    rememberEmail(elements.authEmail.value);
    storeSession(session);
    elements.statusMessage.textContent = "";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
});

elements.authEmail.addEventListener("input", () => {
  rememberEmail(elements.authEmail.value);
});

elements.guestButton.addEventListener("click", async () => {
  try {
    const session = await fetchJson("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({
        guest_name: elements.guestName.value,
      }),
    });
    storeSession(session);
    elements.statusMessage.textContent = "";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
});

elements.logoutButton.addEventListener("click", async () => {
  try {
    await fetchJson("/api/auth/logout", { method: "POST" });
  } catch {
    // no-op
  }
  clearSession();
});

elements.avatarButton.addEventListener("click", () => {
  if (!state.user || state.user.kind !== "user") {
    return;
  }
  elements.profileAvatarInput.click();
});

elements.profileAvatarInput.addEventListener("change", async () => {
  const avatarFile = elements.profileAvatarInput.files?.[0];
  if (!avatarFile) {
    return;
  }
  try {
    const formData = new FormData();
    formData.set("avatar", avatarFile);
    const session = await fetchJson("/api/auth/profile", {
      method: "PUT",
      body: formData,
    });
    storeSession(session);
    elements.statusMessage.textContent = "";
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  } finally {
    elements.profileAvatarInput.value = "";
  }
});

elements.backToStart.addEventListener("click", () => {
  resetToStartView();
});

elements.modePicker.addEventListener("change", (event) => {
  state.mode = event.target.value;
});

elements.toggleMapSize.addEventListener("click", () => {
  toggleMapSize();
});

elements.mapOverlay.addEventListener("mouseenter", () => {
  if (!state.mapPinnedOpen) {
    setMapExpanded(true);
  }
});

elements.streetViewCanvas.addEventListener("mouseenter", () => {
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
  }
});

elements.closeResultsModal.addEventListener("click", () => {
  hideResultsModal();
});

elements.clearBestTime.addEventListener("click", async () => {
  if (!state.lastCompletedMode || state.user?.kind !== "user") {
    return;
  }
  try {
    const session = await fetchJson(`/api/stats/best-time/${state.lastCompletedMode}`, {
      method: "DELETE",
    });
    storeSession(session);
    syncResultsMeta();
  } catch (error) {
    elements.statusMessage.textContent = error.message;
  }
});

bootstrap();
