const categoryFilter = document.querySelector("#categoryFilter");
const categoryInput = document.querySelector("#categoryInput");
const statusFilter = document.querySelector("#statusFilter");
const urgencyFilter = document.querySelector("#urgencyFilter");
const searchInput = document.querySelector("#searchInput");
const reportForm = document.querySelector("#reportForm");
const reportList = document.querySelector("#reportList");
const counter = document.querySelector("#counter");
const toast = document.querySelector("#toast");

const fields = {
  id: document.querySelector("#reportId"),
  title: document.querySelector("#titleInput"),
  category: categoryInput,
  urgency: document.querySelector("#urgencyInput"),
  status: document.querySelector("#statusInput"),
  quality: document.querySelector("#qualityInput"),
  lat: document.querySelector("#latInput"),
  lng: document.querySelector("#lngInput"),
  address: document.querySelector("#addressInput"),
  city: document.querySelector("#cityInput"),
  country: document.querySelector("#countryInput"),
  description: document.querySelector("#descriptionInput"),
  needs: document.querySelector("#needsInput"),
  capacity: document.querySelector("#capacityInput"),
  source: document.querySelector("#sourceInput"),
  token: document.querySelector("#tokenInput"),
};

const statusLabels = {
  sin_verificar: "Sin verificar",
  verificado: "Verificado",
  en_atencion: "En atencion",
  resuelto: "Resuelto",
};

const urgencyLabels = {
  critica: "Critica",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const qualityLabels = {
  exacta: "Exacta",
  aproximada: "Aproximada",
  por_confirmar: "Por confirmar",
};

const needOptions = [
  "Agua",
  "Comida",
  "Medicinas",
  "Medicos",
  "Rescatistas",
  "Maquinaria",
  "Herramientas",
  "Transporte",
  "Mantas",
  "Carpas",
  "Sangre",
  "Comunicacion",
];

let map;
let markerLayer;
let draftMarker;
let categories = {};
let locations = [];
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function getToken() {
  const current = fields.token.value.trim();
  if (current) {
    localStorage.setItem("sosvzla-admin-token", current);
  }
  return current || localStorage.getItem("sosvzla-admin-token") || "";
}

function authHeaders() {
  const token = getToken();
  return token ? { "X-Admin-Token": token } : {};
}

function initMap() {
  map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
  }).setView([8.2, -66.6], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  L.control.scale({ imperial: false }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  map.on("click", (event) => setCoordinates(event.latlng.lat, event.latlng.lng, true));
}

function buildCategoryControls() {
  categoryFilter.innerHTML = '<option value="">Todas</option>';
  categoryInput.innerHTML = "";

  Object.entries(categories).forEach(([key, category]) => {
    const filterOption = document.createElement("option");
    filterOption.value = key;
    filterOption.textContent = category.label;
    categoryFilter.appendChild(filterOption);

    const inputOption = document.createElement("option");
    inputOption.value = key;
    inputOption.textContent = category.label;
    categoryInput.appendChild(inputOption);
  });
}

function buildNeedsControls() {
  fields.needs.innerHTML = "";
  needOptions.forEach((need) => {
    const label = document.createElement("label");
    label.className = "need-option";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(need)}" /> <span>${escapeHtml(need)}</span>`;
    fields.needs.appendChild(label);
  });
}

async function loadCategories() {
  const response = await fetch("/api/categories");
  if (!response.ok) throw new Error("No se pudieron cargar las categorias.");
  const data = await response.json();
  categories = data.categories || {};
  buildCategoryControls();
}

async function loadLocations({ fit = false } = {}) {
  const response = await fetch("/api/locations");
  if (!response.ok) throw new Error("No se pudieron cargar los reportes.");
  const data = await response.json();
  locations = Array.isArray(data.locations) ? data.locations : [];
  render(fit);
}

function filteredLocations() {
  const query = searchInput.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const status = statusFilter.value;
  const urgency = urgencyFilter.value;

  return locations.filter((location) => {
    const text = [
      location.title,
      location.category_label,
      location.address,
      location.city,
      location.country,
      location.description,
      location.source,
      ...(location.needs || []),
    ]
      .join(" ")
      .toLowerCase();

    return (
      (!query || text.includes(query)) &&
      (!category || location.category === category) &&
      (!status || location.status === status) &&
      (!urgency || location.urgency === urgency)
    );
  });
}

function markerRadius(urgency) {
  if (urgency === "critica") return 12;
  if (urgency === "alta") return 10;
  if (urgency === "baja") return 7;
  return 8;
}

