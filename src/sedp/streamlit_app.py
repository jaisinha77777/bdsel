import streamlit as st
import requests
import pandas as pd
import time
import math
API = "http://host.docker.internal:8000"

st.set_page_config(layout="wide")
st.title("SEDP Dashboard")

# --- live refresh controls (the API is fed asynchronously via /ingest, so the
#     page must re-run to pick up newly ingested data) ---
_rc1, _rc2, _rc3 = st.columns([1, 1, 6])
if _rc1.button("🔄 Refresh data"):
    st.experimental_rerun()
auto_refresh = _rc2.checkbox("Auto-refresh (5s)", value=True)
_rc3.caption("Ingest data via the API, then it appears here automatically "
             "(or click Refresh). Auto-refresh re-reads the API every 5 seconds.")


def fetch_partitions():
    try:
        r = requests.get(API + "/partitions")
        return r.json().get("partitions", [])
    except Exception:
        return []


class EWMAWithTrendLocal:
    def __init__(self, alpha=0.3):
        self.alpha = alpha
        self.ewma = None
        self.prev = None

    def update_and_predict(self, x):
        if self.ewma is None:
            self.ewma = x
            self.prev = x
            trend = 0.0
        else:
            self.prev = self.ewma
            self.ewma = self.alpha * x + (1 - self.alpha) * self.ewma
            trend = self.ewma - self.prev
        return self.ewma, trend, self.ewma + trend


def fetch_timeseries(partition, metric):
    try:
        r = requests.get(f"{API}/timeseries/{partition}/{metric}")
        return r.json().get("timeseries", [])
    except Exception:
        return []


parts = fetch_partitions()
st.write("Partitions found:", parts)
if not parts:
    st.warning("No partitions discovered from API.")

weights_col, chart_col = st.columns([1, 3])
with weights_col:
    st.header("PPEA Weights")
    w1 = st.slider("w1 (predicted_load)", 0.0, 1.0, 0.5)
    w2 = st.slider("w2 (consumer_lag)", 0.0, 1.0, 0.3)
    w3 = st.slider("w3 (processing_latency)", 0.0, 1.0, 0.2)
    s = w1 + w2 + w3 if (w1 + w2 + w3) > 0 else 1.0
    w1, w2, w3 = w1 / s, w2 / s, w3 / s

chart_col.header("Per-Partition Metrics and PPS")

rows = []
pps_vals = []
for p in parts:
    recs = fetch_timeseries(p, "records_per_sec")
    lag_ts = fetch_timeseries(p, "consumer_lag")
    lat_ts = fetch_timeseries(p, "processing_latency_ms")

    # take latest values
    latest_recs = recs[-1][1] if recs else 0.0
    latest_lag = lag_ts[-1][1] if lag_ts else 0.0
    latest_lat = lat_ts[-1][1] if lat_ts else 0.0

    # compute EWMA+trend from timeseries of records_per_sec
    est = EWMAWithTrendLocal()
    for _, v in recs:
        est.update_and_predict(v)
    ewma, trend, predicted = est.update_and_predict(latest_recs) if recs else (0.0, 0.0, 0.0)

    pps = w1 * predicted + w2 * latest_lag + w3 * latest_lat
    rows.append({
    "partition": int(p),
    "records_per_sec": float(latest_recs),
    "consumer_lag": float(latest_lag),
    "processing_latency_ms": float(latest_lat),
    "predicted_load": float(predicted),
    "pps": float(pps)
})
   
st.write("Partitions found:", parts)
st.write("Rows:", rows)
df = pd.DataFrame(rows)
if not df.empty:
    df = df.astype({
        "partition": "int64",
        "records_per_sec": "float64",
        "consumer_lag": "float64",
        "processing_latency_ms": "float64",
        "predicted_load": "float64",
        "pps": "float64"
    })
if not df.empty:
    st.subheader("Records/sec per partition")
    st.bar_chart(df.set_index("partition")["records_per_sec"])

    st.subheader("PPS per partition")
    st.bar_chart(df.set_index("partition")["pps"])

    st.subheader("Detailed Metrics")
    st.dataframe(df)


def fetch_comparison():
    try:
        r = requests.get(API + "/comparison")
        return r.json()
    except Exception:
        return {"rows": []}


comparison = fetch_comparison()
comparison_rows = comparison.get("rows", [])
if comparison_rows:
    st.subheader("Reactive Baseline vs PPEA Predictive Decisions")
    st.dataframe(pd.DataFrame(comparison_rows))

st.sidebar.header("Events")
def fetch_events():
    try:
        r = requests.get(API + "/events")
        return r.json().get("events", [])
    except Exception:
        return []

events = fetch_events()
if events:
    ev_df = pd.DataFrame(events)
    # convert timestamp
    if "ts" in ev_df.columns:
        ev_df["time"] = (
            pd.to_datetime(ev_df["ts"], unit="s", utc=True)
            .dt.tz_convert("Asia/Kolkata")
            .dt.strftime("%Y-%m-%d %H:%M:%S IST")
        )
        display_df = ev_df[["time", "action", "target", "pps", "success", "reduction"]].fillna("")
    else:
        display_df = ev_df
    st.sidebar.subheader("Evolution Events")
    st.sidebar.dataframe(display_df.sort_values(by="time", ascending=False).head(50))
else:
    st.sidebar.write("No events yet.")


# Auto-refresh: render the page first, then wait and re-run to pull fresh data.
if auto_refresh:
    time.sleep(5)
    st.experimental_rerun()


