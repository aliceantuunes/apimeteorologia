const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const HISTORY_KEY = "meteo-pro-history-pastel";
const REQUEST_TIMEOUT = 12000;
const MAX_HISTORY = 5;

const elements = {
  form: document.querySelector("#search-form"),
  cityInput: document.querySelector("#city-input"),
  searchStatus: document.querySelector("#search-status"),
  locationPicker: document.querySelector("#location-picker"),
  locationSelect: document.querySelector("#location-select"),
  weatherSubmit: document.querySelector("#weather-submit"),
  weatherContent: document.querySelector("#weather-content"),
  recentList: document.querySelector("#recent-list"),
  compareFirst: document.querySelector("#compare-first"),
  compareSecond: document.querySelector("#compare-second"),
  comparisonResult: document.querySelector("#comparison-result"),
  forecastCaption: document.querySelector("#forecast-caption"),
  forecastChart: document.querySelector("#forecast-chart"),
  forecastDays: document.querySelector("#forecast-days"),
};

let searchResults = [];
let currentLocation = null;
let history = readHistory();
let searchHasRun = false;

function readHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(saved) ? saved.slice(0, MAX_HISTORY) : [];
  } catch (error) {
    console.error("Erro ao ler o histórico salvo.", error);
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error("Erro ao salvar o histórico.", error);
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function requestWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  return fetch(url, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
      return response.json();
    })
    .finally(() => clearTimeout(timeout));
}

function setSearchStatus(message = "", isError = false) {
  elements.searchStatus.textContent = message;
  elements.searchStatus.classList.toggle("is-error", isError);
}

function setBusy(isBusy) {
  elements.weatherContent.setAttribute("aria-busy", String(isBusy));
  const submitBtn = elements.form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = isBusy;
  if (elements.weatherSubmit) elements.weatherSubmit.disabled = isBusy;
}

