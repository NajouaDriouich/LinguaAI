
import sqlite3
import json
from datetime import datetime

DB_NAME = "linguaai.db"


def get_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prenom TEXT,
                nom TEXT,
                birth TEXT,
                email TEXT UNIQUE,
                hash TEXT
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                user_email TEXT NOT NULL,
                title TEXT,
                createdAt INTEGER,
                updatedAt INTEGER,
                FOREIGN KEY (user_email)
                    REFERENCES users(email) ON DELETE CASCADE
                    ON UPDATE CASCADE
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT,
                text TEXT,
                time INTEGER,
                attach TEXT,
                FOREIGN KEY (conversation_id)
                    REFERENCES conversations(id) ON DELETE CASCADE
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS exercise_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                exercise_type TEXT,
                question TEXT,
                user_answer TEXT,
                correct_answer TEXT,
                is_correct INTEGER,
                score REAL DEFAULT 0,
                max_score REAL DEFAULT 0,
                created_at TEXT,
                FOREIGN KEY (user_email)
                    REFERENCES users(email) ON DELETE CASCADE
                    ON UPDATE CASCADE
            )
        """)


def create_user(prenom, nom, birth, email, password_hash):
    init_db()
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO users (prenom, nom, birth, email, hash)
            VALUES (?, ?, ?, ?, ?)
        """, (prenom, nom, birth, email, password_hash))


def get_user(email):
    init_db()
    with get_connection() as conn:
        row = conn.execute("""
            SELECT prenom, nom, birth, email, hash
            FROM users WHERE email = ?
        """, (email,)).fetchone()

    if row is None:
        return None

    return {
        "prenom": row[0],
        "nom": row[1],
        "birth": row[2],
        "email": row[3],
        "hash": row[4]
    }


def update_profile(email, prenom, nom, birth):
    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE users
            SET prenom = ?, nom = ?, birth = ?
            WHERE email = ?
        """, (prenom, nom, birth, email))
        return cursor.rowcount > 0


def update_user_email(old_email, new_email):
    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE users SET email = ?
            WHERE email = ?
        """, (new_email, old_email))
        return cursor.rowcount > 0


def update_password(email, password_hash):
    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE users SET hash = ?
            WHERE email = ?
        """, (password_hash, email))
        return cursor.rowcount > 0


def save_conversation(user_email, conversation):
    with get_connection() as conn:
        user = conn.execute(
            "SELECT id FROM users WHERE email = ?",
            (user_email,)
        ).fetchone()

        if user is None:
            raise ValueError("Utilisateur introuvable")

        conversation_id = conversation["id"]

        existing = conn.execute(
            "SELECT user_email FROM conversations WHERE id = ?",
            (conversation_id,)
        ).fetchone()

        if existing and existing[0] != user_email:
            raise ValueError("Cette conversation appartient à un autre utilisateur")

        conn.execute("""
            INSERT INTO conversations
                (id, user_email, title, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                updatedAt = excluded.updatedAt
        """, (
            conversation_id,
            user_email,
            conversation.get("title"),
            conversation.get("createdAt"),
            conversation.get("updatedAt")
        ))

        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?",
            (conversation_id,)
        )

        for msg in conversation.get("messages", []):
            conn.execute("""
                INSERT INTO messages
                    (conversation_id, role, text, time, attach)
                VALUES (?, ?, ?, ?, ?)
            """, (
                conversation_id,
                msg.get("role"),
                msg.get("text"),
                msg.get("time"),
                json.dumps(msg.get("attach")) if msg.get("attach") else None
            ))


def get_conversations(user_email):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT id, title, createdAt, updatedAt
            FROM conversations
            WHERE user_email = ?
            ORDER BY updatedAt DESC
        """, (user_email,)).fetchall()

        conversations = []

        for row in rows:
            messages = conn.execute("""
                SELECT role, text, time, attach
                FROM messages
                WHERE conversation_id = ?
                ORDER BY time, id
            """, (row[0],)).fetchall()

            conversations.append({
                "id": row[0],
                "title": row[1],
                "createdAt": row[2],
                "updatedAt": row[3],
                "messages": [
                    {
                        "role": m[0],
                        "text": m[1],
                        "time": m[2],
                        "attach": json.loads(m[3]) if m[3] else None
                    }
                    for m in messages
                ]
            })

        return conversations


def delete_conversation(conversation_id, user_email):
    with get_connection() as conn:
        cursor = conn.execute("""
            DELETE FROM conversations
            WHERE id = ? AND user_email = ?
        """, (conversation_id, user_email))
        return cursor.rowcount > 0


def save_exercise_result(
    user_email,
    exercise_type,
    question,
    user_answer,
    correct_answer=None,
    is_correct=None,
    score=0,
    max_score=0
):
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO exercise_results (
                user_email, exercise_type, question,
                user_answer, correct_answer, is_correct,
                score, max_score, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_email,
            exercise_type,
            question,
            user_answer,
            correct_answer,
            is_correct,
            score,
            max_score,
            datetime.now().isoformat()
        ))


def get_progress_stats(user_email):
    with get_connection() as conn:
        total_conversations = conn.execute("""
            SELECT COUNT(*) FROM conversations
            WHERE user_email = ?
        """, (user_email,)).fetchone()[0]

        total_messages = conn.execute("""
            SELECT COUNT(*)
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE c.user_email = ?
        """, (user_email,)).fetchone()[0]

        row = conn.execute("""
            SELECT
                COUNT(*),
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END),
                SUM(score),
                SUM(max_score)
            FROM exercise_results
            WHERE user_email = ?
        """, (user_email,)).fetchone()

    total_exercises = row[0] or 0
    correct = row[1] or 0
    incorrect = row[2] or 0
    score = row[3] or 0
    max_score = row[4] or 0

    percentage = (score / max_score * 100) if max_score else 0

    return {
        "total_conversations": total_conversations,
        "total_messages": total_messages,
        "total_exercises": total_exercises,
        "correct_answers": correct,
        "incorrect_answers": incorrect,
        "total_score": score,
        "max_score": max_score,
        "success_percentage": round(percentage, 2)
    }
init_db()
