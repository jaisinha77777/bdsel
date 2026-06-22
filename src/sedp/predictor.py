"""Predictive Load Estimator implementing EWMA and EWMA+Linear Trend extrapolation."""
from typing import Dict

class EWMAEstimator:
    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self.ewma = None

    def update(self, load: float) -> float:
        if self.ewma is None:
            self.ewma = load
        else:
            self.ewma = self.alpha * load + (1 - self.alpha) * self.ewma
        return self.ewma

class EWMAWithTrend:
    """
    EWMA + Linear Trend Extrapolation.

    Trend(t) = EWMA(t) - EWMA(t-1)
    Predicted_Load(t+1) = EWMA(t) + Trend(t)

    This is sufficient for short-horizon (1-2 windows) prediction because EWMA provides a smoothed
    baseline and the linear extrapolation of the most recent first-difference approximates short-term
    momentum without overfitting noisy samples.
    """
    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self.ewma = None
        self.prev_ewma = None

    def update_and_predict(self, load: float) -> Dict[str, float]:
        if self.ewma is None:
            self.ewma = load
            self.prev_ewma = load
            trend = 0.0
        else:
            self.prev_ewma = self.ewma
            self.ewma = self.alpha * load + (1 - self.alpha) * self.ewma
            trend = self.ewma - self.prev_ewma

        predicted = self.ewma + trend
        return {"ewma": self.ewma, "trend": trend, "predicted": predicted}
