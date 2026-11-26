const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
  preferCanvas: true,
  minZoom: 5,
  maxZoom: 19,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 80,
  maxBounds: [[44.15, 21.85], [52.6, 40.45]],
  maxBoundsViscosity: 1,
  worldCopyJump: false
}).setView([48.7, 31.8], 6);
map.zoomControl.setPosition("bottomleft");
const outsideUkrainePane = map.createPane("outsideUkrainePane");
outsideUkrainePane.style.zIndex = "350";
outsideUkrainePane.style.pointerEvents = "none";

const tileOptions = {
  maxZoom: 19,
  attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> · Sources: Esri, Maxar, Earthstar Geographics, GIS User Community · <a href="https://github.com/slawomirmatuszak/ukrainian_geodata">межі областей</a>',
  updateWhenIdle: true,
  keepBuffer: 2
};
const tileSources = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
];
let baseTiles = null;
let activeTileSource = -1;
function useTileSource(index, useFallback = false) {
  activeTileSource = index;
  if (baseTiles) map.removeLayer(baseTiles);
  let errors = 0;
  baseTiles = L.tileLayer(tileSources[index], tileOptions).addTo(map);
  baseTiles.on("tileerror", event => {
    if (activeTileSource !== index) return;
    errors += 1;
    if (errors < 3) return;
    if (!useFallback) {
      const fallbackIndex = (index + 1) % tileSources.length;
      console.warn("Map tiles failed; switching to the backup Esri map.");
      useTileSource(fallbackIndex, true);
    } else {
      console.error("All configured map tile sources failed:", event.tile?.src);
    }
  });
}
function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Could not read map preference:", error);
    return null;
  }
}
function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Could not save map preference:", error);
  }
}
const storedTheme = readPreference("mapTheme") || readPreference("mapStyle");
if (storedTheme === "light" || storedTheme === "dark") {
  document.documentElement.dataset.theme = storedTheme;
  document.getElementById("mapStyle").value = storedTheme;
  document.getElementById("themeLabel").textContent =
    storedTheme === "dark" ? "Світла тема" : "Темна тема";
}
const storedLayer = Number(readPreference("mapLayer"));
const initialLayer = storedLayer === 1 ? 1 : 0;
document.getElementById("mapLayerSelect").value = String(initialLayer);
useTileSource(initialLayer);

const markerLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup();
const cityLayer = L.layerGroup().addTo(map);
let liveTargets = [];
let oblastLayer = null;
let ukraineEdgeLayer = null;
const targetsBySource = new Map([
  ["Aviacontrol", []],
  ["DIMAP", []]
]);
const targetMarkers = new Map();
const targetFeedErrors = new Map();
const targetFeedsInProgress = new Set();
const targetFeedLastUpdated = new Map();
const targetFeedFailures = new Map();
const AVIACONTROL_REFRESH_MS = 5000;
const DIMAP_REFRESH_MS = 2000;
const TARGET_REQUEST_TIMEOUT_MS = 8000;
const TARGET_MAX_RETRY_MS = 60000;
const AVIACONTROL_URL = "https://aviacontrol.com.ua/api/targets";

const usesSameOriginDimapProxy = location.hostname === "radar.povitryanavarta.pp.ua"
  || location.hostname.endsWith(".vercel.app");
const DIMAP_URL = usesSameOriginDimapProxy
  ? "/api/dimap"
  : "https://radar.povitryanavarta.pp.ua/api/dimap";

const majorCities = [
  ["Київ", 50.4501, 30.5234],
  ["Львів", 49.8397, 24.0297],
  ["Одеса", 46.4825, 30.7233],
  ["Харків", 49.9935, 36.2304],
  ["Дніпро", 48.4647, 35.0462],
  ["Запоріжжя", 47.8388, 35.1396],
  ["Миколаїв", 46.9750, 31.9946],
  ["Херсон", 46.6354, 32.6169],
  ["Полтава", 49.5883, 34.5514],
  ["Чернігів", 51.4982, 31.2893],
  ["Суми", 50.9077, 34.7981],
  ["Донецьк", 48.0159, 37.8029],
  ["Сімферополь", 44.9521, 34.1024]
];

