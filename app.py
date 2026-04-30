from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import database as db
from classifier import SignClassifier

app = Flask(__name__)
CORS(app)

clf = SignClassifier()
# name → meaning lookup rebuilt on every retrain
name_meaning_map = {}

def retrain():
    global name_meaning_map
    signs = db.get_all_signs()
    clf.train(signs)
    # Rebuild meaning lookup from summary (one entry per distinct name)
    summary = db.get_signs_summary()
    name_meaning_map = {s['name']: s['meaning'] for s in summary}

# ── Startup ──────────────────────────────────────────────────────────────────
db.init_db()
retrain()

# ── Pages ─────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    sign_count = db.get_sign_count()
    return render_template('index.html', sign_count=sign_count)

@app.route('/add')
def add():
    return render_template('add.html')

@app.route('/detect')
def detect():
    return render_template('detect.html')

# ── Signs API ─────────────────────────────────────────────────────────────────
@app.route('/api/signs', methods=['GET'])
def get_signs():
    return jsonify(db.get_signs_summary())

@app.route('/api/signs', methods=['POST'])
def add_sign():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name        = (data.get('name')    or '').strip()
    meaning     = (data.get('meaning') or name).strip()   # default to name if omitted
    landmarks_list = data.get('landmarks', [])

    if not name:
        return jsonify({'error': 'Sign name is required'}), 400
    if not landmarks_list:
        return jsonify({'error': 'No landmark data captured'}), 400

    db.add_sign(name, meaning, landmarks_list)
    retrain()
    return jsonify({
        'success': True,
        'message': f'Action "{name}" saved — meaning: "{meaning}" ({len(landmarks_list)} frames)'
    })

@app.route('/api/signs/<path:name>', methods=['DELETE'])
def delete_sign(name):
    db.delete_sign_by_name(name)
    retrain()
    return jsonify({'success': True})

@app.route('/api/signs/<path:name>/meaning', methods=['PATCH'])
def update_meaning(name):
    data = request.get_json()
    meaning = (data.get('meaning') or '').strip()
    if not meaning:
        return jsonify({'error': 'Meaning cannot be empty'}), 400
    db.update_meaning(name, meaning)
    retrain()
    return jsonify({'success': True})

# ── Prediction API ────────────────────────────────────────────────────────────
@app.route('/api/predict', methods=['POST'])
def predict():
    data = request.get_json()
    if not data:
        return jsonify({'label': None, 'meaning': None, 'confidence': 0})

    landmarks = data.get('landmarks', [])
    if not landmarks:
        return jsonify({'label': None, 'meaning': None, 'confidence': 0})

    label, confidence = clf.predict(landmarks)

    # Attach the stored meaning (falls back to label name if none set)
    meaning = None
    if label:
        meaning = name_meaning_map.get(label) or label

    return jsonify({
        'label':      label,
        'meaning':    meaning,
        'confidence': round(confidence, 3)
    })

# ── Stats API ─────────────────────────────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
def stats():
    return jsonify({'sign_count': db.get_sign_count()})

# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import os
    venv_path = os.path.join(os.path.dirname(__file__), '.venv')
    app.run(debug=True, port=5000, host='0.0.0.0',
            exclude_patterns=[venv_path + '/*', venv_path + '\\*'])
