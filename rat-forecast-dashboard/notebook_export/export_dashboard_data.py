# ==============================================================================
# EXPORT FORECASTS FOR THE HTML DASHBOARD
# ==============================================================================
# WHERE TO PUT THIS IN THE COLAB NOTEBOOK
#   Paste this whole file into ONE new code cell directly after the cell titled
#   "FORECASTING 1 TO 4 WEEKS INTO THE FUTURE WITH THE BEST PERFORMING MODEL"
#   (the ARIMA(0,0,1) 4-week forecast cell), and run it.
#
#   It only needs `balanced_weekly_df` from the "Group by" section, so it can
#   also run any time after that cell. It does NOT change the modeling: it
#   re-uses the notebook's best model, ARIMA(0,0,1), fit on the full weekly
#   "Rat Sighting" series exactly like the 4-week forecast cell.
#
# WHAT IT WRITES (download both and drop them into rat-forecast-dashboard/data/)
#   forecast_data.js  -> window.RAT_FORECAST  (history, forecasts, thresholds,
#                                              ZIP-level forecasts for the map)
#   nyc_zip_geo.js    -> window.NYC_ZIP_GEO   (NYC-only ZIP boundaries, taken
#                                              from the same GeoJSON the
#                                              heatmap code uses)
#   They are written as .js (not .json) so index.html works when opened by
#   double-click, without a local web server.
# ==============================================================================
import json

import numpy as np
import pandas as pd
import requests
from statsmodels.tsa.arima.model import ARIMA

BEST_ORDER = (0, 0, 1)   # winner of the model comparison table (lowest MAE)
TARGET = "Rat Sighting"  # same target column the notebook models
HORIZON = 4              # 1-4 weeks ahead
HISTORY_WEEKS = 26       # recent weeks shown on the dashboard trend chart
THRESHOLD_WEEKS = 104    # history window used for Low / Moderate / High cutoffs
SHARE_WEEKS = 52         # history window used to split borough forecasts to ZIPs

GEOJSON_URL = (
    "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/"
    "master/ny_new_york_zip_codes_geo.min.json"
)


def forecast_area(series):
    """Fit the notebook's best model on one weekly series and forecast 1-4 weeks."""
    series = series.asfreq("W-SUN")
    fit = ARIMA(series, order=BEST_ORDER).fit()
    res = fit.get_forecast(steps=HORIZON)
    mean = res.predicted_mean.clip(lower=0)          # complaints cannot be negative
    ci = res.conf_int(alpha=0.05).clip(lower=0)      # 95% CI, same as the notebook
    return [
        {
            "h": h + 1,
            "mean": round(float(mean.iloc[h]), 1),
            "lower": round(float(ci.iloc[h, 0]), 1),
            "upper": round(float(ci.iloc[h, 1]), 1),
        }
        for h in range(HORIZON)
    ]


def activity_thresholds(series):
    """
    Low / Moderate / High cutoffs (the notebook does not define any).

    Tertiles of the area's own weekly counts over the last THRESHOLD_WEEKS:
      Low      : forecast <  33rd percentile
      Moderate : 33rd percentile <= forecast <= 67th percentile
      High     : forecast >  67th percentile
    Two years keeps every season in the window and reflects the post-2023
    (Rat Czar) level shown by the notebook's ITS analysis. Using each area's
    own history means "High" = high for that borough, so small boroughs like
    Staten Island are not permanently "Low".
    """
    recent = series.tail(THRESHOLD_WEEKS)
    return {
        "low_max": round(float(np.percentile(recent, 33.3)), 1),
        "high_min": round(float(np.percentile(recent, 66.7)), 1),
        "window_weeks": int(len(recent)),
    }


def build_area(area_id, name, series):
    return {
        "id": area_id,
        "name": name,
        "history": [
            {"week": d.strftime("%Y-%m-%d"), "value": int(v)}
            for d, v in series.tail(HISTORY_WEEKS).items()
        ],
        "forecast": forecast_area(series),
        "thresholds": activity_thresholds(series),
    }


