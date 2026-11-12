/* ==========================================
   LinguaAI - chatbot.js
   Chat, historique, comptes utilisateurs, modal, paramètres
   (données stockées dans localStorage)
   ========================================== */
(() => {
    'use strict';

    // Adresse de ton backend IA. Il doit répondre en JSON : { "reply": "..." }
    const API_URL = '/api/chat';

    const KEYS = {
        users: 'lingua_users',
        session: 'lingua_session',
        settings: 'lingua_settings',
        history: email => `lingua_history_${email}`,
    };

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    async function api(path, method = 'GET', body) {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
}

    const store = {
        get(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                return v === null ? fallback : JSON.parse(v);
            } catch { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); return true; }
            catch { return false; }
        },
    };

    /* ---------- Éléments ---------- */
    const home = $('#sec-Home');
    const chatForm = $('#chatForm');
    const chatInput = $('#Linguistics');
    const chatBox = $('#chatMessages');
    const preview = $('#attachPreview');
    const fileInput = $('#fileInput');
    const imageInput = $('#imageInput');
    const historyList = $('#historyList');
    const modal = $('#authModal');
    const toastEl = $('#toast');

    /* ---------- État ---------- */
    let users = store.get(KEYS.users, []).map(u => {
        if (u.prenom === undefined) {      // anciens comptes : un seul champ "name"
            const parts = (u.name || '').trim().split(/\s+/);
            u.prenom = parts.shift() || '';
            u.nom = parts.join(' ');
            u.birth = u.birth || '';
            delete u.name;
        }
        return u;
    });
    let user = null;
    let settings = { theme: 'dark', lang: 'fr', notif: true, updates: true, ...store.get(KEYS.settings, {}) };
    let conversations = [];
    let currentId = null;
    let typingId = null;      // conversation qui attend une réponse
    let pendingFile = null;   // fichier joint avant envoi
    let authMode = 'login';

    const historyKey = () => KEYS.history(user ? user.email : 'guest');
    const fmtDate = ts => new Date(ts).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    const fullName = u => `${u.prenom} ${u.nom}`.trim();
    const today = () => new Date().toISOString().slice(0, 10);
    const birthError = v => {
        if (!v) return 'Entre ta date de naissance.';
        if (v > today() || v < '1900-01-01') return 'Date de naissance invalide.';
        return '';
    };
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    /* ---------- Toast ---------- */
    let toastTimer;
    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
    }

    /* ==========================================
       NAVIGATION ENTRE SECTIONS (ease-in-out)
       ========================================== */
    function showSection(id) {
        const target = document.getElementById(id);
        const current = $('main section.active-section');
        if (!target || target === current) return;

        $$('aside nav a[data-target]').forEach(l => l.classList.toggle('active', l.dataset.target === id));

        const swap = () => {
            $$('main section').forEach(s => s.classList.remove('active-section', 'leaving'));
            target.classList.add('active-section');
        };
        if (current) {
            current.classList.add('leaving');
            setTimeout(swap, 250);
        } else {
            swap();
        }
    }

    $$('aside nav a[data-target]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            showSection(link.dataset.target);
        });
    });

    /* ==========================================
       CHAT
       ========================================== */
    function msgEl(m) {
        const row = document.createElement('div');
        row.className = `msg ${m.role}`;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.innerHTML = m.role === 'user'
            ? '<i class="fa-regular fa-user"></i>'
            : '<i class="fa-solid fa-language"></i>';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        if (m.attach) {
            const note = document.createElement('div');
            note.className = 'attach-note';
            const icon = document.createElement('i');
            icon.className = m.attach.image ? 'fa-regular fa-image' : 'fa-solid fa-paperclip';
            note.append(icon, ' ' + m.attach.name);
            bubble.append(note);
        }
        if (m.text) bubble.append(document.createTextNode(m.text));

        row.append(avatar, bubble);
        return row;
    }

    function typingEl() {
        const row = document.createElement('div');
        row.className = 'msg assistant';
        row.innerHTML =
            '<div class="msg-avatar"><i class="fa-solid fa-language"></i></div>' +
            '<div class="msg-bubble typing"><span></span><span></span><span></span></div>';
        return row;
    }

    function renderChat() {
        const conv = conversations.find(c => c.id === currentId);
        const hasMessages = !!(conv && conv.messages.length);
        home.classList.toggle('chatting', hasMessages);
        chatBox.innerHTML = '';
        if (!hasMessages) return;
        conv.messages.forEach(m => chatBox.append(msgEl(m)));
        if (typingId === currentId) chatBox.append(typingEl());
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    function saveConversations(conv) {
        if (user) {
            if (conv) api('/api/conversations/' + conv.id, 'PUT', conv)
                .catch(() => toast('Erreur de sauvegarde'));
        } else if (!store.set(historyKey(), conversations)) {
            toast('Stockage plein : impossible de sauvegarder');
        }
    }
    // Appelle ton backend. Si il n'est pas encore branché, renvoie un message d'info.
    async function getBotReply(messages) {
        const payload = messages
            .filter(m => !m.error)
            .map(m => ({ role: m.role, content: m.text || (m.attach ? `[fichier : ${m.attach.name}]` : '') }));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: payload }),
                signal: ctrl.signal,
            });
            if (res.status === 401) return { text: 'Connecte-toi pour discuter avec LanguageBot.', error: true };
            const data = await res.json();
            const text = data.reply || data.message;
            if (!text) throw new Error('Réponse vide');
            return { text, error: false };
        } catch {
            return {
                text: "Le backend IA n'est pas encore connecté. Branche ton API sur " + API_URL + ' pour avoir de vraies réponses.',
                error: true,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async function sendMessage(rawText) {
        const text = (rawText || '').trim();
        if (typingId) { toast('Patiente, la réponse arrive...'); return; }
        if (!text && !pendingFile) return;

        let conv = conversations.find(c => c.id === currentId);
        if (!conv) {
            conv = {
                id: newId(),
                title: (text || pendingFile.name).slice(0, 40),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [],
            };
            conversations.unshift(conv);
            currentId = conv.id;
        }

        const msg = { role: 'user', text, time: Date.now() };
        if (pendingFile) msg.attach = { name: pendingFile.name, image: pendingFile.type.startsWith('image/') };
        conv.messages.push(msg);
        conv.updatedAt = Date.now();

        chatInput.value = '';
        clearAttachment();
        typingId = conv.id;
        saveConversations(conv);
        renderChat();
        renderHistory();

        const reply = await getBotReply(conv.messages);

        typingId = null;
        conv.messages.push({ role: 'assistant', text: reply.text, error: reply.error, time: Date.now() });
        conv.updatedAt = Date.now();
        saveConversations(conv);
        renderChat();
        renderHistory();
    }

    // Entrée ou bouton envoyer : les deux passent par le submit du formulaire
    chatForm.addEventListener('submit', e => {
        e.preventDefault();
        sendMessage(chatInput.value);
    });

    function newChat() {
        currentId = null;
        clearAttachment();
        renderChat();
        showSection('sec-Home');
        chatInput.focus();
    }
    $('#newChatIcon').addEventListener('click', newChat);
    $('#newChatBtn').addEventListener('click', newChat);

    /* ---------- Pièces jointes ---------- */
    $('#attachBtn').addEventListener('click', () => fileInput.click());
    $('#imageBtn').addEventListener('click', () => imageInput.click());
    [fileInput, imageInput].forEach(inp => inp.addEventListener('change', () => {
        if (inp.files[0]) setAttachment(inp.files[0]);
    }));

    function setAttachment(file) {
        pendingFile = file;
        renderAttachment();
    }
    function clearAttachment() {
        pendingFile = null;
        fileInput.value = '';
        imageInput.value = '';
        renderAttachment();
    }
    function renderAttachment() {
        preview.innerHTML = '';
        if (!pendingFile) { preview.hidden = true; return; }
        preview.hidden = false;

        const chip = document.createElement('span');
        chip.className = 'attach-chip';
        const icon = document.createElement('i');
        icon.className = pendingFile.type.startsWith('image/') ? 'fa-regular fa-image' : 'fa-solid fa-paperclip';
        const name = document.createElement('span');
        name.textContent = pendingFile.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.title = 'Retirer';
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        remove.addEventListener('click', clearAttachment);
        chip.append(icon, name, remove);
        preview.append(chip);
    }

    /* ==========================================
       HISTORIQUE
       ========================================== */
    function renderHistory() {
        historyList.innerHTML = '';
        if (!conversations.length) {
            const li = document.createElement('li');
            li.className = 'history-empty';
            li.textContent = 'Aucune conversation pour le moment.';
            historyList.append(li);
            return;
        }
        [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).forEach(c => {
            const li = document.createElement('li');
            li.className = 'settings-card history-item';

            const info = document.createElement('div');
            info.className = 'history-info';
            info.tabIndex = 0;
            info.setAttribute('role', 'button');
            const title = document.createElement('div');
            title.className = 'history-text';
            title.textContent = c.title;
            const date = document.createElement('div');
            date.className = 'history-date';
            date.textContent = fmtDate(c.updatedAt);
            info.append(title, date);

            const open = () => openConversation(c.id);
            info.addEventListener('click', open);
            info.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'history-delete';
            del.title = 'Supprimer';
            del.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
            del.addEventListener('click', () => deleteConversation(c.id));

            li.append(info, del);
            historyList.append(li);
        });
    }

    function openConversation(id) {
        currentId = id;
        clearAttachment();
        renderChat();
        showSection('sec-Home');
    }
    function deleteConversation(id) {
        if (!confirm('Supprimer cette conversation ?')) return;
        conversations = conversations.filter(c => c.id !== id);
        if (currentId === id) currentId = null;
        if (user) {
            api('/api/conversations/' + id, 'DELETE').catch(() => toast('Erreur de suppression'));
        } else {
            saveConversations();
        }
        renderChat();
        renderHistory();
    }
       async function loadUserData() {
        currentId = null;
        typingId = null;
        clearAttachment();
        if (user) {
            try { conversations = await api('/api/conversations'); }
            catch { conversations = []; }
        } else {
            conversations = store.get(historyKey(), []);
        }
        renderChat();
        renderHistory();
    }
    /* ==========================================
       COMPTES UTILISATEURS + MODAL
       ========================================== */
    async function hashPassword(pw) {
        if (window.crypto && crypto.subtle) {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
            return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return btoa(unescape(encodeURIComponent(pw)));
    }

    function paintAvatar(circle) {
        let img = $('.avatar-img', circle);
        const icon = $('i.fa-user', circle);
        if (user && user.avatar) {
            if (!img) {
                img = document.createElement('img');
                img.className = 'avatar-img';
                img.alt = 'avatar';
                circle.prepend(img);
            }
            img.src = user.avatar;
            if (icon) icon.hidden = true;
        } else {
            if (img) img.remove();
            if (icon) icon.hidden = false;
        }
    }

    function refreshUserUI() {
        $('#headerName').textContent = (user ? fullName(user) : 'Invité') + ' ';
        $('#userName').textContent = user ? user.prenom : 'invité';
        const username = $('#username');
        username.value = user ? user.email : '';
        username.placeholder = 'Non connecté';
        username.readOnly = true;
        paintAvatar($('#settingsAvatar'));
        paintAvatar($('#modalAvatar'));
    }

    function renderAccount() {
        $('#authView').hidden = !!user;
        $('#userView').hidden = !user;
        if (user) {
            $('#profilePrenom').value = user.prenom;
            $('#profileNom').value = user.nom;
            $('#profileBirth').value = user.birth || '';
            $('#profileEmail').value = user.email;
            $('#profilePass').value = '';
            paintAvatar($('#modalAvatar'));
        }
    }

    function openModal() {
        renderAccount();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            const first = user ? $('#profilePrenom') : (authMode === 'signup' ? $('#authPrenom') : $('#authEmail'));
            first.focus();
        }, 50);
    }
    function closeModal() {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    $('#userBtn').addEventListener('click', openModal);
    $('#editInfoBtn').addEventListener('click', openModal);
    $('#modalClose').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    function setAuthMode(mode) {
        authMode = mode;
        $$('#authTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        $('#signupFields').hidden = mode !== 'signup';
        $('#authSubmit').textContent = mode === 'signup' ? 'Créer mon compte' : 'Se connecter';
        $('#authTitle').textContent = mode === 'signup' ? 'Créer un compte' : 'Connexion';
        $('#authError').textContent = '';
    }
    $$('#authTabs .tab-btn').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));

    function login(u) {
        user = u;
        store.set(KEYS.session, u.email);
        $('#authForm').reset();
        closeModal();
        loadUserData();
        refreshUserUI();
        toast(`Bienvenue ${u.prenom} !`);
    }

    $('#authForm').addEventListener('submit', async e => {
        e.preventDefault();
        const err = $('#authError');
        const fail = msg => { err.textContent = msg; };
        err.textContent = '';

        const prenom = $('#authPrenom').value.trim();
        const nom = $('#authNom').value.trim();
        const birth = $('#authBirth').value;
        const email = $('#authEmail').value.trim().toLowerCase();
        const pass = $('#authPass').value;

        if (authMode === 'signup') {
            if (prenom.length < 2) return fail('Entre ton prénom (2 caractères minimum).');
            if (nom.length < 2) return fail('Entre ton nom (2 caractères minimum).');
            if (birthError(birth)) return fail(birthError(birth));
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Email invalide.');
        if (pass.length < 6) return fail('Mot de passe : 6 caractères minimum.');

               try {
            const u = await api(
                authMode === 'signup' ? '/api/register' : '/api/login',
                'POST',
                { prenom, nom, birth, email, password: pass }
            );
            login(u);
        } catch (ex) {
            fail(ex.message);
        }
    });

    $('#saveProfileBtn').addEventListener('click', async () => {
        const prenom = $('#profilePrenom').value.trim();
        const nom = $('#profileNom').value.trim();
        const birth = $('#profileBirth').value;
        const email = $('#profileEmail').value.trim().toLowerCase();
        const newPass = $('#profilePass').value;

        if (prenom.length < 2 || nom.length < 2) { toast('Prénom et nom : 2 caractères minimum'); return; }
        if (birthError(birth)) { toast(birthError(birth)); return; }
        if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Email invalide'); return; }
        if (newPass && newPass.length < 6) { toast('Mot de passe : 6 caractères minimum'); return; }

        try {
            const u = await api('/api/profile', 'PUT', { prenom, nom, birth, email, password: newPass });
            user = { ...user, ...u };
            $('#profilePass').value = '';
            refreshUserUI();
            toast('Profil enregistré');
        } catch (ex) {
            toast(ex.message);
        }
    });
    $('#logoutBtn').addEventListener('click', () => {
                api('/api/logout', 'POST');
        user = null;
        localStorage.removeItem(KEYS.session);
        closeModal();
          (async () => {
        try { user = await api('/api/me'); } catch { user = null; }
        await loadUserData();
        refreshUserUI();
    })();
        toast('Déconnecté');
    });

    /* ---------- Avatar ---------- */
    function resizeImage(file, size = 160) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = c.height = size;
                const s = Math.min(img.width, img.height);
                c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    $('#avatarEditBtn').addEventListener('click', () => {
        if (!user) { toast('Connecte-toi pour changer ta photo'); openModal(); return; }
        $('#avatarInput').click();
    });
    $('#avatarInput').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        try {
            user.avatar = await resizeImage(file);
            store.set(KEYS.users, users);
            refreshUserUI();
            toast('Photo mise à jour');
        } catch { toast("Impossible de lire l'image"); }
        e.target.value = '';
    });

    /* ==========================================
       HEADER : NOTIFICATIONS
       ========================================== */
    $('#notifBtn').addEventListener('click', () => {
        toast(settings.notif ? 'Aucune nouvelle notification' : 'Les notifications sont désactivées');
    });

    /* ==========================================
       PARAMÈTRES : thème, langue, notifications
       ========================================== */
    const saveSettings = () => store.set(KEYS.settings, settings);
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
        const dark = settings.theme === 'dark' || (settings.theme === 'auto' && darkQuery.matches);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === settings.theme));
    }
    darkQuery.addEventListener('change', () => { if (settings.theme === 'auto') applyTheme(); });

    $$('.theme-btn').forEach(btn => btn.addEventListener('click', () => {
        settings.theme = btn.dataset.theme;
        applyTheme();
        saveSettings();
    }));

    const langSelect = $('#langSelect');
    langSelect.addEventListener('change', () => {
        settings.lang = langSelect.value;
        document.documentElement.lang = settings.lang;
        saveSettings();
        toast('Langue enregistrée');
    });

    const notifSwitch = $('#notifSwitch');
    const notifUpdates = $('#notifUpdates');
    notifSwitch.addEventListener('change', () => {
        settings.notif = notifSwitch.checked;
        saveSettings();
        toast(settings.notif ? 'Notifications activées' : 'Notifications désactivées');
    });
    notifUpdates.addEventListener('change', () => {
        settings.updates = notifUpdates.checked;
        saveSettings();
    });

    /* ==========================================
       GRAMMAR / VOCABULAIRE : onglets + cartes
       ========================================== */
    // Onglet 0 = "Tout", onglet i = carte i-1
    $$('.filter-tabs').forEach(group => {
        const tabs = $$('.tab-btn', group);
        const cards = $$('.feature-card', group.parentElement);
        tabs.forEach((tab, i) => tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            cards.forEach((card, j) => { card.hidden = i !== 0 && j !== i - 1; });
        }));
    });

    // Clic sur "Commencer / Explorer" ou la flèche : lance une discussion sur ce sujet
    $$('.feature-card').forEach(card => {
        const launch = e => {
            e.preventDefault();
            const title = $('h3', card).textContent.trim();
            const desc = $('p', card).textContent.trim();
            currentId = null;
            showSection('sec-Home');
            sendMessage(`Aide-moi avec « ${title} » : ${desc}`);
        };
        $('.btn-link', card).addEventListener('click', launch);
        $('.circle-arrow-btn', card).addEventListener('click', launch);
    });

    /* ==========================================
       INIT
       ========================================== */
    $('#authBirth').max = $('#profileBirth').max = today();
    langSelect.value = settings.lang;
    document.documentElement.lang = settings.lang;
    notifSwitch.checked = settings.notif;
    notifUpdates.checked = settings.updates;
    applyTheme();
    setAuthMode('login');
    (async () => {
        try { user = await api('/api/me'); } catch { user = null; }
        await loadUserData();
        refreshUserUI();
    })();
})();