function render(fit = false) {
  const items = filteredLocations();
  counter.textContent = `${items.length} ${items.length === 1 ? "reporte" : "reportes"}`;
  renderMarkers(items, fit);
  renderList(items);
}

function renderMarkers(items, fit = false) {
  markerLayer.clearLayers();
  const bounds = [];

  items.forEach((location) => {
    const category = categories[location.category] || categories.otro || { color: "#475467", label: "Otro" };
    const marker = L.circleMarker([location.lat, location.lng], {
      radius: markerRadius(location.urgency),
      color: "#ffffff",
      weight: 2,
      fillColor: category.color,
      fillOpacity: location.status === "resuelto" ? 0.45 : 0.88,
    });

    marker.bindPopup(popupHtml(location, category));
    marker.on("click", () => highlightListItem(location.id));
    marker.addTo(markerLayer);
    bounds.push([location.lat, location.lng]);
  });

  if (fit && bounds.length) {
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 12 });
  }
}

function popupHtml(location, category) {
  const place = [location.address, location.city, location.country].filter(Boolean).join(", ");
  const needs = (location.needs || []).length ? `<p class="popup-text"><strong>Necesita:</strong> ${escapeHtml(location.needs.join(", "))}</p>` : "";
  const description = location.description ? `<p class="popup-text">${escapeHtml(location.description)}</p>` : "";
  return `
    <div>
      <p class="popup-title">${escapeHtml(location.title)}</p>
      <p class="popup-text">${escapeHtml(category.label)} · ${escapeHtml(urgencyLabels[location.urgency])} · ${escapeHtml(statusLabels[location.status])}</p>
      ${place ? `<p class="popup-text">${escapeHtml(place)}</p>` : ""}
      ${description}
      ${needs}
      <p class="popup-text">${escapeHtml(qualityLabels[location.location_quality] || "")} · ${escapeHtml(formatDate(location.updated_at))}</p>
    </div>
  `;
}

