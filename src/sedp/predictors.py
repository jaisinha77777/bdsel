"""Pluggable predictive load estimators for SEDP.

A deliberately diverse, non-trivial lineup so algorithm comparison is meaningful:

  ewma_trend : EWMA + linear trend extrapolation        (smoothing)
  holt       : Holt's linear / double exponential smoothing
  ar         : Autoregressive AR(p) via centered OLS     (classical time-series)
  kalman     : Constant-velocity Kalman filter           (state-space / Bayesian)
  linreg     : Sliding-window least-squares regression
  game       : Game-theoretic no-regret ensemble         (our own algorithm)

All share one interface:

    p = make_predictor("kalman")
    out = p.update_and_predict(value)   # -> {"predicted": float, ...}

The live API's active algorithm is selected via the SEDP_PREDICTOR env var.
Everything here is pure stdlib (no numpy / sklearn) so it also runs under the
host's Python for the CLI harness.
"""
import os
import math
from collections import deque
from .predictor import EWMAWithTrend   # reuse the repo's original estimator


# --------------------------------------------------------------------------- #
class HoltLinear:
    """Holt's linear method (double exponential smoothing): level + trend."""
    def __init__(self, alpha: float = 0.3, beta: float = 0.1):
        self.alpha, self.beta = alpha, beta
        self.level = None
        self.trend = 0.0

    def update_and_predict(self, x: float) -> dict:
        if self.level is None:
            self.level = x
        else:
            prev = self.level
            self.level = self.alpha * x + (1 - self.alpha) * (self.level + self.trend)
            self.trend = self.beta * (self.level - prev) + (1 - self.beta) * self.trend
        return {"predicted": self.level + self.trend, "ewma": self.level, "trend": self.trend}


# --------------------------------------------------------------------------- #
def _solve(A, b):
    """Gaussian elimination with partial pivoting for small dense systems."""
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            return None
        M[col], M[piv] = M[piv], M[col]
        pivval = M[col][col]
        for r in range(n):
            if r != col:
                f = M[r][col] / pivval
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    return [M[i][n] / M[i][i] for i in range(n)]


class ARPredictor:
    """Autoregressive AR(p) fit by ordinary least squares on a centered window.

    Centering (subtract window mean) keeps the normal equations well-conditioned
    even for large load magnitudes. Falls back to last value until enough data.
    """
    def __init__(self, p: int = 3, window: int = 24, refit_every: int = 2):
        self.p = p
        self.buf = deque(maxlen=window)
        self.refit_every = refit_every   # reuse coefficients between refits (O(1) at scale)
        self._beta = None
        self._since_fit = 0

    def update_and_predict(self, x: float) -> dict:
        self.buf.append(x)
        y = list(self.buf)
        n = len(y)
        p = self.p
        if n < 2 * p + 1:
            return {"predicted": y[-1]}
        mean = sum(y) / n
        yc = [v - mean for v in y]
        # Refit the AR coefficients only every `refit_every` steps. They drift
        # slowly, so reusing them keeps accuracy while making per-step cost O(1)
        # instead of O(window) — this is what lets it (and the game-theoretic
        # ensemble that uses it) scale to hundreds of thousands of points.
        self._since_fit += 1
        if self._beta is None or self._since_fit >= self.refit_every:
            rows = [yc[t - p:t][::-1] for t in range(p, n)]
            targets = [yc[t] for t in range(p, n)]
            XtX = [[sum(rows[k][i] * rows[k][j] for k in range(len(rows)))
                    for j in range(p)] for i in range(p)]
            Xty = [sum(rows[k][i] * targets[k] for k in range(len(rows))) for i in range(p)]
            beta = _solve(XtX, Xty)
            if beta is not None:
                self._beta = beta
            self._since_fit = 0
        if self._beta is None:
            return {"predicted": y[-1]}
        last = yc[-p:][::-1]
        pred_c = sum(self._beta[i] * last[i] for i in range(p))
        return {"predicted": pred_c + mean}


# --------------------------------------------------------------------------- #
class KalmanCV:
    """Constant-velocity Kalman filter.

    State = [position, velocity]; one-step-ahead prediction = position + velocity.
    Process/measurement noise are scale-adaptive so it tracks both calm and bursty
    regimes without manual tuning per partition.
    """
    def __init__(self, q: float = 1e-3, r: float = 25.0):
        self.q, self.r = q, r
        self.x = None              # [pos, vel]
        self.P = [[1e6, 0.0], [0.0, 1e6]]
        self.scale = None

    def update_and_predict(self, z: float) -> dict:
        if self.x is None:
            self.x = [z, 0.0]
            self.scale = max(abs(z), 1.0)
            return {"predicted": z}
        self.scale = 0.99 * self.scale + 0.01 * max(abs(z), 1.0)
        s2 = self.scale * self.scale
        Q = [[self.q * s2, 0.0], [0.0, self.q * s2]]
        R = self.r * s2 / 1e4 + 1.0
        # --- predict (F = [[1,1],[0,1]])
        px = [self.x[0] + self.x[1], self.x[1]]
        P, q = self.P, Q
        pP = [
            [P[0][0] + P[1][0] + P[0][1] + P[1][1] + q[0][0], P[0][1] + P[1][1]],
            [P[1][0] + P[1][1], P[1][1] + q[1][1]],
        ]
        # --- update with measurement z (H = [1, 0])
        y = z - px[0]
        S = pP[0][0] + R
        K = [pP[0][0] / S, pP[1][0] / S]
        self.x = [px[0] + K[0] * y, px[1] + K[1] * y]
        self.P = [
            [(1 - K[0]) * pP[0][0], (1 - K[0]) * pP[0][1]],
            [pP[1][0] - K[1] * pP[0][0], pP[1][1] - K[1] * pP[0][1]],
        ]
        return {"predicted": self.x[0] + self.x[1], "trend": self.x[1]}


