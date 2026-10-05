"""
Builds PLACEHOLDER dashboard data so the site can be previewed before the
real export is run in Colab. Not needed for the final project.

It simulates a panel with the same shape and columns as the notebook's
`balanced_weekly_df` (351 weeks x 199 ZIPs, Sunday-start weeks ending
2026-09-20) and then runs it through the real export function, so the
pipeline is exercised end to end. Values are synthetic, scaled to the
notebook's citywide level (~430 rat sightings/week); the dashboard shows a
"demo data" note while meta.source == "demo".

Usage (from this folder):
    python make_demo_data.py path/to/ny_new_york_zip_codes_geo.min.json
"""
import json
import sys

import numpy as np
import pandas as pd

from export_dashboard_data import export_dashboard_data

# The 199 valid ZIPs printed in the notebook (12345 dropped there).
ZIPS = """10000 10001 10002 10003 10004 10005 10006 10007 10009 10010 10011 10012 10013
10014 10016 10017 10018 10019 10020 10021 10022 10023 10024 10025 10026 10027 10028 10029
10030 10031 10032 10033 10034 10035 10036 10037 10038 10039 10040 10041 10044 10045 10065
10069 10075 10105 10112 10115 10119 10123 10128 10152 10154 10155 10162 10173 10178 10278
10280 10281 10282 10301 10302 10303 10304 10305 10306 10307 10308 10309 10310 10312 10314
10451 10452 10453 10454 10455 10456 10457 10458 10459 10460 10461 10462 10463 10464 10465
10466 10467 10468 10469 10470 10471 10472 10473 10474 10475 11001 11004 11040 11101 11102
11103 11104 11105 11106 11109 11201 11203 11204 11205 11206 11207 11208 11209 11210 11211
11212 11213 11214 11215 11216 11217 11218 11219 11220 11221 11222 11223 11224 11225 11226
11228 11229 11230 11231 11232 11233 11234 11235 11236 11237 11238 11239 11249 11354 11355
11356 11357 11358 11360 11361 11362 11363 11364 11365 11366 11367 11368 11369 11370 11372
11373 11374 11375 11377 11378 11379 11385 11411 11412 11413 11414 11415 11416 11417 11418
11419 11420 11421 11422 11423 11426 11427 11428 11429 11430 11432 11433 11434 11435 11436
11691 11692 11693 11694 11695 11697""".split()

# Approximate borough shares of complaints (from the notebook's Borough counts)
BOROUGH_SHARE = {"BROOKLYN": 0.368, "MANHATTAN": 0.261, "QUEENS": 0.173,
                 "BRONX": 0.163, "STATEN ISLAND": 0.035}


def borough_of(z):
    if z.startswith("103"):
        return "STATEN ISLAND"
    if z.startswith("104"):
        return "BRONX"
    if z.startswith("10"):
        return "MANHATTAN"
    if z.startswith("112"):
        return "BROOKLYN"
    return "QUEENS"


def build_panel(seed=7):
    rng = np.random.default_rng(seed)
    weeks = pd.date_range("2020-01-05", "2026-09-20", freq="W-SUN")
    t = np.arange(len(weeks))
    # Citywide level: growth to 2023, decline after (ITS shape), summer peak
    policy = weeks >= pd.Timestamp("2023-04-12")
    t0 = np.argmax(policy)
    trend = 380 + 0.9 * t - 1.6 * np.where(policy, t - t0, 0)
    season = 1 + 0.32 * np.cos(2 * np.pi * (weeks.dayofyear - 200) / 365.25)
    city_rate = trend * season * 0.93

    rows = []
    for b, share in BOROUGH_SHARE.items():
        zs = [z for z in ZIPS if borough_of(z) == b]
        w = rng.lognormal(0, 0.9, len(zs))
        w /= w.sum()
        for z, wz in zip(zs, w):
            counts = rng.poisson(city_rate * share * wz)
            for wk, c in zip(weeks, counts):
                rows.append((wk, z, b, c))
    df = pd.DataFrame(rows, columns=["Week_Start_Sun", "Incident Zip", "Borough", "Rat Sighting"])
    df["Week_End_Sat"] = df["Week_Start_Sun"] + pd.Timedelta(days=6)
    return df


if __name__ == "__main__":
    geo = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else None
    export_dashboard_data(
        build_panel(), source="demo",
        out_data="../data/forecast_data.js", out_geo="../data/nyc_zip_geo.js",
        geojson=geo,
    )
