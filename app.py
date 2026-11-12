import os, re
from functools import wraps
from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from ai_service import get_reply
import db
# 1. Kansawbo serveur w kan9ollo fin kayn lfrontend (dossier interface)
app = Flask(__name__, static_folder="interface", static_url_path="")

# 2. Clé secrète: kat7mi les sessions (cookie dyal login)
app.secret_key = "dev-change-me"


def public_user(u):
    # Kanrdo l frontend ghir ma yahtaj (b7al ism w email), mashi password
    return {"prenom": u["prenom"], "nom": u["nom"],
            "birth": u["birth"], "email": u["email"]}

def login_required(f):
    # Protection: ila ma kaynsh login, kanrfdo talab
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "email" not in session:
            return jsonify(error="Non connecté"), 401
        return f(*args, **kwargs)
    return wrapper

# --- Page principale ---
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "chatbot.html")

# --- Inscription ---
@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    prenom = d.get("prenom", "").strip()
    nom = d.get("nom", "").strip()
    email = d.get("email", "").strip().lower()
    pw = d.get("password", "")

    if len(prenom) < 2 or len(nom) < 2:
        return jsonify(error="Prénom et nom : 2 caractères minimum."), 400
    if not re.match(r"^\S+@\S+\.\S+$", email):
        return jsonify(error="Email invalide."), 400
    if len(pw) < 6:
        return jsonify(error="Mot de passe : 6 caractères minimum."), 400
    if db.get_user(email):
     return jsonify(error="Un compte existe déjà avec cet email."), 409

    db.create_user(prenom, nom, d.get("birth", ""), email, generate_password_hash(pw))
    session["email"] = email
    return jsonify(public_user(db.get_user(email))), 201
# --- Connexion ---
@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email = d.get("email", "").strip().lower()
    u = db.get_user(email)
    if not u or not check_password_hash(u["hash"], d.get("password", "")):
        return jsonify(error="Email ou mot de passe incorrect."), 401
    session["email"] = email
    return jsonify(public_user(u))

# --- Déconnexion ---
@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)

# --- Wach mazal connecté? (3ad lpage tt7ell) ---
@app.get("/api/me")
def me():
    u = db.get_user(session.get("email"))
    if not u:
        return jsonify(error="Non connecté"), 401
    return jsonify(public_user(u))

# --- Chat ---
@app.post("/api/chat")
@login_required
def chat():
    d = request.get_json(silent=True) or {}
    messages = d.get("messages", [])
    if not messages:
        return jsonify(error="Aucun message"), 400
    try:
        return jsonify(reply=get_reply(messages))
    except Exception as e:
        return jsonify(error=str(e)), 500
# --- Conversations (historique) ---
@app.get("/api/conversations")
@login_required
def list_conversations():
    return jsonify(db.get_conversations(session["email"]))

@app.put("/api/conversations/<cid>")
@login_required
def save_conv(cid):
    d = request.get_json(silent=True) or {}
    d["id"] = cid
    try:
        db.save_conversation(session["email"], d)
    except ValueError as e:
        return jsonify(error=str(e)), 403
    return jsonify(ok=True)

@app.delete("/api/conversations/<cid>")
@login_required
def delete_conv(cid):
    db.delete_conversation(cid, session["email"])
    return jsonify(ok=True)

# --- Profil ---
@app.put("/api/profile")
@login_required
def profile_update():
    d = request.get_json(silent=True) or {}
    old = session["email"]
    prenom = d.get("prenom", "").strip()
    nom = d.get("nom", "").strip()
    birth = d.get("birth", "")
    email = d.get("email", "").strip().lower()
    pw = d.get("password", "")

    if len(prenom) < 2 or len(nom) < 2:
        return jsonify(error="Prénom et nom : 2 caractères minimum."), 400
    if not re.match(r"^\S+@\S+\.\S+$", email):
        return jsonify(error="Email invalide."), 400
    if pw and len(pw) < 6:
        return jsonify(error="Mot de passe : 6 caractères minimum."), 400
    if email != old and db.get_user(email):
        return jsonify(error="Cet email est déjà utilisé."), 409

    db.update_profile(old, prenom, nom, birth)
    if pw:
        db.update_password(old, generate_password_hash(pw))
    if email != old:
        db.update_user_email(old, email)
        session["email"] = email
    return jsonify(public_user(db.get_user(email)))

# --- Statistiques ---
@app.get("/api/stats")
@login_required
def stats():
    return jsonify(db.get_progress_stats(session["email"]))
if __name__ == "__main__":
    app.run(debug=True)