function renderList(items) {
  if (!items.length) {
    reportList.innerHTML = '<div class="empty-state">No hay reportes con esos filtros.</div>';
    return;
  }

  reportList.innerHTML = items
    .map((location) => {
      const category = categories[location.category] || categories.otro || { color: "#475467", label: "Otro" };
      const place = [location.city, location.country].filter(Boolean).join(", ");
      const description = location.description ? escapeHtml(location.description) : "Sin descripcion.";
      const needs = (location.needs || [])
        .map((need) => `<span class="badge">${escapeHtml(need)}</span>`)
        .join("");

      return `
        <article class="report-item" data-id="${escapeHtml(location.id)}" style="--item-color:${category.color}">
          <div class="report-title-row">
            <h3 class="report-title">${escapeHtml(location.title)}</h3>
            <span class="badge urgency-${escapeHtml(location.urgency)}">${escapeHtml(urgencyLabels[location.urgency])}</span>
          </div>
          <p class="report-meta">${escapeHtml(category.label)} · ${escapeHtml(statusLabels[location.status])} · ${escapeHtml(place || "Sin ciudad")}</p>
          <p class="report-description">${description}</p>
          <div class="badge-row">
            <span class="badge">${escapeHtml(qualityLabels[location.location_quality])}</span>
            ${needs}
          </div>
          <div class="report-actions">
            <button class="secondary-button" type="button" data-action="view" data-id="${escapeHtml(location.id)}">Ver</button>
            <button class="secondary-button" type="button" data-action="edit" data-id="${escapeHtml(location.id)}">Editar</button>
            <button class="danger-button" type="button" data-action="delete" data-id="${escapeHtml(location.id)}">Eliminar</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function highlightListItem(id) {
  document.querySelectorAll(".report-item").forEach((item) => {
    item.style.outline = item.dataset.id === id ? "2px solid #1570ef" : "";
  });
}

function setCoordinates(lat, lng, moveDraft = false) {
  const roundedLat = Number(lat).toFixed(6);
  const roundedLng = Number(lng).toFixed(6);
  fields.lat.value = roundedLat;
  fields.lng.value = roundedLng;

  if (moveDraft) {
    if (draftMarker) {
      draftMarker.setLatLng([lat, lng]);
    } else {
      draftMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
      draftMarker.on("dragend", () => {
        const position = draftMarker.getLatLng();
        setCoordinates(position.lat, position.lng, false);
      });
    }
  }
}

function currentNeeds() {
  return Array.from(fields.needs.querySelectorAll("input:checked")).map((input) => input.value);
}

function setNeeds(needs) {
  const selected = new Set(needs || []);
  fields.needs.querySelectorAll("input").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function formPayload() {
  return {
    title: fields.title.value.trim(),
    category: fields.category.value,
    urgency: fields.urgency.value,
    status: fields.status.value,
    location_quality: fields.quality.value,
    lat: Number(fields.lat.value),
    lng: Number(fields.lng.value),
    address: fields.address.value.trim(),
    city: fields.city.value.trim(),
    country: fields.country.value.trim(),
    description: fields.description.value.trim(),
    needs: currentNeeds(),
    capacity: fields.capacity.value.trim(),
    source: fields.source.value.trim(),
  };
}

function resetForm() {
  reportForm.reset();
  fields.id.value = "";
  fields.urgency.value = "media";
  fields.status.value = "sin_verificar";
  fields.quality.value = "por_confirmar";
  setNeeds([]);
  document.querySelector("#formTitle").textContent = "Nuevo reporte";
  if (draftMarker) {
    draftMarker.remove();
    draftMarker = null;
  }
}

function fillForm(location) {
  fields.id.value = location.id;
  fields.title.value = location.title || "";
  fields.category.value = location.category || "otro";
  fields.urgency.value = location.urgency || "media";
  fields.status.value = location.status || "sin_verificar";
  fields.quality.value = location.location_quality || "por_confirmar";
  fields.lat.value = location.lat;
  fields.lng.value = location.lng;
  fields.address.value = location.address || "";
  fields.city.value = location.city || "";
  fields.country.value = location.country || "";
  fields.description.value = location.description || "";
  fields.capacity.value = location.capacity || "";
  fields.source.value = location.source || "";
  setNeeds(location.needs || []);
  document.querySelector("#formTitle").textContent = "Editar reporte";
  setCoordinates(location.lat, location.lng, true);
}

async function saveReport(event) {
  event.preventDefault();
  const payload = formPayload();
  const id = fields.id.value;
  const url = id ? `/api/locations/${encodeURIComponent(id)}` : "/api/locations";
  const method = id ? "PATCH" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No se pudo guardar el reporte.");
  }

  resetForm();
  await loadLocations({ fit: true });
  showToast(id ? "Reporte actualizado." : "Reporte guardado.");
}

async function deleteReport(id) {
  if (!confirm("Eliminar este reporte del mapa?")) return;
  const response = await fetch(`/api/locations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No se pudo eliminar el reporte.");
  }
  await loadLocations();
  showToast("Reporte eliminado.");
}

function findLocation(id) {
  return locations.find((location) => location.id === id);
}

function focusLocation(location) {
  map.setView([location.lat, location.lng], Math.max(map.getZoom(), 13));
  highlightListItem(location.id);
}

async function useBrowserLocation() {
  if (!navigator.geolocation) {
    showToast("El navegador no permite geolocalizacion.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCoordinates(position.coords.latitude, position.coords.longitude, true);
      map.setView([position.coords.latitude, position.coords.longitude], 14);
    },
    () => showToast("No se pudo obtener tu ubicacion."),
    { enableHighAccuracy: true, timeout: 9000 }
  );
}

function bindEvents() {
  [categoryFilter, statusFilter, urgencyFilter, searchInput].forEach((element) => {
    element.addEventListener("input", () => render(false));
  });

  reportForm.addEventListener("submit", (event) => {
    saveReport(event).catch((error) => showToast(error.message));
  });

  reportList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const location = findLocation(button.dataset.id);
    if (!location) return;

    if (button.dataset.action === "view") focusLocation(location);
    if (button.dataset.action === "edit") fillForm(location);
    if (button.dataset.action === "delete") deleteReport(location.id).catch((error) => showToast(error.message));
  });

  document.querySelector("#refreshButton").addEventListener("click", () => {
    loadLocations().then(() => showToast("Reportes actualizados.")).catch((error) => showToast(error.message));
  });

  document.querySelector("#fitButton").addEventListener("click", () => render(true));
  document.querySelector("#clearButton").addEventListener("click", resetForm);
  document.querySelector("#locateButton").addEventListener("click", useBrowserLocation);

  fields.token.value = localStorage.getItem("sosvzla-admin-token") || "";
}

async function start() {
  try {
    initMap();
    buildNeedsControls();
    bindEvents();
    await loadCategories();
    await loadLocations({ fit: true });
  } catch (error) {
    showToast(error.message);
  }
}

start();