majorCities.forEach(([name, lat, lng]) => {
  L.marker([lat, lng], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({
      className: "city-label-marker",
      html: `<span class="city-label">${name}</span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    })
  }).addTo(cityLayer);
});

const typeNames = {
  aircraft: "Тактична авіація",
  recon_uav: "Розвідувальний БпЛА",
  shahed: "БпЛА Shahed",
  reactive_shahed: "Реактивний Shahed",
  jet_uav: "Реактивний БпЛА",
  fpv: "FPV-дрон",
  avia: "Авіація",
  kab: "КАБ",
  molnia: "БпЛА «Молния»",
  molnia1: "БпЛА «Молния»",
  molniya: "БпЛА «Молния»",
  molniya1: "БпЛА «Молния»",
  geran2: "БпЛА Shahed",
  geran_2: "БпЛА Shahed",
  "geran-2": "БпЛА Shahed",
  geran3: "Реактивний Shahed",
  geran_3: "Реактивний Shahed",
  "geran-3": "Реактивний Shahed",
  geran4: "БпЛА Shahed-4",
  geran_4: "БпЛА Shahed-4",
  "geran-4": "БпЛА Shahed-4",
  geran5: "БпЛА Shahed-5",
  geran_5: "БпЛА Shahed-5",
  "geran-5": "БпЛА Shahed-5",
  lancet: "БпЛА «Ланцет»",
  lancet1: "БпЛА «Ланцет»",
  lancet_1: "БпЛА «Ланцет»",
  "lancet-1": "БпЛА «Ланцет»",
  lancet3: "БпЛА «Ланцет-3»",
  lancet_3: "БпЛА «Ланцет-3»",
  "lancet-3": "БпЛА «Ланцет-3»",
  zala: "БпЛА Zala",
  zala421: "БпЛА Zala",
  "zala-421": "БпЛА Zala",
  orlan: "Розвідувальний БпЛА",
  recon: "Розвідувальний БпЛА",
  cruise: "Крилата ракета",
  parcel: "БпЛА «Бандероль»",
  missile: "Ракета",
  ballistic: "Балістична ракета",
  ballistic_missile: "Балістична ракета",
  fast_target: "Швидкісна ціль",
  shahed_238: "Реактивний Shahed",
  shahed238: "Реактивний Shahed",
  reactiveshahed: "Реактивний Shahed",
  iskander: "Іскандер",
  oreshnik: "Орешник",
  kinzhal: "Кинджал",
  unknown: "Невідомий об'єкт",
  uav: "БпЛА",
  strike_uav: "Ударний БпЛА"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function targetPopup(target) {
  const updated = target.updated
    ? new Date(target.updated).toLocaleTimeString("uk-UA")
    : null;
  return `
    <div style="min-width:220px">
      <strong style="color:var(--red)">${escapeHtml(target.label)}</strong>
      <div style="margin-top:6px;color:var(--txt-2)">Джерело: <b style="color:var(--txt)">${escapeHtml(target.source)}</b></div>
      <div>ID: <b>${escapeHtml(target.id)}</b></div>
      <div>Курс: <b>${Number.isFinite(target.bearing) ? target.bearing + "°" : "невідомо"}</b></div>
      <div>Швидкість: <b>${Number.isFinite(target.speed) ? target.speed + " км/год" : "невідомо"}</b></div>
      ${target.count > 1 ? `<div>Кількість у повідомленні: <b>${target.count}</b></div>` : ""}
      <div>Координати: <b>${target.lat.toFixed(4)}, ${target.lng.toFixed(4)}</b></div>
      ${target.region ? `<div>Регіон: <b>${escapeHtml(target.region)}</b></div>` : ""}
      ${updated ? `<div>Оновлено: <b>${escapeHtml(updated)}</b></div>` : ""}
    </div>
  `;
}

function targetIcon(target) {
  const iconUrl = target.icon
    ? `https://aviacontrol.com.ua/${target.icon.replace(/^\/+/, "")}`
    : null;
  const symbol = iconUrl
    ? `<span class="target-icon-wrap"><span class="target-marker"></span><img src="${escapeHtml(iconUrl)}" alt="" class="aviacontrol-target-icon"></span>`
    : `<div class="target-marker"></div>`;
  const nameDisplay = document.getElementById("showNames").classList.contains("on") ? "block" : "none";
  return L.divIcon({
    className: "",
    html: `${symbol}<div class="target-label" style="display:${nameDisplay}">${escapeHtml(target.label)}<br>#${escapeHtml(target.id)}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

function animateTarget(record, target) {
  const current = record.marker.getLatLng();
  const start = [current.lat, current.lng];
  const end = [target.lat, target.lng];
  if (Math.abs(start[0] - end[0]) < 1e-6 && Math.abs(start[1] - end[1]) < 1e-6) return;

  if (record.animation) cancelAnimationFrame(record.animation);
  const startedAt = performance.now();
  const duration = Math.max(250, target.refreshMs - 250);
  const step = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 2;
    record.marker.setLatLng([
      start[0] + (end[0] - start[0]) * eased,
      start[1] + (end[1] - start[1]) * eased
    ]);
    if (progress < 1) record.animation = requestAnimationFrame(step);
    else record.animation = null;
  };
  record.animation = requestAnimationFrame(step);
}

function renderLiveTargets() {
  routeLayer.clearLayers();
  const visibleKeys = new Set();

  liveTargets.forEach(target => {
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
    visibleKeys.add(target.key);

    let record = targetMarkers.get(target.key);
    if (!record) {
      const marker = L.marker([target.lat, target.lng], { icon: targetIcon(target) })
        .bindPopup(targetPopup(target));
      marker.on("add", () => {
        const image = marker.getElement()?.querySelector(".aviacontrol-target-icon");
        image?.addEventListener("error", () => image.remove(), { once: true });
      });
      marker.addTo(markerLayer);
      record = { marker, icon: target.icon, label: target.label, animation: null };
      targetMarkers.set(target.key, record);
    } else {
      animateTarget(record, target);
      if (record.icon !== target.icon || record.label !== target.label) {
        record.marker.setIcon(targetIcon(target));
        record.icon = target.icon;
        record.label = target.label;
      }
      record.marker.setPopupContent(targetPopup(target));
    }

    if (Array.isArray(target.route) && target.route.length > 1) {
      L.polyline(target.route, {
        className: "route-line",
        interactive: false,
        weight: 1.5,
        opacity: 0.75
      }).addTo(routeLayer);
    }
  });

  for (const [key, record] of targetMarkers) {
    if (visibleKeys.has(key)) continue;
    if (record.animation) cancelAnimationFrame(record.animation);
    markerLayer.removeLayer(record.marker);
    targetMarkers.delete(key);
  }

  document.getElementById("targetCount").textContent = String(liveTargets.length);
  document.getElementById("fitTargets").disabled = liveTargets.length === 0;
  const summaryRows = document.getElementById("threatSummaryRows");
  if (summaryRows) {
    const counts = {};
    liveTargets.forEach(target => {
      counts[target.label] = (counts[target.label] || 0) + 1;
    });
    summaryRows.innerHTML = Object.entries(counts).map(([label, count]) =>
      `<div class="threat-summary-row"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`
    ).join("");
  }
}

function coordinatePair(latValue, lngValue) {
  const lat = finiteNumber(latValue);
  const lng = finiteNumber(lngValue);
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAviacontrol(target) {
  if (!target || target.id == null) return null;
  const position = coordinatePair(target.pos?.[0] ?? target.lat, target.pos?.[1] ?? target.lng);
  if (!position) return null;
  const type = String(target.type || "").toLowerCase();
  return {
    key: `avia:${target.id}`,
    id: String(target.id),
    source: "Aviacontrol",
    type,
    label: target.label || typeNames[type] || target.name || "Повітряний об'єкт",
    lat: position[0],
    lng: position[1],
    bearing: finiteNumber(target.bearing),
    speed: finiteNumber(target.speed_kmh),
    region: target.region || null,
    route: Array.isArray(target.route) ? target.route : null,
    icon: target.icon || null,
    count: Math.max(1, Math.min(20, Math.floor(finiteNumber(target.count) || 1))),
    updated: target.updated || null
  };
}

function normalizeDimap(target) {
  if (!target || target.id == null) return null;
  const position = coordinatePair(target.lat, target.lng);
  if (!position) return null;
  const type = String(target.type || "unknown").trim().toLowerCase();
  return {
    key: `dimap:${target.id}`,
    id: String(target.id),
    source: "DIMAP",
    type,
    label: typeNames[type] || "Невідомий об'єкт",
    lat: position[0],
    lng: position[1],
    bearing: finiteNumber(target.bearing),
    speed: finiteNumber(target.speed),
    region: target.region || null,
    route: null,
    icon: null,
    count: 1,
    updated: target.lastSeen || null
  };
}

async function fetchTargetFeed(url, normalize) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const retryDate = Date.parse(retryAfter);
        error.retryAfterMs = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1000)
          : Number.isFinite(retryDate)
            ? Math.max(0, retryDate - Date.now())
            : null;
      }
      throw error;
    }
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.targets)) throw new Error("Invalid targets response");
    return data.targets.map(normalize).filter(Boolean);
  } finally {
    clearTimeout(timeout);
  }
}

function readableFeedError(message) {
  if (/abort|timeout/i.test(message)) return "таймаут";
  if (/failed to fetch|networkerror|cors/i.test(message)) return "CORS/мережа";
  return message;
}

function updateTargetFeedStatus() {
  const status = document.getElementById("targetFeedStatus");
  const counts = [...targetsBySource].map(([source, targets]) => {
    const lastUpdated = targetFeedLastUpdated.get(source);
    const lastUpdatedText = lastUpdated
      ? new Date(lastUpdated).toLocaleTimeString("uk-UA")
      : "ще не оновлювалось";
    const error = targetFeedErrors.get(source);
    const state = error
      ? `${readableFeedError(error)} · дані ${lastUpdatedText}`
      : `оновлено ${lastUpdatedText}`;
    return `${source}: ${targets.length} · ${state}`;
  });
  status.textContent = `${new Date().toLocaleTimeString("uk-UA")} · ${counts.join(" · ")}`;
  status.classList.toggle("offline", targetFeedErrors.size > 0);
}

async function refreshTargetFeed(source, url, normalize, refreshMs) {
  if (targetFeedsInProgress.has(source)) return;
  targetFeedsInProgress.add(source);
  let retryAfterMs = null;

  try {
    const targets = await fetchTargetFeed(url, normalize);
    targetsBySource.set(source, targets.map(target => ({ ...target, refreshMs })));
    targetFeedErrors.delete(source);
    targetFeedFailures.delete(source);
    targetFeedLastUpdated.set(source, Date.now());
    liveTargets = [...targetsBySource.values()].flat();
    renderLiveTargets();
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Request timeout"
      : error?.message || String(error);
    if (targetFeedErrors.get(source) !== message) {
      console.error(`${source} target feed:`, error);
    }
    targetFeedErrors.set(source, message);
    targetFeedFailures.set(source, (targetFeedFailures.get(source) || 0) + 1);
    retryAfterMs = error?.retryAfterMs;
  } finally {
    targetFeedsInProgress.delete(source);
    updateTargetFeedStatus();
    const failures = targetFeedFailures.get(source) || 0;
    const backoff = Math.min(
      refreshMs * (2 ** Math.min(failures, 5)),
      TARGET_MAX_RETRY_MS
    );
    const nextDelay = Number.isFinite(retryAfterMs)
      ? Math.min(Math.max(backoff, retryAfterMs), TARGET_MAX_RETRY_MS)
      : backoff;
    setTimeout(() => refreshTargetFeed(source, url, normalize, refreshMs), nextDelay);
  }
}

const targetFeedSchedules = [
  {
    source: "Aviacontrol",
    url: AVIACONTROL_URL,
    normalize: normalizeAviacontrol,
    refreshMs: AVIACONTROL_REFRESH_MS
  },
  {
    source: "DIMAP",
    url: DIMAP_URL,
    normalize: normalizeDimap,
    refreshMs: DIMAP_REFRESH_MS
  }
];

function updateClock() {
  const now = new Date();
  const clock = document.getElementById("clockTime");
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hour12: false
    }).format(now);
  }
}
updateClock();
setInterval(updateClock, 1000);

const settingsPanel = document.getElementById("settingsPanel");
function openSettings(open) {
  settingsPanel.classList.toggle("open", open);
  settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  document.getElementById("menuPop").classList.remove("open");
  document.getElementById("menuToggle").setAttribute("aria-expanded", "false");
}
document.getElementById("settingsToggle").addEventListener("click", () => openSettings(true));
document.getElementById("settingsBtn")?.addEventListener("click", () => openSettings(true));
document.getElementById("closeSettings").addEventListener("click", () => openSettings(false));

const menuToggle = document.getElementById("menuToggle");
const menuPop = document.getElementById("menuPop");
menuToggle.addEventListener("click", () => {
  const open = menuPop.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", event => {
  if (!event.target.closest(".topbar-menu")) {
    menuPop.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }
});

document.querySelectorAll(".switch").forEach(button => {
  button.addEventListener("click", () => {
    const on = button.classList.toggle("on");
    button.setAttribute("aria-checked", String(on));
  });
});

function bindPreferenceSwitch(id, key, apply) {
  const button = document.getElementById(id);
  const storedValue = readPreference(key);
  if (storedValue === "true" || storedValue === "false") {
    button.classList.toggle("on", storedValue === "true");
    button.setAttribute("aria-checked", storedValue);
  }
  const update = () => {
    const enabled = button.classList.contains("on");
    savePreference(key, String(enabled));
    apply(enabled);
  };
  update();
  button.addEventListener("click", update);
}

const centerCrosshair = document.getElementById("centerCrosshair");
bindPreferenceSwitch("showCrosshair", "showCrosshair", enabled => {
  centerCrosshair.classList.toggle("hidden", !enabled);
});
bindPreferenceSwitch("showRegionLabels", "showRegionLabels", enabled => {
  document.body.classList.toggle("hide-region-labels", !enabled);
});
bindPreferenceSwitch("showGlow", "showGlow", enabled => {
  document.body.classList.toggle("no-target-glow", !enabled);
});

const crosshairOpacity = document.getElementById("crosshairOpacity");
const storedCrosshairOpacityValue = readPreference("crosshairOpacity");
const storedCrosshairOpacity = storedCrosshairOpacityValue === null
  ? NaN
  : Number(storedCrosshairOpacityValue);
if (Number.isFinite(storedCrosshairOpacity) && storedCrosshairOpacity >= 0 && storedCrosshairOpacity <= 100) {
  crosshairOpacity.value = String(storedCrosshairOpacity);
}
function updateCrosshairOpacity() {
  const value = Number(crosshairOpacity.value);
  centerCrosshair.style.opacity = String(value / 100);
  document.getElementById("crosshairOpacityValue").textContent = `${value}%`;
  savePreference("crosshairOpacity", String(value));
}
crosshairOpacity.addEventListener("input", updateCrosshairOpacity);
updateCrosshairOpacity();

const objectSize = document.getElementById("objectSize");
const storedObjectSizeValue = readPreference("objectSize");
const storedObjectSize = storedObjectSizeValue === null ? NaN : Number(storedObjectSizeValue);
if (Number.isFinite(storedObjectSize) && storedObjectSize >= 60 && storedObjectSize <= 160) {
  objectSize.value = String(storedObjectSize);
}
function updateObjectSize() {
  const value = Number(objectSize.value);
  document.documentElement.style.setProperty("--target-scale", String(value / 100));
  document.getElementById("objectSizeValue").textContent = `${value}%`;
  savePreference("objectSize", String(value));
}
objectSize.addEventListener("input", updateObjectSize);
updateObjectSize();

document.getElementById("showObjects").addEventListener("click", event => {
  if (event.currentTarget.classList.contains("on")) map.addLayer(markerLayer);
  else map.removeLayer(markerLayer);
});
document.getElementById("showNames").addEventListener("click", event => {
  document.querySelectorAll(".target-label").forEach(label => {
    label.style.display = event.currentTarget.classList.contains("on") ? "block" : "none";
  });
});
document.getElementById("showRoutes").addEventListener("click", event => {
  if (event.currentTarget.classList.contains("on")) routeLayer.addTo(map);
  else map.removeLayer(routeLayer);
});

document.getElementById("mapStyle").addEventListener("change", event => {
  document.documentElement.dataset.theme = event.target.value;
  document.getElementById("themeLabel").textContent =
    event.target.value === "dark" ? "Світла тема" : "Темна тема";
  savePreference("mapStyle", event.target.value);
});
document.getElementById("mapLayerSelect").addEventListener("change", event => {
  const index = Number(event.target.value);
  if (index !== 0 && index !== 1) return;
  savePreference("mapLayer", String(index));
  useTileSource(index);
});

document.getElementById("themeBtn").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.getElementById("themeLabel").textContent = theme === "dark" ? "Світла тема" : "Темна тема";
  document.getElementById("mapStyle").value = theme;
  savePreference("mapTheme", theme);
});

document.getElementById("locateBtn").addEventListener("click", () => {
  map.locate({ setView: true, maxZoom: 8 });
});
map.on("locationfound", event => {
  L.circle(event.latlng, { radius: event.accuracy, color: "#6fbf73", fillOpacity: .12 }).addTo(map);
});

function updateCenterCoordinates() {
  const { lat, lng } = map.getCenter();
  document.getElementById("centerCoords").textContent =
    `${lat.toFixed(4)}, ${lng.toFixed(4)} · z${map.getZoom().toFixed(1)}`;
}
map.on("moveend zoomend", updateCenterCoordinates);
updateCenterCoordinates();

document.getElementById("resetView").addEventListener("click", () => {
  map.setView([48.7, 31.8], 6);
});
document.getElementById("fitTargets").addEventListener("click", () => {
  if (!liveTargets.length) return;
  const bounds = L.latLngBounds(liveTargets.map(target => [target.lat, target.lng]));
  map.fitBounds(bounds.pad(0.15), { maxZoom: 9 });
});

document.getElementById("showBorder").addEventListener("click", event => {
  const visible = event.currentTarget.classList.contains("on");
  [oblastLayer, ukraineEdgeLayer].filter(Boolean).forEach(layer => {
    if (visible) map.addLayer(layer);
    else map.removeLayer(layer);
  });
});
document.getElementById("showCities").addEventListener("click", event => {
  if (event.currentTarget.classList.contains("on")) map.addLayer(cityLayer);
  else map.removeLayer(cityLayer);
});
document.getElementById("hideUi").addEventListener("click", () => {
  document.body.classList.add("ui-hidden");
  document.getElementById("restoreUiBtn").classList.add("visible");
});
document.getElementById("restoreUiBtn").addEventListener("click", () => {
  document.body.classList.remove("ui-hidden");
  document.getElementById("restoreUiBtn").classList.remove("visible");
});

async function loadAdministrativeBoundaries() {
  if (oblastLayer) map.removeLayer(oblastLayer);
  if (ukraineEdgeLayer) map.removeLayer(ukraineEdgeLayer);

  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/slawomirmatuszak/ukrainian_geodata/main/regiony.geojson",
      { mode: "cors", cache: "force-cache" }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const regions = await response.json();
    const regionStyle = {
      color: "#d0ad67",
      weight: 1,
      opacity: 0.9,
      fillColor: "#d0ad67",
      fillOpacity: 0.025
    };
    const regionRings = [];
    (regions.features || []).forEach(feature => {
      const geometry = feature.geometry;
      const polygons = geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
      polygons.forEach(polygon => {
        const ring = polygon?.[0];
        if (!Array.isArray(ring) || ring.length < 4) return;
        regionRings.push(ring.map(([lng, lat]) => [Number(lat), Number(lng)]));
      });
    });
    if (!regionRings.length) throw new Error("Boundary data contains no polygon rings");

    const maskBounds = [[10, 0], [10, 60], [65, 60], [65, 0], [10, 0]];
    const outsideMask = L.polygon([maskBounds, ...regionRings], {
      pane: "outsideUkrainePane",
      color: "#020407",
      weight: 5,
      opacity: 0.9,
      fillColor: "#05080d",
      fillOpacity: 0.64,
      fillRule: "evenodd",
      interactive: false
    });
    ukraineEdgeLayer = L.layerGroup([outsideMask]);
    oblastLayer = L.geoJSON(regions, {
      style: regionStyle,
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.region;
        if (name) {
          layer.bindTooltip(name, {
            permanent: false,
            direction: "center",
            sticky: true,
            className: "oblast-label",
            interactive: false
          });
        }
      }
    });
    if (document.getElementById("showBorder").classList.contains("on")) {
      ukraineEdgeLayer.addTo(map);
      oblastLayer.addTo(map);
    }
  } catch (error) {
    console.error("Не вдалося завантажити межі областей:", error);
  }
}

targetFeedSchedules.forEach(({ source, url, normalize, refreshMs }) => {
  refreshTargetFeed(source, url, normalize, refreshMs);
});
loadAdministrativeBoundaries();
