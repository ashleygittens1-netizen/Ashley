/* ==========================================================================
   NYC Rat Activity Forecast - dashboard logic
   Data comes from data/forecast_data.js (window.RAT_FORECAST) and
   data/nyc_zip_geo.js (window.NYC_ZIP_GEO), both written by
   notebook_export/export_dashboard_data.py. No models run in the browser.
   ========================================================================== */

const DATA = window.RAT_FORECAST;
const GEO = window.NYC_ZIP_GEO;

/* --------------------------------------------------------------------------
   1. FORECAST / DATA LOGIC (no DOM here)
   -------------------------------------------------------------------------- */

const areaById = (id) => DATA.areas.find((a) => a.id === id);
const forecastFor = (area, h) => area.forecast.find((f) => f.h === h);
const weekFor = (h) => DATA.forecast_weeks.find((w) => w.h === h);

/**
 * Low / Moderate / High classification.
 * The notebook does not define thresholds, so the export derives them from
 * each area's own weekly history (last `threshold_weeks` weeks, default 104):
 *   Low      : forecast <  33rd percentile of historical weekly counts
 *   Moderate : between the 33rd and 67th percentile
 *   High     : forecast >  67th percentile
 * i.e. "High" means a busier-than-usual week *for that area*.
 */
function classify(value, thresholds) {
  if (value < thresholds.low_max) return "Low";
  if (value > thresholds.high_min) return "High";
  return "Moderate";
}

/** ZIP-level forecast values for the heatmap at horizon h. */
function zipForecasts(h) {
  const zips = Object.keys(DATA.zips);
  return {
    zips,
    values: zips.map((z) => DATA.zips[z].forecast[h - 1]),
    boroughs: zips.map((z) => DATA.zips[z].borough),
  };
}

// Fixed color range across all 4 horizons so switching weeks is comparable.
// Set in INIT, after the data files have been checked.
let ZIP_MAX = 0;

/* --------------------------------------------------------------------------
   2. FORMATTING HELPERS
   -------------------------------------------------------------------------- */

// Dates are handled in UTC so week boundaries never shift with the viewer's timezone
const parseDate = (s) => new Date(s + "T00:00:00Z");
const fmtDay = (s, opts = {}) =>
  parseDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...opts });
const fmtNum = (n, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const addDays = (s, n) => {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* --------------------------------------------------------------------------
   3. STATE + CONTROLS
   -------------------------------------------------------------------------- */

const state = { area: "CITYWIDE", h: 1 };

const ACCENT = "#1d5578";
const ACCENT_SOFT = "rgba(29, 85, 120, 0.13)";
const INK_3 = "#7b8188";
const RULE = "#e6e4de";
const LEVEL_COLOR = { Low: "#3f8a5c", Moderate: "#b88a1b", High: "#b2453a" };

// Heatmap colors: copied from the supplied px.choropleth_map code
const HEAT_SCALE = [
  [0.0, "#C7E3E1"], // light teal = fewer complaints
  [0.25, "#8FC9CD"],
  [0.5, "#58A9B8"],
  [0.75, "#2F7F9D"],
  [1.0, "#1D5578"], // dark blue = more complaints
];

// Map framing per area. Citywide uses the original code's center.
const MAP_VIEW = {
  CITYWIDE: { center: { lat: 40.705, lon: -73.94 }, zoom: 9.55 },
  MANHATTAN: { center: { lat: 40.785, lon: -73.965 }, zoom: 10.6 },
  BROOKLYN: { center: { lat: 40.648, lon: -73.948 }, zoom: 10.6 },
  QUEENS: { center: { lat: 40.705, lon: -73.82 }, zoom: 10.2 },
  BRONX: { center: { lat: 40.845, lon: -73.865 }, zoom: 10.8 },
  "STATEN ISLAND": { center: { lat: 40.58, lon: -74.148 }, zoom: 10.8 },
};

const $ = (id) => document.getElementById(id);

function buildControls() {
  const select = $("areaSelect");
  DATA.areas.forEach((a) => select.add(new Option(a.name, a.id)));
  select.addEventListener("change", () => {
    state.area = select.value;
    render({ areaChanged: true });
  });

  const group = $("horizonGroup");
  DATA.forecast_weeks.forEach(({ h }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.h = h;
    b.innerHTML = `<span class="bullet">${h}</span>${h === 1 ? "week" : "weeks"} ahead`;
    b.addEventListener("click", () => {
      state.h = h;
      render({ horizonChanged: true });
    });
    group.appendChild(b);
  });
  // Arrow keys move between horizons (radio-group behaviour)
  group.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const n = DATA.forecast_weeks.length;
    state.h = ((state.h - 1 + step + n) % n) + 1;
    render({ horizonChanged: true });
    group.querySelector(`[data-h="${state.h}"]`).focus();
  });
}

