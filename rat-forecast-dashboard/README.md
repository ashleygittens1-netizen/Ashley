# NYC Rat Activity Forecast — dashboard prototype

A static HTML/CSS/JS dashboard for the NYC Rat Watch time-series notebook. Pick an
area (Citywide or one of the five boroughs) and a horizon (1–4 weeks ahead) to see
the expected rat-sighting complaints, a Low/Moderate/High activity level, the
recent trend running into the forecast, and a ZIP-level forecast heatmap.

```
rat-forecast-dashboard/
├── index.html                 page structure
├── styles.css                 design
├── script.js                  data logic (top) + rendering (bottom)
├── data/
│   ├── forecast_data.js       window.RAT_FORECAST  ← exported from the notebook
│   └── nyc_zip_geo.js         window.NYC_ZIP_GEO   ← NYC ZIP boundaries
└── notebook_export/
    ├── export_dashboard_data.py   paste into Colab (the export step)
    └── make_demo_data.py          builds the placeholder data shipped here
```

Open `index.html` by double-clicking it. You don't need a server: the data files are
`.js` so that the page also works from `file://`. You do need an internet connection
for Plotly and the basemap tiles.

## Connecting the notebook to the dashboard

**The data in `data/` right now is placeholder data.** It is synthetic data that was
run through the real export code, because the 311 CSV lives on Google Drive. While
the placeholder data is loaded, the page shows a "Preview data" note.

To use the real data:

1. In the Colab notebook, add one new code cell **directly after the cell
   "FORECASTING 1 TO 4 WEEKS INTO THE FUTURE WITH THE BEST PERFORMING MODEL"**.
2. Paste in the whole of `notebook_export/export_dashboard_data.py` and run the cell.
   It uses `balanced_weekly_df`, then downloads `forecast_data.js` and
   `nyc_zip_geo.js`.
3. Copy both files into `data/` so they replace the placeholder files, then reload
   the page.

The citywide numbers will match the notebook's output (417.8, then 432.3 for
weeks 2–4).

## How the pieces map to the notebook and heatmap code

| Piece | Source of truth | What the dashboard does |
|---|---|---|
| Areas | `Borough` column (5 boroughs after imputation) | Citywide + the 5 boroughs |
| Model | Each area's own model comparison: Citywide and Brooklyn **ARIMA(0,0,1)**, Manhattan **ARIMA(1,0,1)**, Queens **ARIMA(1,0,0)**, Bronx **Simple Exponential Smoothing**, Staten Island **ARIMA(0,1,0)** | `AREA_MODELS` in the export refits each winner on the full series with a 4-week forecast and 95% interval (SES interval from the standard SES variance formula) |
| History | `balanced_weekly_df` weekly `Rat Sighting` totals (Sunday-start weeks) | Last 26 weeks on the chart |
| Heatmap | The supplied `px.choropleth_map`: ZIP level, `Incident Zip` ↔ `properties.ZCTA5CE10`, OpenDataDE NY GeoJSON, 5-step teal→blue scale, `carto-positron`, opacity 0.8 | The same setup in Plotly.js (`choroplethmap`). Only the color values change: they are **forecasted** sightings per ZIP for the selected week, not historical totals. |

**ZIP forecasts.** The notebook forecasts at the citywide level, not per ZIP. So the
export splits each borough's forecast across that borough's ZIPs, using each ZIP's
share of the borough's rat sightings over the last 52 weeks. As a result, the ZIP
values add up to the borough forecast. The color range stays fixed across the four
horizons, so the map can be compared week to week.

**Activity thresholds.** The notebook doesn't define any thresholds, so these are
derived. Each area's weekly counts over the last 104 weeks are split into thirds:
**Low** is below the 33rd percentile, **High** is above the 67th, and **Moderate**
is in between. That makes the label mean "relative to this area's usual level," so
Staten Island isn't permanently Low. The cutoffs are drawn as dotted lines on the
chart.

**Why some forecasts are flat.** This comes from the models, not the dashboard. ARIMA(0,0,1) adjusts only week 1 and then holds at the long-run average. SES and ARIMA(0,1,0) give one value for all four weeks. ARIMA(1,0,0) and ARIMA(1,0,1) drift gradually toward the average.

## Regenerating the placeholder data

```
cd notebook_export
pip install pandas statsmodels requests
python make_demo_data.py            # downloads the GeoJSON (~40 MB) once
```