def export_dashboard_data(balanced_weekly_df, source="notebook",
                          out_data="forecast_data.js", out_geo="nyc_zip_geo.js",
                          geojson=None):
    panel = balanced_weekly_df.copy()
    panel["Incident Zip"] = panel["Incident Zip"].astype(str).str.zfill(5)

    # --- 1. Weekly series: citywide + each borough (same aggregation as notebook)
    city = panel.groupby("Week_Start_Sun")[TARGET].sum().asfreq("W-SUN")
    by_borough = (
        panel.groupby(["Week_Start_Sun", "Borough"])[TARGET].sum().unstack("Borough")
    )
    boroughs = sorted(b for b in by_borough.columns if b != "Unspecified")

    areas = [build_area("CITYWIDE", "Citywide", city)]
    for b in boroughs:
        areas.append(build_area(b, b.title(), by_borough[b].asfreq("W-SUN")))
    borough_fc = {a["id"]: a["forecast"] for a in areas}

    # --- 2. ZIP-level forecasts for the heatmap (top-down allocation)
    # Each borough's ARIMA forecast is split across its ZIPs by each ZIP's share
    # of that borough's rat sightings over the last SHARE_WEEKS weeks. ZIP totals
    # therefore add up exactly to the borough forecast shown in the summary.
    last_weeks = sorted(panel["Week_Start_Sun"].unique())[-SHARE_WEEKS:]
    recent = panel[panel["Week_Start_Sun"].isin(last_weeks)]
    zip_tot = (
        recent.groupby(["Incident Zip", "Borough"])[TARGET].sum()
        .reset_index(name="count")
    )
    zip_tot["share"] = zip_tot["count"] / zip_tot.groupby("Borough")["count"].transform("sum")

    zips = {}
    for zip_code, borough, count, share in zip_tot.itertuples(index=False):
        if borough not in borough_fc:
            continue
        zips[zip_code] = {
            "borough": borough,
            "recent_weekly_avg": round(count / SHARE_WEEKS, 2),
            "forecast": [round(f["mean"] * share, 2) for f in borough_fc[borough]],
        }

    last_week = city.index[-1]
    forecast_weeks = []
    for h in range(1, HORIZON + 1):
        start = last_week + pd.Timedelta(weeks=h)
        forecast_weeks.append({
            "h": h,
            "week_start": start.strftime("%Y-%m-%d"),
            "week_end": (start + pd.Timedelta(days=6)).strftime("%Y-%m-%d"),
        })

    data = {
        "meta": {
            "source": source,
            "generated": pd.Timestamp.now().strftime("%Y-%m-%d"),
            "model": f"ARIMA{BEST_ORDER}",
            "target": TARGET,
            "last_observed_week": last_week.strftime("%Y-%m-%d"),
            "threshold_weeks": THRESHOLD_WEEKS,
            "share_weeks": SHARE_WEEKS,
        },
        "forecast_weeks": forecast_weeks,
        "areas": areas,
        "zips": zips,
    }
    with open(out_data, "w") as f:
        f.write("// Generated by export_dashboard_data.py - do not edit by hand\n")
        f.write("window.RAT_FORECAST = " + json.dumps(data) + ";\n")

    # --- 3. NYC-only ZIP boundaries (same source + key as the heatmap code)
    if geojson is None:
        geojson = requests.get(GEOJSON_URL).json()
    keep = set(zips)

    def rnd(coords):  # 4 decimals (~10 m) keeps the file small
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 4), round(coords[1], 4)]
        return [rnd(c) for c in coords]

    features = [
        {
            "type": "Feature",
            "properties": {"ZCTA5CE10": ft["properties"]["ZCTA5CE10"]},
            "geometry": {
                "type": ft["geometry"]["type"],
                "coordinates": rnd(ft["geometry"]["coordinates"]),
            },
        }
        for ft in geojson["features"]
        if ft["properties"]["ZCTA5CE10"] in keep
    ]
    with open(out_geo, "w") as f:
        f.write("// NYC ZIP (ZCTA) boundaries filtered from OpenDataDE ny_new_york_zip_codes_geo\n")
        f.write("window.NYC_ZIP_GEO = " + json.dumps(
            {"type": "FeatureCollection", "features": features}, separators=(",", ":")
        ) + ";\n")

    print(f"Wrote {out_data}: {len(areas)} areas, {len(zips)} ZIPs, "
          f"forecast weeks {forecast_weeks[0]['week_start']} to {forecast_weeks[-1]['week_start']}")
    print(f"Wrote {out_geo}: {len(features)} ZIP boundaries")
    for a in areas:
        print(f"  {a['name']:<14} " + "  ".join(f"h{f['h']}={f['mean']:.1f}" for f in a["forecast"]))
    return data


# --- Run in Colab: export, then download both files ---------------------------
if "balanced_weekly_df" in globals():
    export_dashboard_data(balanced_weekly_df)
    from google.colab import files
    files.download("forecast_data.js")
    files.download("nyc_zip_geo.js")