/* --------------------------------------------------------------------------
   4. RENDERING
   -------------------------------------------------------------------------- */

function renderSummary(area) {
  const f = forecastFor(area, state.h);
  const wk = weekFor(state.h);
  const level = classify(f.mean, area.thresholds);
  const t = area.thresholds;

  $("expValue").innerHTML = `${fmtNum(f.mean)}<small>rat sightings</small>`;
  $("expRange").textContent = `95% range ${fmtNum(f.lower)}–${fmtNum(f.upper)} · ${area.name}`;

  const badge = $("levelBadge");
  badge.dataset.level = level;
  $("levelText").textContent = level;
  $("levelNote").textContent =
    `${area.name} typical week: ${fmtNum(t.low_max)}–${fmtNum(t.high_min)} (middle third, last ${Math.round(t.window_weeks / 52)} yrs)`;

  $("periodValue").textContent = `${fmtDay(wk.week_start)} – ${fmtDay(wk.week_end, { year: "numeric" })}`;
  $("periodNote").textContent =
    `${state.h} ${state.h === 1 ? "week" : "weeks"} ahead of the last full week (${fmtDay(DATA.meta.last_observed_week)})`;

  document.querySelectorAll("#horizonGroup button").forEach((b) => {
    const on = Number(b.dataset.h) === state.h;
    b.setAttribute("aria-checked", on);
    b.tabIndex = on ? 0 : -1;
  });
}

