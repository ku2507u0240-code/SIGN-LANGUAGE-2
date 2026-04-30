import numpy as np
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics.pairwise import euclidean_distances

class SignClassifier:
    def __init__(self):
        self.model = None
        self.labels = []
        self.single_class = None
        self.rejection_threshold = None   # Max intra-class distance * margin
        self.X_train = None               # Kept for single-class distance check

    # ── Normalisation ─────────────────────────────────────────────────────────
    def _normalize(self, landmarks):
        """
        Translate wrist (landmark 0) to origin, then scale the whole vector so
        that the largest absolute coordinate becomes 1.
        Result: a 63-dimensional vector invariant to hand position and scale.
        """
        flat = []
        for lm in landmarks:
            flat.extend([lm['x'], lm['y'], lm['z']])
        if not flat:
            return []
        bx, by, bz = flat[0], flat[1], flat[2]
        normalized = []
        for i in range(0, len(flat), 3):
            normalized.extend([flat[i] - bx, flat[i + 1] - by, flat[i + 2] - bz])
        max_val = max(abs(v) for v in normalized) if normalized else 1
        if max_val > 0:
            normalized = [v / max_val for v in normalized]
        return normalized

    # ── Training ──────────────────────────────────────────────────────────────
    def train(self, signs_data):
        """
        Fit KNN on stored landmarks and compute a per-sign rejection threshold
        so that unknown gestures are rejected rather than mis-classified.
        """
        self.model = None
        self.labels = []
        self.single_class = None
        self.rejection_threshold = None
        self.X_train = None

        if not signs_data:
            return False

        X, y = [], []
        for sign in signs_data:
            vec = self._normalize(sign['landmarks'])
            if vec:
                X.append(vec)
                y.append(sign['name'])

        if not X:
            return False

        X_arr = np.array(X, dtype=np.float64)
        y_arr = np.array(y)
        unique_labels = list(set(y))
        self.labels = unique_labels
        self.X_train = X_arr  # needed for distance check when single class

        # ── Single-class special case ──────────────────────────────────────
        if len(unique_labels) == 1:
            self.single_class = unique_labels[0]
            # Rejection threshold = 2× the maximum pairwise intra-class dist
            if len(X_arr) > 1:
                dists = euclidean_distances(X_arr)
                np.fill_diagonal(dists, 0)
                self.rejection_threshold = float(np.max(dists)) * 2.0
            else:
                self.rejection_threshold = 1.5   # sensible default for 1 sample
            return True

        # ── Multi-class KNN ────────────────────────────────────────────────
        k = min(5, len(X_arr))
        self.model = KNeighborsClassifier(n_neighbors=k, metric='euclidean')
        self.model.fit(X_arr, y_arr)

        # Compute rejection threshold:
        # For every class, find the max pairwise distance between its samples.
        # Rejection threshold = global max × 2.0
        # → a test point further than this from its nearest training neighbour
        #   is almost certainly an unknown gesture.
        max_intra = 0.0
        for label in unique_labels:
            mask = y_arr == label
            vecs = X_arr[mask]
            if len(vecs) > 1:
                dists = euclidean_distances(vecs)
                np.fill_diagonal(dists, 0)
                max_intra = max(max_intra, float(np.max(dists)))

        # Fallback: if all classes had only 1 sample we use overall spread
        if max_intra == 0:
            overall_dists = euclidean_distances(X_arr)
            np.fill_diagonal(overall_dists, np.inf)
            max_intra = float(np.min(overall_dists))  # nearest-neighbour dist

        self.rejection_threshold = max_intra * 2.0
        # Safety clamp: never let threshold go below 0.3 or above 6.0
        self.rejection_threshold = max(0.3, min(self.rejection_threshold, 6.0))

        return True

    # ── Prediction ────────────────────────────────────────────────────────────
    def predict(self, landmarks):
        """
        Returns (label, confidence) or (None, 0.0) when the gesture is unknown.

        Strategy:
        1. Normalise the input vector.
        2. Find the nearest training sample and its Euclidean distance.
        3. If distance > rejection_threshold → "Sign Not Detected".
        4. Otherwise run KNN classification and return label + probability.
        """
        if not self.labels:
            return None, 0.0

        vec = self._normalize(landmarks)
        if not vec:
            return None, 0.0

        vec_arr = np.array([vec], dtype=np.float64)

        # ── Single-class path ──────────────────────────────────────────────
        if self.single_class:
            if self.X_train is not None:
                dists = euclidean_distances(vec_arr, self.X_train)[0]
                nearest_dist = float(np.min(dists))
                if nearest_dist > self.rejection_threshold:
                    return None, 0.0
            return self.single_class, 1.0

        # ── Multi-class path ───────────────────────────────────────────────
        if self.model is None:
            return None, 0.0

        # Distance check before classification
        distances, _ = self.model.kneighbors(vec_arr, n_neighbors=1)
        nearest_dist = float(distances[0][0])

        if nearest_dist > self.rejection_threshold:
            return None, 0.0   # Too far from any known sign → reject

        pred = self.model.predict(vec_arr)[0]
        proba = self.model.predict_proba(vec_arr)[0]
        confidence = float(np.max(proba))
        return pred, confidence