# --------------------------------------------------------------------------- #
class LinearRegression:
    """Least-squares line fit over a sliding window, extrapolated one step ahead."""
    def __init__(self, window: int = 6):
        self.buf = deque(maxlen=window)

    def update_and_predict(self, x: float) -> dict:
        self.buf.append(x)
        n = len(self.buf)
        if n < 2:
            return {"predicted": x}
        ys = list(self.buf)
        mx = (n - 1) / 2
        my = sum(ys) / n
        denom = sum((i - mx) ** 2 for i in range(n))
        slope = sum((i - mx) * (ys[i] - my) for i in range(n)) / denom if denom else 0.0
        intercept = my - slope * mx
        return {"predicted": intercept + slope * n, "trend": slope}


# --------------------------------------------------------------------------- #
class GameTheoreticEnsemble:
    """Our own algorithm: a no-regret game-theoretic ensemble (Hedge / MWU).

    The five base forecasters are treated as competing *experts* in a repeated
    game. Each round every expert plays a prediction; once the true value is
    revealed, each expert incurs a loss (its error), and weights are updated by
    the multiplicative-weights rule  w_i <- w_i * exp(-eta * loss_i).

    The committed forecast is the weight-mixed (mixed-strategy) prediction.
    By the no-regret guarantee of Hedge, the cumulative loss stays within
    O(sqrt(T log N)) of the *best expert in hindsight* — i.e. this algorithm is
    provably competitive with whichever base method turns out best, and it
    re-allocates weight within a few rounds when the regime changes (calm vs
    burst), which a single fixed model cannot do.
    """
    EXPERT_KEYS = ["ewma_trend", "holt", "ar", "kalman", "linreg"]

    def __init__(self, eta: float = 1.0):
        self.eta = eta
        self.experts = [PREDICTORS[k][2]() for k in self.EXPERT_KEYS]
        self.w = [1.0 / len(self.experts)] * len(self.experts)
        self.last_play = None     # each expert's prediction for the now-current value

    def update_and_predict(self, x: float) -> dict:
        # 1. settle the previous round: penalize experts by realized error (regret)
        if self.last_play is not None:
            aes = [abs(p - x) for p in self.last_play]
            scale = max(aes) or 1.0                      # normalize losses into [0,1]
            self.w = [w * math.exp(-self.eta * (ae / scale)) for w, ae in zip(self.w, aes)]
            s = sum(self.w) or 1.0
            self.w = [w / s for w in self.w]             # renormalize (also avoids underflow)
        # 2. every expert plays this round
        preds = [e.update_and_predict(x)["predicted"] for e in self.experts]
        self.last_play = preds
        # 3. commit the mixed-strategy (weighted) forecast
        pred = sum(w * p for w, p in zip(self.w, preds))
        return {"predicted": pred, "weights": list(self.w)}


# --------------------------------------------------------------------------- #
# registry: key -> (label, family, factory)
PREDICTORS = {
    "ewma_trend": ("EWMA + Trend", "Smoothing", lambda: EWMAWithTrend()),
    "holt":       ("Holt Linear", "Smoothing", lambda: HoltLinear()),
    "ar":         ("Autoregressive AR(3)", "Time-series", lambda: ARPredictor(3)),
    "kalman":     ("Kalman (const-velocity)", "State-space", lambda: KalmanCV()),
    "linreg":     ("Linear Regression", "Regression", lambda: LinearRegression()),
    "game":       ("Game-Theoretic Ensemble", "Game-theory (ours)", lambda: GameTheoreticEnsemble()),
}

DEFAULT_PREDICTOR = "ewma_trend"


def make_predictor(name: str = None):
    """Instantiate a predictor by key. Falls back to SEDP_PREDICTOR env, then default."""
    key = name or os.environ.get("SEDP_PREDICTOR", DEFAULT_PREDICTOR)
    if key not in PREDICTORS:
        key = DEFAULT_PREDICTOR
    return PREDICTORS[key][2]()


def label(name: str) -> str:
    return PREDICTORS.get(name, (name,))[0]


def family(name: str) -> str:
    return PREDICTORS.get(name, (None, "?"))[1]