function renderChart(area) {
  const hist = area.history;
  const last = hist[hist.length - 1];
  const fx = area.forecast.map((f) => weekFor(f.h).week_start);
  const sel = forecastFor(area, state.h);
  const selX = weekFor(state.h).week_start;
  const level = classify(sel.mean, area.thresholds);
  const xEnd = addDays(fx[fx.length - 1], 5);

  const traces = [
    // 95% interval band (starts at the last observed point so it "opens" out)
    {
      x: [last.week, ...fx, ...[...fx].reverse(), last.week],
      y: [last.value, ...area.forecast.map((f) => f.upper), ...[...area.forecast].reverse().map((f) => f.lower), last.value],
      mode: "lines", fill: "toself", fillcolor: ACCENT_SOFT, line: { width: 0 },
      hoverinfo: "skip", showlegend: false, type: "scatter",
    },
    // Observed history - solid
    {
      x: hist.map((p) => p.week), y: hist.map((p) => p.value),
      mode: "lines", line: { color: ACCENT, width: 2 }, name: "Observed",
      hovertemplate: "Week of %{x|%b %d}<br><b>%{y:,.0f}</b> observed<extra></extra>",
      type: "scatter",
    },
    // Forecast - dashed, joined to the last observed week
    {
      x: [last.week, ...fx], y: [last.value, ...area.forecast.map((f) => f.mean)],
      mode: "lines+markers", line: { color: ACCENT, width: 2, dash: "dash" },
      marker: { size: [0, 7, 7, 7, 7], color: "#fff", line: { color: ACCENT, width: 2 } },
      customdata: [null, ...area.forecast.map((f) => [f.h, f.lower, f.upper])],
      hovertemplate: "Week of %{x|%b %d} · %{customdata[0]}w ahead<br><b>%{y:,.0f}</b> expected (%{customdata[1]:,.0f}–%{customdata[2]:,.0f})<extra></extra>",
      name: "Forecast", type: "scatter",
    },
    // Selected horizon - emphasized point in the activity-level color
    {
      x: [selX], y: [sel.mean], mode: "markers",
      marker: { size: 14, color: LEVEL_COLOR[level], line: { color: "#fff", width: 2 } },
      hoverinfo: "skip", showlegend: false, type: "scatter",
    },
  ];

  const t = area.thresholds;
  const layout = {
    margin: { l: 48, r: 72, t: 16, b: 36 },
    font: { family: "IBM Plex Sans, system-ui, sans-serif", size: 12, color: "#4a5056" },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: false, hovermode: "closest",
    hoverlabel: { bgcolor: "#1b1e21", bordercolor: "#1b1e21", font: { color: "#fff", family: "IBM Plex Sans" } },
    xaxis: {
      type: "date", range: [addDays(hist[0].week, -3), xEnd],
      showgrid: false, linecolor: "#c9c6bd", ticks: "outside", tickcolor: "#c9c6bd",
      tickformat: "%b %d", fixedrange: true,
    },
    yaxis: {
      rangemode: "tozero", gridcolor: RULE, zeroline: false, tickformat: ",d", fixedrange: true,
      title: { text: "Weekly rat sightings", standoff: 8, font: { size: 11, color: INK_3 } },
    },
    shapes: [
      // Forecast zone
      { type: "rect", xref: "x", yref: "paper", x0: addDays(last.week, 3), x1: xEnd, y0: 0, y1: 1,
        fillcolor: "#f5f4f0", line: { width: 0 }, layer: "below" },
      // Low / High cutoffs used by the activity indicator
      ...[t.low_max, t.high_min].map((y) => ({
        type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y,
        line: { color: INK_3, width: 1, dash: "dot" }, layer: "below",
      })),
    ],
    annotations: [
      { xref: "x", yref: "paper", x: addDays(last.week, 3), y: 1, xanchor: "left", yanchor: "top",
        text: "FORECAST", showarrow: false, xshift: 6,
        font: { family: "IBM Plex Mono", size: 10, color: INK_3 } },
      { xref: "paper", yref: "y", x: 1, y: t.high_min, xanchor: "left", yanchor: "bottom",
        text: "High above", showarrow: false, xshift: 4, font: { size: 10, color: INK_3 } },
      { xref: "paper", yref: "y", x: 1, y: t.low_max, xanchor: "left", yanchor: "top",
        text: "Low below", showarrow: false, xshift: 4, font: { size: 10, color: INK_3 } },
      { x: selX, y: sel.mean, xref: "x", yref: "y", text: `<b>${fmtNum(sel.mean)}</b>`,
        showarrow: false, yshift: 18, font: { family: "IBM Plex Mono", size: 12, color: "#1b1e21" } },
    ],
  };

  Plotly.react("trendChart", traces, layout, { displayModeBar: false, responsive: true });
  $("chartSub").textContent = `${area.name} · last ${hist.length} weeks observed + 4-week forecast`;
}

