import sqlite3
import json
import os
from datetime import datetime

# Vercel's project filesystem is read-only; only /tmp is writable.
# The VERCEL environment variable is automatically set to "1" by Vercel.
if os.environ.get('VERCEL'):
    DB_PATH = '/tmp/signs.db'
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'signs.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    # Create table with meaning column
    conn.execute('''
        CREATE TABLE IF NOT EXISTS signs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            meaning     TEXT NOT NULL DEFAULT '',
            landmarks   TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )
    ''')
    # Safe migration: add meaning column if the DB existed before this feature
    try:
        conn.execute('ALTER TABLE signs ADD COLUMN meaning TEXT NOT NULL DEFAULT ""')
    except Exception:
        pass  # Column already exists — that's fine
    conn.commit()
    conn.close()

def add_sign(name, meaning, landmarks_list):
    conn = get_db()
    now = datetime.now().isoformat()
    meaning = meaning or ''
    for landmarks in landmarks_list:
        conn.execute(
            'INSERT INTO signs (name, meaning, landmarks, created_at) VALUES (?, ?, ?, ?)',
            (name, meaning, json.dumps(landmarks), now)
        )
    conn.commit()
    conn.close()

def get_all_signs():
    conn = get_db()
    rows = conn.execute(
        'SELECT id, name, meaning, landmarks, created_at FROM signs'
    ).fetchall()
    conn.close()
    return [
        {
            'id':         r['id'],
            'name':       r['name'],
            'meaning':    r['meaning'] or '',
            'landmarks':  json.loads(r['landmarks']),
            'created_at': r['created_at']
        }
        for r in rows
    ]

def get_signs_summary():
    """One row per distinct name, with sample count and meaning."""
    conn = get_db()
    rows = conn.execute('''
        SELECT
            name,
            MAX(meaning)   AS meaning,
            COUNT(*)       AS samples,
            MIN(created_at) AS created_at
        FROM signs
        GROUP BY name
        ORDER BY created_at DESC
    ''').fetchall()
    conn.close()
    return [
        {
            'name':       r['name'],
            'meaning':    r['meaning'] or '',
            'samples':    r['samples'],
            'created_at': r['created_at']
        }
        for r in rows
    ]

def update_meaning(name, meaning):
    """Update the meaning for every row that shares this sign name."""
    conn = get_db()
    conn.execute('UPDATE signs SET meaning = ? WHERE name = ?', (meaning or '', name))
    conn.commit()
    conn.close()

def delete_sign_by_name(name):
    conn = get_db()
    conn.execute('DELETE FROM signs WHERE name = ?', (name,))
    conn.commit()
    conn.close()

def get_sign_count():
    conn = get_db()
    count = conn.execute('SELECT COUNT(DISTINCT name) FROM signs').fetchone()[0]
    conn.close()
    return count