function setLoading() {
  elements.weatherContent.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Consultando microsserviços de dados climáticos…</p>
    </div>`;
}

function setError(title, message) {
  elements.weatherContent.innerHTML = `
    <div class="error-state" role="alert">
      <strong>⚠️ ${escapeHTML(title)}</strong>
      <p>${escapeHTML(message)}</p>
    </div>`;
}

function locationLabel(location) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}

function formatCoordinates(value) {
  return Number(value).toFixed(2);
}

function weatherForCode(code, isDay = true) {
  if (code === 0) return { icon: isDay ? "☀️" : "🌙", description: "Céu limpo" };
  if (code === 1) return { icon: isDay ? "🌤️" : "🌙", description: "Predominantemente limpo" };
  if (code === 2) return { icon: "⛅", description: "Parcialmente nublado" };
  if (code === 3) return { icon: "☁️", description: "Nublado" };
  if ([45, 48].includes(code)) return { icon: "🌫️", description: "Nevoeiro ou Neblina" };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: "🌦️", description: "Garoa leve" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: "🌧️", description: "Chuva" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: "🌨️", description: "Neve" };
  if ([95, 96, 99].includes(code)) return { icon: "⛈️", description: "Trovoada severa" };
  return { icon: "🌡️", description: "Condição estável" };
}

function windCompass(degrees) {
  const directions = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(Number(degrees) / 45) % directions.length];
}

function formatDate(dateString, options) {
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(`${dateString}T12:00:00`));
}

function formatObservationTime(dateTime) {
  const date = new Date(`${dateTime}Z`);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function makeForecastUrl(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "uv_index",
    ].join(","),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,uv_index_max",
    timezone: "auto",
    forecast_days: "6",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
  });
  return `${FORECAST_URL}?${params}`;
}

function cityKey(location) {
  return `${Number(location.latitude).toFixed(3)},${Number(location.longitude).toFixed(3)}`;
}

function updateHistory(location, weather) {
  const entry = { key: cityKey(location), location, weather };
  history = [entry, ...history.filter((item) => item.key !== entry.key)].slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
  renderComparisonOptions();
}

function renderHistory() {
  if (history.length === 0) {
    elements.recentList.innerHTML = '<li class="empty-message">Nenhuma consulta realizada ainda.</li>';
    return;
  }

  elements.recentList.innerHTML = history.map((entry, index) => {
    const current = entry.weather.current;
    const details = weatherForCode(current.weather_code, current.is_day === 1);
    return `
      <li class="recent-item">
        <button class="recent-button" type="button" data-history-index="${index}">
          <div>
            <span class="recent-name">${escapeHTML(entry.location.name)} · ${escapeHTML(entry.location.country_code || "")}</span>
            <span class="recent-detail">${details.icon} ${escapeHTML(details.description)}</span>
          </div>
          <span class="recent-temperature">${Math.round(current.temperature_2m)}°C</span>
        </button>
      </li>`;
  }).join("");
}

function renderComparisonOptions() {
  const selects = [elements.compareFirst, elements.compareSecond];
  const previous = selects.map((select) => select.value);
  const options = history.map((entry) => (
    `<option value="${escapeHTML(entry.key)}">${escapeHTML(locationLabel(entry.location))}</option>`
  )).join("");

  selects.forEach((select, index) => {
    select.innerHTML = `<option value="">Selecione...</option>${options}`;
    select.disabled = history.length < 2;
    if (history.some((entry) => entry.key === previous[index])) select.value = previous[index];
  });
  renderComparison();
}

function renderComparison() {
  const firstKey = elements.compareFirst.value;
  const secondKey = elements.compareSecond.value;
  if (!firstKey || !secondKey) {
    elements.comparisonResult.innerHTML = '<p class="empty-message">Consulte pelo menos duas localidades para ativar o comparativo.</p>';
    return;
  }
  if (firstKey === secondKey) {
    elements.comparisonResult.innerHTML = '<p class="empty-message">Escolha cidades diferentes para comparar.</p>';
    return;
  }
  const first = history.find((entry) => entry.key === firstKey);
  const second = history.find((entry) => entry.key === secondKey);
  if (!first || !second) return;

  const firstForecast = first.weather.daily;
  const secondForecast = second.weather.daily;
  const days = firstForecast.time.slice(1, 6).filter((date) => (
    secondForecast.time.indexOf(date) > 0
  ));
  
  if (days.length === 0) {
    elements.comparisonResult.innerHTML = '<p class="empty-message">Não há dias em comum para comparação.</p>';
    return;
  }

  const rows = days.map((date) => {
    const fIdx = firstForecast.time.indexOf(date);
    const sIdx = secondForecast.time.indexOf(date);
    return `
      <tr>
        <td>${escapeHTML(formatDate(date, { weekday: "short", day: "2-digit" }))}</td>
        <td>${Math.round(firstForecast.temperature_2m_min[fIdx])}° / ${Math.round(firstForecast.temperature_2m_max[fIdx])}°</td>
        <td>${Math.round(secondForecast.temperature_2m_min[sIdx])}° / ${Math.round(secondForecast.temperature_2m_max[sIdx])}°</td>
      </tr>`;
  }).join("");

  elements.comparisonResult.innerHTML = `
    <table class="comparison-table">
      <thead>
        <tr>
          <th>Dia</th>
          <th>${escapeHTML(first.location.name)}</th>
          <th>${escapeHTML(second.location.name)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function chartMarkup(daily) {
  const dates = daily.time.slice(1, 6);
  const highs = daily.temperature_2m_max.slice(1, 6);
  const lows = daily.temperature_2m_min.slice(1, 6);
  const allValues = [...highs, ...lows];
  const minimum = Math.min(...allValues) - 3;
  const maximum = Math.max(...allValues) + 3;
  const width = 720;
  const height = 140;
  const left = 35;
  const right = width - 35;
  const top = 20;
  const bottom = height - 20;
  
  const x = (index) => left + index * ((right - left) / (dates.length - 1));
  const y = (value) => bottom - ((value - minimum) / (maximum - minimum || 1)) * (bottom - top);
  
  const points = (values) => values.map((val, idx) => `${x(idx)},${y(val)}`).join(" ");
  const highPoints = points(highs);
  const lowPoints = points(lows);

  const gridLines = [0, 1, 2].map((step) => {
    const lineY = top + step * ((bottom - top) / 2);
    return `<line class="chart-gridline" x1="${left}" y1="${lineY}" x2="${right}" y2="${lineY}"/>`;
  }).join("");

  const labels = dates.map((_, index) => `
    <text class="chart-value" x="${x(index)}" y="${y(highs[index]) - 8}">${Math.round(highs[index])}°</text>
    <text class="chart-value" x="${x(index)}" y="${y(lows[index]) + 16}">${Math.round(lows[index])}°</text>
    <circle class="chart-dot-max" cx="${x(index)}" cy="${y(highs[index])}" r="4"/>
    <circle class="chart-dot-min" cx="${x(index)}" cy="${y(lows[index])}" r="4"/>`).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de temperaturas máximas e mínimas">
      ${gridLines}
      <polyline class="chart-line-max" points="${highPoints}"/>
      <polyline class="chart-line-min" points="${lowPoints}"/>
      ${labels}
    </svg>`;
}

function renderForecast(location, weather) {
  const daily = weather.daily;
  const forecastDates = daily.time.slice(1, 6);
  elements.forecastCaption.textContent = `Previsão de 5 dias para ${location.name}, ${location.country}.`;
  elements.forecastChart.innerHTML = chartMarkup(daily);
  
  elements.forecastDays.innerHTML = forecastDates.map((date, index) => {
    const dayIndex = index + 1;
    const summary = weatherForCode(daily.weather_code[dayIndex]);
    return `
      <article class="forecast-day">
        <p class="day-name">${escapeHTML(formatDate(date, { weekday: "short", day: "2-digit", month: "2-digit" }))}</p>
        <div class="day-icon" aria-hidden="true">${summary.icon}</div>
        <p class="day-description">${escapeHTML(summary.description)}</p>
        <div class="day-temperatures">
          <span class="day-max">${Math.round(daily.temperature_2m_max[dayIndex])}°</span>
          <span class="day-min">${Math.round(daily.temperature_2m_min[dayIndex])}°</span>
        </div>
      </article>`;
  }).join("");
}

function renderWeather(location, weather) {
  const current = weather.current;
  const condition = weatherForCode(current.weather_code, current.is_day === 1);
  const dateStr = formatObservationTime(current.time);
  const country = escapeHTML(location.country || "");
  const state = location.admin1 ? ` · ${escapeHTML(location.admin1)}` : "";
  const coords = `${formatCoordinates(location.latitude)}, ${formatCoordinates(location.longitude)}`;
  const uv = Number(current.uv_index).toFixed(1);

  elements.weatherContent.innerHTML = `
    <article class="weather-card">
      <div class="weather-topline">
        <div>
          <span class="widget-eyebrow">DADOS EM TEMPO REAL</span>
          <h2>${escapeHTML(location.name)}${state}, ${country}</h2>
          <p class="field-hint">${escapeHTML(dateStr)}</p>
        </div>
        <button class="btn-secondary" id="refresh-weather" type="button">↻ Atualizar</button>
      </div>
      <div class="weather-grid">
        <div class="current-weather-main">
          <span class="weather-emoji">${condition.icon}</span>
          <div>
            <div class="temperature-display">${Math.round(current.temperature_2m)}<sup>°C</sup></div>
            <p class="widget-desc" style="margin:0">${escapeHTML(condition.description)}</p>
          </div>
        </div>
        <div class="weather-metric-box">
          <span class="metric-label">Sensação</span>
          <span class="metric-value">${Math.round(current.apparent_temperature)}°C</span>
        </div>
        <div class="weather-metric-box">
          <span class="metric-label">Umidade</span>
          <span class="metric-value">${Math.round(current.relative_humidity_2m)}%</span>
        </div>
        <div class="weather-metric-box">
          <span class="metric-label">Vento</span>
          <span class="metric-value">${Math.round(current.wind_speed_10m)} km/h</span>
        </div>
        <div class="weather-metric-box">
          <span class="metric-label">Índice UV</span>
          <span class="metric-value">${uv}</span>
        </div>
      </div>
      <div class="location-meta-footer">
        <span>Coordenadas: <strong>${coords}</strong></span>
        <span>Precipitação: <strong>${Number(current.precipitation).toFixed(1)} mm</strong></span>
      </div>
    </article>`;

  elements.weatherContent.setAttribute("aria-busy", "false");
  currentLocation = location;
  renderForecast(location, weather);
  updateHistory(location, weather);
}

async function loadWeather(location) {
  setBusy(true);
  setLoading();
  setSearchStatus(`Carregando forecast para ${locationLabel(location)}...`);

  try {
    const weather = await requestWithTimeout(makeForecastUrl(location));
    if (!weather.current || !weather.daily || weather.daily.time.length < 6) {
      throw new Error("Dados meteorológicos incompletos.");
    }
    renderWeather(location, weather);
    setSearchStatus("Clima atualizado com sucesso!");
  } catch (error) {
    console.error("Erro ao obter o clima:", error);
    const timedOut = error.name === "AbortError";
    setError("Falha no Microsserviço", timedOut ? "O serviço excedeu o tempo limite (Timeout 502)." : "Erro de conexão com o servidor externo.");
    setSearchStatus("Falha na operação meteorológica.", true);
  } finally {
    setBusy(false);
  }
}

async function searchCities(event) {
  event.preventDefault();
  const shouldLoadDefault = !searchHasRun;
  searchHasRun = true;
  const query = elements.cityInput.value.trim();
  elements.locationPicker.hidden = true;
  elements.locationSelect.innerHTML = "";

  if (query.length < 2 || query.length > 100) {
    setSearchStatus("Erro de Contrato (400): Digite entre 2 e 100 caracteres.", true);
    elements.cityInput.focus();
    return;
  }

  const submitBtn = elements.form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  setSearchStatus("Consultando microsserviço de localização...");

  try {
    const params = new URLSearchParams({ name: query, count: "10", language: "pt", format: "json" });
    const response = await requestWithTimeout(`${GEOCODING_URL}?${params}`);
    searchResults = response.results || [];

    if (searchResults.length === 0) {
      setSearchStatus(`Erro 404: Localidade "${query}" não encontrada.`, true);
      setError("Local não encontrado", "Verifique o nome digitado e tente novamente.");
      return;
    }

    elements.locationSelect.innerHTML = searchResults.map((loc, idx) => {
      const option = document.createElement("option");
      option.value = String(idx);
      option.textContent = locationLabel(loc);
      return option.outerHTML;
    }).join("");

    elements.locationPicker.hidden = false;
    setSearchStatus(`Encontrados ${searchResults.length} locais. Selecione abaixo.`);

    if (shouldLoadDefault) {
      const defaultIdx = searchResults.findIndex((l) => l.name.toLowerCase() === "salvador" && l.country_code === "BR");
      if (defaultIdx >= 0) {
        elements.locationSelect.value = String(defaultIdx);
        loadWeather(searchResults[defaultIdx]);
      }
    }
    elements.locationSelect.focus();
  } catch (error) {
    console.error("Erro na busca de cidades:", error);
    setSearchStatus("Erro 502: Serviço de geolocalização indisponível.", true);
    setError("Gateway Indisponível", "Não foi possível conectar ao microsserviço de busca.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function consultSelectedCity() {
  const selected = searchResults[Number(elements.locationSelect.value)];
  if (!selected) {
    setSearchStatus("Selecione um local válido.", true);
    return;
  }
  loadWeather(selected);
}

function consultRecentCity(index) {
  const entry = history[index];
  if (!entry) return;
  elements.cityInput.value = entry.location.name;
  loadWeather(entry.location);
  document.querySelector("#inicio").scrollIntoView({ behavior: "smooth" });
}

function refreshWeather() {
  if (currentLocation) loadWeather(currentLocation);
}

elements.form.addEventListener("submit", searchCities);
if (elements.weatherSubmit) {
  elements.weatherSubmit.addEventListener("click", consultSelectedCity);
}
elements.recentList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-history-index]");
  if (btn) consultRecentCity(Number(btn.dataset.historyIndex));
});
elements.weatherContent.addEventListener("click", (event) => {
  if (event.target.closest("#refresh-weather")) refreshWeather();
});
elements.compareFirst.addEventListener("change", renderComparison);
elements.compareSecond.addEventListener("change", renderComparison);

renderHistory();
renderComparisonOptions();

// Carga inicial automática padrão (Salvador)
elements.cityInput.value = "Salvador";
elements.form.requestSubmit();