function renderMap(areaChanged) {
  const { zips, values, boroughs } = zipForecasts(state.h);
  const selected = state.area;
  const wk = weekFor(state.h);

  // Adapted from the supplied px.choropleth_map call: same GeoJSON, same
  // featureidkey, same color scale, carto-positron basemap and 0.8 opacity.
  // Only the color values changed: forecast for week h instead of history.
  const trace = {
    type: "choroplethmap",
    geojson: GEO,
    featureidkey: "properties.ZCTA5CE10",
    locations: zips,
    z: values,
    zmin: 0,
    zmax: ZIP_MAX,
    colorscale: HEAT_SCALE,
    showscale: false, // custom HTML legend below the map
    marker: {
      // Dim ZIPs outside the selected borough
      opacity: boroughs.map((b) => (selected === "CITYWIDE" || b === selected ? 0.8 : 0.22)),
      line: { width: 0.4, color: "#ffffff" },
    },
    customdata: boroughs.map((b) => b.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())),
    hovertemplate: "ZIP %{location} · %{customdata}<br><b>%{z:.1f}</b> expected sightings<extra></extra>",
  };

  const view = MAP_VIEW[selected] || MAP_VIEW.CITYWIDE;
  const narrow = window.innerWidth < 720 ? -0.7 : 0;
  const layout = {
    map: { style: "carto-positron", center: view.center, zoom: view.zoom + narrow },
    margin: { r: 0, t: 0, l: 0, b: 0 },
    hoverlabel: { bgcolor: "#1b1e21", bordercolor: "#1b1e21", font: { color: "#fff", family: "IBM Plex Sans" } },
    // Keep the user's pan/zoom when only the horizon changes
    uirevision: areaChanged ? Date.now() : "keep",
  };

  Plotly.react("forecastMap", [trace], layout, { displayModeBar: false, responsive: true, scrollZoom: false });

  $("legendMax").textContent = fmtNum(ZIP_MAX, 1);
  $("mapSub").textContent =
    `Week of ${fmtDay(wk.week_start)} – ${fmtDay(wk.week_end)} · ${state.h} ${state.h === 1 ? "week" : "weeks"} ahead`;

  // Small call-out: highest expected ZIP in view
  let best = -1;
  zips.forEach((z, i) => {
    if ((selected === "CITYWIDE" || boroughs[i] === selected) && (best < 0 || values[i] > values[best])) best = i;
  });
  $("mapHot").innerHTML = best < 0 ? "" :
    `Highest expected: ZIP <b>${zips[best]}</b> · ${fmtNum(values[best], 1)} sightings`;
}

function renderMethod() {
  const m = DATA.meta;
  const items = [
    `Model: <code>${m.model}</code> on weekly "${m.target}" counts — the best performer (lowest MAE) in the notebook's model comparison. Fit separately for citywide and each borough on all complete weeks through ${fmtDay(m.last_observed_week, { year: "numeric" })}.`,
    `An MA(1) model only carries information one week forward, so forecasts for weeks 2–4 settle at the series' long-run mean and look identical.`,
    `Activity level: Low below the 33rd percentile, High above the 67th percentile of the area's own weekly counts over the last ${m.threshold_weeks} weeks; Moderate in between.`,
    `Heatmap: each borough's forecast is split across its ZIP codes by their share of that borough's rat sightings over the last ${m.share_weeks} weeks. Boundaries and colors follow the original ZIP heatmap code.`,
  ];
  $("methodList").innerHTML = items.map((t) => `<li>${t}</li>`).join("");
  $("demoFlag").hidden = m.source !== "demo";
}

function render({ areaChanged = false } = {}) {
  const area = areaById(state.area);
  renderSummary(area);
  renderChart(area);
  renderMap(areaChanged);
}

/* --------------------------------------------------------------------------
   5. INIT
   -------------------------------------------------------------------------- */
/** Returns a message if a data file is missing or is the wrong file, else null. */
function dataProblem() {
  if (!window.Plotly) return "Could not load Plotly. Check the internet connection.";
  if (!DATA || !Array.isArray(DATA.areas) || !DATA.zips) {
    return "<code>data/forecast_data.js</code> does not contain the forecast data. " +
      "It should start with <code>window.RAT_FORECAST =</code>" +
      (GEO ? " (it looks like the map file, <code>nyc_zip_geo.js</code>, was saved under this name)." : ".") +
      " Re-upload the <code>forecast_data.js</code> downloaded from the Colab export cell.";
  }
  if (!GEO || !Array.isArray(GEO.features)) {
    return "<code>data/nyc_zip_geo.js</code> does not contain the ZIP boundaries. " +
      "It should start with <code>window.NYC_ZIP_GEO =</code>.";
  }
  return null;
}

const problem = dataProblem();
if (problem) {
  const flag = document.createElement("p");
  flag.className = "demo-flag";
  flag.innerHTML = problem;
  document.querySelector(".controls").before(flag);
} else {
  ZIP_MAX = Math.max(...Object.values(DATA.zips).flatMap((z) => z.forecast));
  buildControls();
  renderMethod();
  render({ areaChanged: true });
}
