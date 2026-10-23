/*
 * Origami Music: Music Assistant cards for Home Assistant in the Origami style. See the README for the options.
 *
 * type: custom:origami-music
 * layout: app                                 # banner, shelf, player, speakers, queue, library, app, nowplaying, group, or none (tabs)
 * select: input_select.speaker                # follows the speaker chosen in an input_select
 * players:                                    # chosen speaker -> Music Assistant player
 *   media_player.living_room_cast: media_player.living_room
 * entity: media_player.living_room            # without select, the Music Assistant player to follow
 * trends: { France: sensor.charts_france }     # app: chart sensors by zone, see the README
 * player_path / speakers_path / ma_path        # app, nowplaying: the player and speakers pop-ups, the Music Assistant page
 */
const ORIGAMI_MUSIC_VERSION = "0.8.0";

function resolvePlayer(config, states) {
  const sel = config.select ? states?.[config.select]?.state : null;
  const chosen = sel && sel !== "unknown" && sel !== "unavailable" ? sel : null;
  const players = config.players ?? {};
  const ma = chosen ? (players[chosen] ?? chosen) : (config.entity ?? null);
  return { chosen, ma };
}

function queueView(items, currentUri, max) {
  if (!Array.isArray(items) || !items.length) return { rows: [], upcoming: 0 };
  const found = currentUri ? items.findIndex((it) => it && it.uri === currentUri) : -1;
  const start = Math.max(found, 0);
  return {
    rows: items.slice(start, start + max).map((it, k) => ({ it, index: start + k, current: k === 0 && found >= 0 })),
    upcoming: items.length - start - (found >= 0 ? 1 : 0),
  };
}

function formatDuration(seconds) {
  const n = Math.round(Number(seconds) || 0);
  if (n <= 0) return "";
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

function safeImage(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

// Alternates the lists (playlist 1, album 1, playlist 2...), as Music Assistant does not give the time something was played
function interleave(lists) {
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

// Trending: rank and move against the previous chart (a list of track ids)
function trendRows(tracks, previous) {
  const prev = Array.isArray(previous) ? previous : [];
  return (Array.isArray(tracks) ? tracks : []).map((t, i) => {
    const j = prev.indexOf(t?.id);
    const move = !prev.length ? "" : j < 0 ? "new" : j > i ? "up" : j < i ? "down" : "same";
    return { ...t, rank: i + 1, move, gap: j < 0 ? 0 : Math.abs(j - i) };
  });
}

// Comparison of titles and artists without accents and case; loose also drops "(feat. ...)" and "[...]"
function normName(s, loose) {
  const n = String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return (loose ? n.replace(/\(.*?\)|\[.*?\]/g, " ") : n).replace(/[^a-z0-9]+/g, " ").trim();
}

// Best search result for a title and its artist. The exact title comes first, so a remix does not win over the
// original; the loose title only after that, for a "(feat. ...)" on one side only. Else the first result.
function pickTrack(tracks, title, artist) {
  const A = normName(artist);
  const list = Array.isArray(tracks) ? tracks : [];
  const byArtist = (it) => (it?.artists ?? []).some((a) => { const n = normName(a?.name); return !!n && !!A && (A.includes(n) || n.includes(A)); });
  for (const loose of [false, true]) {
    const same = (it) => normName(it?.name, loose) === normName(title, loose);
    const hit = list.find((it) => same(it) && byArtist(it)) ?? list.find(same);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

// Date of a chart: today, yesterday, or day/month
function dayLabel(iso, now, t) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = Math.round((midnight(now) - midnight(d)) / 86400000);
  return n <= 0 ? t.today : n === 1 ? t.yesterday : t.on + String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
}

// Short name for a radio tile: "Radio Nova" -> "Nova", "France Inter" -> "Inter"
function radioShort(name) {
  return String(name ?? "").trim().replace(/^(radio|france)\s+/i, "").split(/\s+/)[0] || String(name ?? "");
}

// The Music Assistant categories of the library root, without the other media sources of Home Assistant
const ORIGAMI_MUSIC_CATEGORIES = ["artists", "albums", "tracks", "playlists", "radio", "podcasts", "audiobooks"];
function libraryRoot(children) {
  return (children ?? []).filter((c) => ORIGAMI_MUSIC_CATEGORIES.includes(c?.media_content_id))
    .sort((a, b) => ORIGAMI_MUSIC_CATEGORIES.indexOf(a.media_content_id) - ORIGAMI_MUSIC_CATEGORIES.indexOf(b.media_content_id));
}

const ORIGAMI_MUSIC_CLASSES = ["artist", "album", "track", "playlist", "podcast", "audiobook", "radio", "channel"];
function groupResults(results) {
  const groups = new Map();
  for (const r of results ?? []) {
    const k = ORIGAMI_MUSIC_CLASSES.includes(r?.media_class) ? r.media_class : "other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].sort((a, b) => {
    const ia = ORIGAMI_MUSIC_CLASSES.indexOf(a[0]), ib = ORIGAMI_MUSIC_CLASSES.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function omEsc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Browsers block an http image on an https page, so it goes through the signed image proxy of Bubble Card Tools
function needsProxy(url, pageProtocol) {
  return pageProtocol === "https:" && /^http:\/\//i.test(url ?? "");
}

const ORIGAMI_MUSIC_TEXT = {
  fr: {
    none: "Aucune file", empty: "File vide", load: "Chargement…", one: " titre à venir", many: " titres à venir",
    last: "Dernier titre", err: "Erreur : ", nosel: "Aucune enceinte choisie", noent: "Lecteur introuvable : ",
    tabs: { queue: "File", browse: "Bibliothèque", search: "Recherche" }, back: "Retour", play: "Jouer",
    next: "Lire ensuite", placeholder: "Artiste, album, titre…", noresult: "Aucun résultat", nothing: "Rien ici",
    cat: { artists: "Artistes", albums: "Albums", tracks: "Titres", playlists: "Playlists", radio: "Radios",
           podcasts: "Podcasts", audiobooks: "Livres audio" },
    cls: { artist: "Artistes", album: "Albums", track: "Titres", playlist: "Playlists", podcast: "Podcasts",
           audiobook: "Livres audio", radio: "Radios", channel: "Radios", other: "Autres" },
    sent: "Envoyé à ", playnext: "Sera lu ensuite sur ", recent: "Récemment écoutés", resume: "Reprendre", idle: "Rien en lecture",
    nowplaying: "En lecture : ", toplayer: "Lecture", recentf: "Récentes ›", recentm: "Récents ›", books: "Livres",
    speakers: "Enceintes", tick: "cocher pour écouter partout", upnext: "À suivre", tracks: " titres", track1: " titre",
    leads: "mène le groupe", with: "Avec ", inactive: "Inactive", paused: "En pause", playing: "En lecture", offline: "Hors ligne",
    nogroup: "sans groupe", solo: " ne peut pas rejoindre de groupe", sololead: " joue seule : pas de groupe possible",
    kind: { playlist: "Playlist", album: "Album", artist: "Artiste", track: "Titre", radio: "Radio", podcast: "Podcast", audiobook: "Livre audio" },
    home: "Accueil", searchTab: "Recherche", libTab: "Bibliothèque", played: "Écouté récemment", trends: "Tendances du moment",
    updated: "Mis à jour ", today: "aujourd'hui", yesterday: "hier", on: "le ",
    top: "Top 20 ›", topLess: "Top 5 ‹", isNew: "nouveau", radios: "Radios", edit: "Modifier ›", favs: "Tes favoris", all: "Tout ›",
    artists: "Tes artistes", liked: "Titres favoris", recentSearches: "Recherches récentes", clear: "Tout effacer", browse: "Parcourir",
    added: "Ajouts récents", sortRecent: "Récents", sortAZ: "De A à Z", playAll: "Tout lire", openMA: "Ouvrir Music Assistant",
    like: "Ajouté à tes favoris", unlike: "Retiré de tes favoris", notFound: "Introuvable pour l'instant : ", looking: "Recherche de ",
    speakersN: " enceintes", inplay: "Lecture en cours", forget: "Effacer ", wait: "Patiente un instant…",
    group: "Groupe", volumes: "Volume de chaque enceinte", quiet: "Doux", medium: "Moyen", loud: "Fort",
    alsoOn: "Écouter aussi sur", ungroup: "Dégrouper", allSpeakers: "Toutes",
  },
  en: {
    none: "No queue", empty: "Queue empty", load: "Loading…", one: " item up next", many: " items up next",
    last: "Last item", err: "Error: ", nosel: "No speaker selected", noent: "Player not found: ",
    tabs: { queue: "Now playing", browse: "Library", search: "Search" }, back: "Back", play: "Play",
    next: "Play next", placeholder: "Artist, album, track…", noresult: "No results", nothing: "Nothing here",
    cat: { artists: "Artists", albums: "Albums", tracks: "Tracks", playlists: "Playlists", radio: "Radio",
           podcasts: "Podcasts", audiobooks: "Audiobooks" },
    cls: { artist: "Artists", album: "Albums", track: "Tracks", playlist: "Playlists", podcast: "Podcasts",
           audiobook: "Audiobooks", radio: "Radio", channel: "Radio", other: "Other" },
    sent: "Sent to ", playnext: "Will play next on ", recent: "Recently played", resume: "Resume", idle: "Nothing playing",
    nowplaying: "Now playing: ", toplayer: "Player", recentf: "Recent ›", recentm: "Recent ›", books: "Audiobooks",
    speakers: "Speakers", tick: "tick to play everywhere", upnext: "Up next", tracks: " tracks", track1: " track",
    leads: "leads the group", with: "With ", inactive: "Idle", paused: "Paused", playing: "Playing", offline: "Offline",
    nogroup: "no groups", solo: " can't join a group", sololead: " plays alone, so no group is possible",
    kind: { playlist: "Playlist", album: "Album", artist: "Artist", track: "Track", radio: "Radio", podcast: "Podcast", audiobook: "Audiobook" },
    home: "Home", searchTab: "Search", libTab: "Library", played: "Recently played", trends: "Trending now",
    updated: "Updated ", today: "today", yesterday: "yesterday", on: "on ",
    top: "Top 20 ›", topLess: "Top 5 ‹", isNew: "new", radios: "Radio", edit: "Edit ›", favs: "Your favorites", all: "All ›",
    artists: "Your artists", liked: "Liked songs", recentSearches: "Recent searches", clear: "Clear all", browse: "Browse",
    added: "Recently added", sortRecent: "Recent", sortAZ: "A to Z", playAll: "Play all", openMA: "Open Music Assistant",
    like: "Added to your favorites", unlike: "Removed from your favorites", notFound: "Not found for now: ", looking: "Looking for ",
    speakersN: " speakers", inplay: "Now playing", forget: "Remove ", wait: "One moment…",
    group: "Group", volumes: "Volume of each speaker", quiet: "Quiet", medium: "Medium", loud: "Loud",
    alsoOn: "Also play on", ungroup: "Ungroup", allSpeakers: "All",
  },
};

// Browse tiles of the search tab: library category, icon, tint
const ORIGAMI_MUSIC_BROWSE = [
  { k: "playlist", cat: "playlists", icon: "mdi:playlist-music", ink: "#3f5f74" },
  { k: "album", cat: "albums", icon: "mdi:album", ink: "#7a5c3c" },
  { k: "artist", cat: "artists", icon: "mdi:account-music-outline", ink: "#55703f" },
  { k: "radio", cat: "radio", icon: "mdi:radio", ink: "#a35a3f" },
  { k: "favs", icon: "mdi:heart", ink: "#9b4f63" },
  { k: "added", icon: "mdi:new-box", ink: "#5f5277" },
];
const ORIGAMI_MUSIC_RADIO_COLORS = ["#6f93ab", "#c9785c", "#8c7aa0", "#7f9a6d", "#b89a5e", "#9b6f7e"];
const ORIGAMI_MUSIC_LIVE = ["playing", "paused", "buffering"];

const ORIGAMI_MUSIC_ICONS = {
  artists: "mdi:account-music-outline", albums: "mdi:album", tracks: "mdi:music-note", playlists: "mdi:playlist-music",
  radio: "mdi:radio", podcasts: "mdi:podcast", audiobooks: "mdi:book-music-outline",
  artist: "mdi:account-music-outline", album: "mdi:album", track: "mdi:music-note", playlist: "mdi:playlist-music",
  podcast: "mdi:podcast", audiobook: "mdi:book-music-outline", channel: "mdi:radio", directory: "mdi:folder-music-outline",
};

const OrigamiBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class OrigamiMusic extends OrigamiBase {
  setConfig(config) {
    if (!config || (!config.select && !config.entity)) throw new Error("origami-music: `select` or `entity` is required");
    this._config = { limit: 10, fetch: 200, ...config };
    this._m = { ma: null, qid: null, cur: null, at: 0, items: null, pending: false, err: null };
    this._tab = this._tab ?? "queue";
    this._stack = this._stack ?? [];          // library levels: { id, type, title, children, err }
    this._search = this._search ?? { q: "", results: null, loading: false, err: null, timer: null, seq: 0 };
    this._images = this._images ?? new Map(); // image address -> signed proxy address
    this._sig = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  getCardSize() { return ["banner", "shelf"].includes(this._config?.layout) ? 3 : this._config?.layout === "app" ? 12 : 6; }
  getGridOptions() { return { columns: 12, rows: "auto", min_rows: 3 }; }

  set hass(hass) {
    this._hass = hass;
    try { this._update(); } catch (e) { this._fail(e); }
  }

  _t() {
    const lang = (this._hass?.locale?.language ?? this._hass?.language ?? "en").slice(0, 2);
    return ORIGAMI_MUSIC_TEXT[lang] ?? ORIGAMI_MUSIC_TEXT.en;
  }

  _safe(fn) { try { fn(); } catch (e) { this._fail(e); } }

  _pct(v) { return Number(v).toLocaleString(this._hass?.locale?.language ?? "en", { style: "percent", maximumFractionDigits: 0 }); }

  _update() {
    const hass = this._hass, m = this._m, cfg = this._config;
    if (!hass || !cfg) return;
    const { chosen, ma } = resolvePlayer(cfg, hass.states);
    const st = ma ? hass.states[ma] : null;
    const a = st?.attributes ?? {};
    const qid = a.active_queue ?? null;
    const cur = a.media_content_id ?? "";
    if (m.ma !== ma) { m.items = null; m.err = null; }
    const stale = m.ma !== ma || m.qid !== qid || m.cur !== cur || Date.now() - m.at > 10000;
    m.ma = ma;
    if (((!cfg.layout && this._tab === "queue") || cfg.layout === "queue") && qid && stale && !m.pending) {
      m.pending = true; m.qid = qid; m.cur = cur; m.at = Date.now();
      hass.callWS({ type: "bubble_card_tools/ma_queue_items", queue_id: qid, limit: Number(cfg.fetch) })
        .then((r) => { m.items = Array.isArray(r?.items) ? r.items : []; m.err = null; })
        .catch((e) => { m.items = null; m.err = e?.message ?? String(e); })
        .finally(() => { m.pending = false; this._sig = null; this._safe(() => (cfg.layout === "queue" ? this._renderQueue() : this._render())); });
    }
    this._ctx = { chosen, ma, st, qid, cur };
    if (cfg.layout === "app") { this._renderApp(); return; }
    if (cfg.layout === "nowplaying") { this._renderNowPlaying(); return; }
    if (cfg.layout === "group") { this._renderGroup(); return; }
    if (cfg.layout === "banner") { this._fetchRecent(); this._renderBanner(); return; }
    if (cfg.layout === "shelf") { this._fetchRecent(); this._renderShelf(); return; }
    if (cfg.layout === "player") { this._renderPlayer(); return; }
    if (cfg.layout === "speakers") { this._renderSpeakers(); return; }
    if (cfg.layout === "queue") { this._renderQueue(); return; }
    if (cfg.layout === "library") { this._fetchLibHome(); this._renderLibrary(); return; }
    this._render();
  }

  // Recently played albums and playlists, shared by the cards of the page and read again every 10 minutes
  async _fetchRecent() {
    const key = [(this._config.recent ?? ["playlist", "album"]).join(","), this._config.limit].join("|");
    const shared = (window.__origamiMusicRecent ??= {});
    const r = this._recent = (shared[key] ??= { items: null, at: 0, pending: false, err: null, entry: null, cards: new Set() });
    r.cards.add(this);
    if (r.pending || Date.now() - r.at < 10 * 60 * 1000) return;
    r.pending = true; r.at = Date.now();
    try {
      const hass = this._hass, cfg = this._config;
      if (!r.entry) r.entry = cfg.config_entry_id ?? (await hass.callWS({ type: "config_entries/get", domain: "music_assistant" }))?.[0]?.entry_id;
      const per = Number(cfg.limit);
      const lists = await Promise.all((cfg.recent ?? ["playlist", "album"]).map((type) => hass.callWS({
        type: "call_service", domain: "music_assistant", service: "get_library", return_response: true,
        service_data: { config_entry_id: r.entry, media_type: type, order_by: "last_played_desc", limit: per },
      }).then((x) => x?.response?.items ?? [])));
      r.items = interleave(lists).slice(0, per);
      r.err = null;
    } catch (e) {
      r.err = e?.message ?? String(e);
    } finally {
      r.pending = false;
      // Every card that waits for this read draws it, not only the one that started it
      for (const c of r.cards) {
        if (!c.isConnected) { r.cards.delete(c); continue; }
        c._sig = null;
        c._safe(() => (c._config.layout === "banner" ? c._renderBanner() : c._renderShelf()));
      }
    }
  }

  _browse(id, type, title) {
    const level = { id, type, title, children: null, err: null };
    this._stack.push(level);
    this._sig = null;
    this._render();
    const msg = { type: "media_player/browse_media", entity_id: this._ctx.ma };
    if (id) { msg.media_content_id = id; msg.media_content_type = type; }
    this._hass.callWS(msg)
      .then((r) => { level.children = id ? (r?.children ?? []) : libraryRoot(r?.children); })
      .catch((e) => { level.err = e?.message ?? String(e); level.children = []; })
      .finally(() => { this._sig = null; this._safe(() => this._render()); });
  }

  _runSearch(q) {
    const s = this._search;
    s.q = q;
    clearTimeout(s.timer);
    if (q.trim().length < 2) { s.results = null; s.loading = false; s.err = null; this._sig = null; this._renderSearchResults(); return; }
    s.timer = setTimeout(() => {
      const seq = ++s.seq;
      s.loading = true; s.err = null; this._renderSearchResults();
      this._hass.callWS({ type: "media_player/search_media", entity_id: this._ctx.ma, search_query: q.trim() })
        .then((r) => { if (seq === s.seq) s.results = Array.isArray(r?.result) ? r.result : (r?.result?.children ?? []); })
        .catch((e) => { if (seq === s.seq) { s.err = e?.message ?? String(e); s.results = []; } })
        .finally(() => { if (seq === s.seq) { s.loading = false; this._safe(() => this._renderSearchResults()); } });
    }, 400);
  }

  _play(id, type, enqueue) {
    const ma = this._ctx?.ma;
    if (!ma || !id) return;
    this._hass.callService("media_player", "play_media", { entity_id: ma, media_content_id: id, media_content_type: type ?? "music", enqueue })
      .then(() => {
        this._toast((enqueue === "next" ? this._t().playnext : this._t().sent) + (this._names()[ma] ?? this._ctx.st?.attributes?.friendly_name ?? ma));
        this._m.at = 0;
      })
      .catch((e) => this._toast(this._t().err + (e?.message ?? e)));
  }

  _queueCommand(command, extra) {
    const m = this._m;
    if (!m.qid) return;
    this._hass.callWS({ type: "bubble_card_tools/ma_queue_command", queue_id: m.qid, command, ...extra })
      .then(() => { m.at = 0; })
      .catch((e) => { m.err = e?.message ?? String(e); this._sig = null; this._render(); });
  }

  _image(el, url) {
    const src = safeImage(url);
    if (!src) return false;
    const proto = typeof location !== "undefined" ? location.protocol : "http:";
    if (!needsProxy(src, proto)) { el.src = src; return true; }
    const done = this._images.get(src);
    if (done) { el.src = done; return true; }
    this._hass.callWS({ type: "auth/sign_path", path: "/api/bubble_card_tools/thumb?url=" + encodeURIComponent(src), expires: 86400 })
      .then((r) => { if (r?.path) { this._images.set(src, r.path); el.src = r.path; } })
      .catch(() => {});
    return true;
  }

  _render() {
    if (this._config?.layout === "library") { this._renderLibrary(); return; }
    if (this._config?.layout === "app") { this._renderApp(); return; }
    const root = this.shadowRoot, t = this._t();
    if (!root || !this._ctx) return;
    const { chosen, ma, st, qid, cur } = this._ctx;
    const m = this._m, cfg = this._config;
    const name = cfg.name ?? (chosen ? this._hass.states[chosen]?.attributes?.friendly_name : null) ?? st?.attributes?.friendly_name ?? ma ?? "";
    const v = queueView(m.items, cur, Number(cfg.limit));
    const n = m.items?.length;
    const status = !ma ? t.nosel : !st ? t.noent + ma : m.err ? t.err + m.err : !qid ? t.none
      : n == null ? t.load : n === 0 ? t.empty : v.upcoming > 0 ? v.upcoming + (v.upcoming > 1 ? t.many : t.one) : t.last;
    const level = this._stack[this._stack.length - 1];
    const sig = [this._tab, ma, qid, cur, status, name, v.rows.map((r) => r.it.queue_item_id).join(","),
      this._stack.length, level?.children?.length ?? -1, level?.err ?? ""].join("|");
    if (sig === this._sig) return;
    this._sig = sig;

    if (!root.querySelector("ha-card")) this._skeleton();
    const card = root.querySelector("ha-card");
    card.querySelector(".name").textContent = name;
    card.querySelector(".status").textContent = status;
    card.querySelector(".version").textContent = "v" + ORIGAMI_MUSIC_VERSION;
    for (const chip of card.querySelectorAll(".tab")) {
      chip.textContent = t.tabs[chip.dataset.tab];
      chip.classList.toggle("on", chip.dataset.tab === this._tab);
    }
    const body = card.querySelector(".body");
    if (this._tab === "queue") body.replaceChildren(...this._queueRows(v));
    else if (this._tab === "browse") body.replaceChildren(...this._browseView());
    else this._searchView(body);
  }

  _skeleton() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = ORIGAMI_MUSIC_CSS;
    const card = document.createElement("ha-card");
    card.innerHTML = '<div class="head"><div class="titles"><div class="name"></div><div class="status"></div></div>'
      + '<div class="version"></div></div>'
      + '<div class="tabs"><div class="tab" data-tab="queue"></div><div class="tab" data-tab="browse"></div>'
      + '<div class="tab" data-tab="search"></div></div><div class="body"></div><div class="toast"></div>';
    card.querySelector(".tabs").addEventListener("click", (ev) => {
      const chip = ev.target.closest(".tab");
      if (!chip || chip.dataset.tab === this._tab) return;
      this._tab = chip.dataset.tab;
      this._sig = null;
      this._safe(() => {
        if (this._tab === "browse" && !this._stack.length) this._browse("", "", "");
        else if (this._tab === "queue") { this._m.at = 0; this._update(); }
        else this._render();
      });
    });
    card.querySelector(".body").addEventListener("click", (ev) => this._safe(() => this._onClick(ev)));
    root.append(style, card);
  }

  _onClick(ev) {
    const act = ev.target.closest("[data-act]");
    if (!act) return;
    ev.stopPropagation();
    const d = act.dataset;
    if (d.act === "queue-play") this._queueCommand("play_index", { index: Number(d.index) });
    else if (d.act === "back") { this._stack.pop(); this._sig = null; this._render(); }
    else if (d.act === "open") this._browse(d.id, d.type, d.title);
    else if (d.act === "play") this._play(d.id, d.type, "play");
    else if (d.act === "next") this._play(d.id, d.type, "next");
    else if (d.act === "play-now") this._play(d.id, d.type, "replace");
  }

  _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  _icon(name) {
    const i = document.createElement("ha-icon");
    i.setAttribute("icon", name);
    return i;
  }

  _thumb(url, icon) {
    const box = this._el("div", "thumb");
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    if (this._image(img, url)) box.append(img); else box.append(this._icon(icon));
    return box;
  }

  _queueRows(v) {
    return v.rows.map((r) => {
      const row = this._el("div", "row" + (r.current ? " current" : ""));
      if (!r.current) { row.dataset.act = "queue-play"; row.dataset.index = String(r.index); }
      const text = this._el("div", "text");
      text.append(this._el("div", "title", r.it.name ?? ""),
        this._el("div", "sub", [r.it.artists, r.it.album].filter((x) => typeof x === "string" && x).join(" • ")));
      row.append(this._thumb(r.it.image, "mdi:music-note"), text, this._el("div", "dur", formatDuration(r.it.duration)));
      return row;
    });
  }

  _browseView() {
    const t = this._t();
    const level = this._stack[this._stack.length - 1];
    const out = [];
    if (!level) return out;
    const app = this._config?.layout === "app";
    // In the app layout every page opens over the tab, and the arrow goes back to it
    if (this._stack.length > 1 || app) {
      const back = this._el("div", "back");
      back.dataset.act = "back";
      back.append(this._icon("mdi:chevron-left"), this._el("span", null, level.title || t.back));
      out.push(back);
    }
    if (level.children == null) { out.push(this._el("div", "hint", t.load)); return out; }
    if (level.err) { out.push(this._el("div", "hint error", t.err + level.err)); return out; }
    if (!level.children.length) { out.push(this._el("div", "hint", t.nothing)); return out; }
    if (app && level.id && ["playlist", "album", "artist"].includes(level.type)) {
      const all = this._el("div", "playall");
      Object.assign(all.dataset, { act: "play-now", id: level.id, type: level.type });
      all.append(this._icon("mdi:play"), this._el("span", null, t.playAll));
      out.push(all);
    }
    if (!level.id) {
      const grid = this._el("div", "grid");
      for (const c of level.children) {
        const tile = this._el("div", "tile");
        Object.assign(tile.dataset, { act: "open", id: c.media_content_id, type: c.media_content_type, title: t.cat[c.media_content_id] ?? c.title });
        tile.append(this._icon(ORIGAMI_MUSIC_ICONS[c.media_content_id] ?? "mdi:folder-music-outline"),
          this._el("span", null, t.cat[c.media_content_id] ?? c.title));
        grid.append(tile);
      }
      out.push(grid);
      return out;
    }
    out.push(...level.children.map((c) => this._itemRow(c)));
    return out;
  }

  _itemRow(c) {
    const t = this._t();
    const row = this._el("div", "row item");
    const id = c.media_content_id, type = c.media_content_type;
    if (c.can_expand) Object.assign(row.dataset, { act: "open", id, type, title: c.title ?? "" });
    else if (c.can_play) Object.assign(row.dataset, { act: "play", id, type });
    const text = this._el("div", "text");
    text.append(this._el("div", "title", c.title ?? ""));
    if (c.sub) text.append(this._el("div", "sub", c.sub));
    row.append(this._thumb(c.thumbnail, ORIGAMI_MUSIC_ICONS[c.media_class] ?? "mdi:music-note"), text);
    // A heart on radio results adds them to the radio row of the app layout (Music Assistant favorites)
    if (this._config?.layout === "app" && c.media_class === "radio") row.append(this._heart(id));
    if (c.can_play) {
      const acts = this._el("div", "acts");
      for (const [act, icon, label] of [["next", "mdi:skip-next", t.next], ["play", "mdi:play", t.play]]) {
        const b = this._el("div", "act" + (act === "play" ? " main" : ""));
        Object.assign(b.dataset, { act, id, type });
        b.title = label;
        b.append(this._icon(icon));
        acts.append(b);
      }
      row.append(acts);
    }
    return row;
  }

  _searchView(body) {
    const t = this._t();
    let box = body.querySelector(".search");
    if (!box) {
      body.replaceChildren();
      box = this._el("div", "search");
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = t.placeholder;
      input.value = this._search.q;
      input.addEventListener("input", () => this._safe(() => this._runSearch(input.value)));
      box.append(this._icon("mdi:magnify"), input);
      body.append(box, this._el("div", "results"));
    }
    this._renderSearchResults();
  }

  _renderSearchResults() {
    if (this._config?.layout === "library") { this._sigLib = null; this._renderLibrary(); return; }
    if (this._config?.layout === "app") { this._renderApp(); return; }
    const body = this.shadowRoot?.querySelector(".body");
    const res = body?.querySelector(".results");
    if (!res) return;
    const t = this._t(), s = this._search;
    if (s.loading) { res.replaceChildren(this._el("div", "hint", t.load)); return; }
    if (s.err) { res.replaceChildren(this._el("div", "hint error", t.err + s.err)); return; }
    if (s.results == null) { res.replaceChildren(); return; }
    if (!s.results.length) { res.replaceChildren(this._el("div", "hint", t.noresult)); return; }
    const out = [];
    for (const [cls, items] of groupResults(s.results)) {
      out.push(this._el("div", "section", t.cls[cls] ?? cls));
      out.push(...items.map((c) => this._itemRow(c)));
    }
    res.replaceChildren(...out);
  }

  _speakerName(chosen, ma) {
    const cfg = this._config, S = this._hass.states;
    return cfg.names?.[chosen] ?? (chosen ? S[chosen]?.attributes?.friendly_name : null) ?? S[ma]?.attributes?.friendly_name ?? "";
  }

  _go(path) {
    // Same as the navigate action of Home Assistant, which Bubble Card pop-ups listen to
    path = path ?? this._config.navigation_path;
    if (!path) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _art(box, url, icon) {
    if (url) {
      const img = document.createElement("img");
      img.alt = "";
      if (url.startsWith("/")) img.src = url; else if (!this._image(img, url)) { box.replaceChildren(this._icon(icon)); return; }
      box.replaceChildren(img);
    } else box.replaceChildren(this._icon(icon));
  }

  // What plays on the chosen speaker, or, when nothing plays, the last playlist or album to resume
  _renderBanner() {
    const root = this.shadowRoot, t = this._t();
    if (!root || !this._ctx) return;
    const { chosen, ma, st } = this._ctx;
    const a = st?.attributes ?? {}, r = this._recent ?? {};
    const live = ["playing", "paused", "buffering"].includes(st?.state);
    const room = this._config.speaker === false ? "" : this._speakerName(chosen, ma);
    const last = live ? null : (r.items ?? [])[0] ?? null;
    const heading = !ma ? t.nosel : live ? (a.media_title || room) : last ? t.resume : t.idle;
    const subline = live ? [a.media_artist || a.media_album_name, room].filter(Boolean).join(" · ")
      : last ? [last.name, room].filter(Boolean).join(" · ") : room;
    const pic = live ? (typeof a.entity_picture === "string" ? a.entity_picture : null) : safeImage(last?.image);
    const sig = ["banner", ma, st?.state, heading, subline, pic].join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    if (!root.querySelector("ha-card.banner")) {
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = ORIGAMI_MUSIC_CSS;
      const card = document.createElement("ha-card");
      card.className = "banner";
      card.innerHTML = '<div class="art big"></div><div class="titles"><div class="name"></div><div class="status"></div></div>'
        + '<div class="pp big"></div><div class="nx"></div><div class="toast"></div>';
      card.addEventListener("click", (ev) => this._safe(() => {
        const ma2 = this._ctx?.ma, st2 = this._ctx?.st;
        const live2 = ["playing", "paused", "buffering"].includes(st2?.state);
        if (ev.target.closest(".pp")) {
          if (!ma2) return;
          if (live2) this._hass.callService("media_player", "media_play_pause", { entity_id: ma2 });
          else { const it = (this._recent?.items ?? [])[0]; if (it) this._play(it.uri, "music", "replace"); }
        } else if (ev.target.closest(".nx")) {
          if (ma2) this._hass.callService("media_player", "media_next_track", { entity_id: ma2 });
        } else this._go();
      }));
      root.append(style, card);
    }
    const card = root.querySelector("ha-card");
    card.title = "origami-music v" + ORIGAMI_MUSIC_VERSION;
    card.querySelector(".name").textContent = heading;
    card.querySelector(".status").textContent = subline;
    this._art(card.querySelector(".art"), pic, live ? "mdi:music" : "mdi:playlist-music");
    const pp = card.querySelector(".pp");
    pp.hidden = !ma || (!live && !last);
    pp.replaceChildren(this._icon(st?.state === "playing" ? "mdi:pause" : "mdi:play"));
    const nx = card.querySelector(".nx");
    nx.hidden = !live;
    if (!nx.firstChild) nx.append(this._icon("mdi:skip-next"));
  }

  // Recently played albums and playlists; a tap plays one on the chosen speaker
  _renderShelf() {
    const root = this.shadowRoot, t = this._t();
    if (!root || !this._ctx) return;
    const r = this._recent ?? {};
    const sig = ["shelf", this._ctx.ma, (r.items ?? []).map((x) => x.uri).join(","), r.err ?? "", r.items ? 1 : 0].join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    if (!root.querySelector("ha-card.shelfcard")) {
      root.innerHTML = "";
      const style = document.createElement("style");
      style.textContent = ORIGAMI_MUSIC_CSS;
      const card = document.createElement("ha-card");
      card.className = "shelfcard";
      const cfg = this._config;
      card.innerHTML = (cfg.title ? '<div class="hd"><span class="ht">' + omEsc(cfg.title) + '</span>'
        + (cfg.link ? '<span class="hv link">' + omEsc(cfg.link.text) + '</span>' : "") + "</div>" : "")
        + '<div class="shelf big' + (cfg.size === "s" ? " s" : "") + '"></div><div class="toast"></div>';
      card.querySelector(".shelf").addEventListener("click", (ev) => this._safe(() => this._onClick(ev)));
      card.querySelector(".link")?.addEventListener("click", () => this._go(cfg.link.path));
      root.append(style, card);
    }
    const card = root.querySelector("ha-card");
    card.title = "origami-music v" + ORIGAMI_MUSIC_VERSION;
    const shelf = card.querySelector(".shelf");
    if (r.err) shelf.replaceChildren(this._el("div", "hint error", t.err + r.err));
    else if (!r.items) shelf.replaceChildren(this._el("div", "hint", t.load));
    else shelf.replaceChildren(...r.items.map((it) => {
      const c = this._el("div", "cover");
      Object.assign(c.dataset, { act: "play-now", id: it.uri, type: "music" });
      c.title = t.play + " : " + (it.name ?? "");
      c.append(this._thumb(it.image, ORIGAMI_MUSIC_ICONS[it.media_type] ?? "mdi:music"), this._el("div", "cname", it.name ?? ""),
        this._el("div", "ckind", t.kind[it.media_type] ?? ""));
      return c;
    }));
  }

  // Music Assistant player -> short speaker name
  _names() {
    const cfg = this._config, out = {};
    for (const [cast, ma] of Object.entries(cfg.players ?? {})) {
      out[ma] = cfg.names?.[cast] ?? this._hass.states[ma]?.attributes?.friendly_name ?? ma;
    }
    return out;
  }

  // Music Assistant groups: leader -> members and member -> leader. Every player in a group reports the same
  // group_members list, and the leader comes first.
  _groups() {
    const S = this._hass.states, lead = {}, mem = {};
    for (const ma of Object.values(this._config.players ?? {})) {
      const gm = S[ma]?.attributes?.group_members ?? [];
      if (gm.length > 1 && gm[0] === ma) { const g = gm.slice(1); lead[ma] = g; for (const x of g) mem[x] = ma; }
    }
    return { lead, mem };
  }

  _skel(cls, html, onclick) {
    const root = this.shadowRoot;
    const old = root.querySelector("ha-card." + cls);
    if (old) return old;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = ORIGAMI_MUSIC_CSS;
    const card = document.createElement("ha-card");
    card.className = cls;
    card.title = "origami-music v" + ORIGAMI_MUSIC_VERSION;
    card.innerHTML = html;
    if (onclick) card.addEventListener("click", (ev) => this._safe(() => onclick(ev)));
    root.append(style, card);
    return card;
  }

  _call(service, data) {
    const [domain, name] = service.split(".");
    return this._hass.callService(domain, name, data).catch((e) => this._toast(this._t().err + (e?.message ?? e)));
  }

  _setIcon(el, icon) {
    let i = el.querySelector(":scope > ha-icon");
    if (!i) { i = document.createElement("ha-icon"); el.prepend(i); }
    if (i.getAttribute("icon") !== icon) i.setAttribute("icon", icon);
  }

  _renderPlayer() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t();
    const { ma, st } = this._ctx;
    const a = st?.attributes ?? {}, names = this._names(), { lead, mem } = this._groups();
    const leader = mem[ma] ?? ma;
    const live = ["playing", "paused", "buffering"].includes(st?.state);
    const card = this._skel("player", '<div class="np"><div class="art np-art"></div><div class="titles"><div class="name"></div>'
      + '<div class="status"></div><div class="grp"></div></div><div class="more" data-c="more"></div></div>'
      + '<div class="prog"><div class="bar"><i></i></div><div class="times"><span class="pos"></span><span class="dur"></span></div></div>'
      + '<div class="ctrls"><div class="c" data-c="shuffle"></div><div class="c" data-c="prev"></div><div class="c big" data-c="pp"></div>'
      + '<div class="c" data-c="next"></div><div class="c" data-c="repeat"></div></div>'
      + '<div class="vol"><i class="vfill"></i><i class="vknob"></i><span class="vic"></span><span class="vpct"></span></div><div class="toast"></div>',
      (ev) => this._playerClick(ev));
    if (!card._vol) { card._vol = true; this._wireVolume(card.querySelector(".vol")); }
    const group = leader ? [leader, ...(lead[leader] ?? [])].map((x) => names[x] ?? x).join(" + ") : "";
    card.querySelector(".name").textContent = !ma ? t.nosel : live ? (a.media_title || t.playing) : t.idle;
    card.querySelector(".status").textContent = live ? [a.media_artist, a.media_album_name].filter(Boolean)[0] ?? "" : "";
    card.querySelector(".grp").textContent = group;
    const pic = live && typeof a.entity_picture === "string" ? a.entity_picture : null;
    if (card._pic !== pic) { card._pic = pic; this._art(card.querySelector(".np-art"), pic, "mdi:music"); }
    this._setIcon(card.querySelector('[data-c="more"]'), "mdi:dots-horizontal");
    const sh = card.querySelector('[data-c="shuffle"]');
    this._setIcon(sh, a.shuffle ? "mdi:shuffle" : "mdi:shuffle-disabled");
    sh.classList.toggle("on", !!a.shuffle);
    this._setIcon(card.querySelector('[data-c="prev"]'), "mdi:skip-previous");
    this._setIcon(card.querySelector('[data-c="pp"]'), st?.state === "playing" ? "mdi:pause" : "mdi:play");
    this._setIcon(card.querySelector('[data-c="next"]'), "mdi:skip-next");
    const rp = card.querySelector('[data-c="repeat"]');
    this._setIcon(rp, a.repeat === "one" ? "mdi:repeat-once" : a.repeat === "all" ? "mdi:repeat" : "mdi:repeat-off");
    rp.classList.toggle("on", a.repeat === "one" || a.repeat === "all");
    card.classList.toggle("dead", !st || ["unavailable", "unknown"].includes(st.state));
    this._setIcon(card.querySelector(".vic"), (a.volume_level ?? 0) < 0.34 ? "mdi:volume-low" : (a.volume_level ?? 0) < 0.67 ? "mdi:volume-medium" : "mdi:volume-high");
    const vol = card.querySelector(".vol");
    if (!vol._drag && vol._local == null) this._paintVol(vol, a.volume_level ?? 0);
    this._tick();
    // The progress moves on its own while playing, and stops once the card is no longer on the page
    if (st?.state === "playing") { if (!this._tickT) this._tickT = setInterval(() => this._tick(), 1000); }
    else { clearInterval(this._tickT); this._tickT = null; }
  }

  _tick() {
    const card = this.shadowRoot?.querySelector("ha-card.player, ha-card.nowp");
    if (!card || !this._ctx) return;
    const st = this._ctx.st, a = st?.attributes ?? {}, dur = Number(a.media_duration) || 0;
    let pos = Number(a.media_position) || 0;
    if (st?.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    pos = Math.max(0, dur ? Math.min(pos, dur) : pos);
    const live = ["playing", "paused", "buffering"].includes(st?.state);
    card.querySelector(".prog").hidden = !live || !dur;
    card.querySelector(".bar i").style.width = dur ? (pos / dur * 100).toFixed(2) + "%" : "0%";
    card.querySelector(".pos").textContent = formatDuration(pos) || "0:00";
    card.querySelector(".dur").textContent = formatDuration(dur);
  }

  _paintVol(vol, v) {
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    vol.querySelector(".vfill").style.width = pct + "%";
    vol.querySelector(".vknob").style.left = pct + "%";
    vol.querySelector(".vpct").textContent = (vol._label ? vol._label + " · " : "") + this._pct(pct / 100);
  }

  // The gauge follows the finger at once, the volume is set 150 ms after the last move
  // apply gets the new level; without it, the level goes to the followed player
  _wireVolume(vol, apply) {
    const set = (ev) => {
      const r = vol.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      vol._local = v;
      this._paintVol(vol, v);
      clearTimeout(vol._timer);
      vol._timer = setTimeout(() => {
        const ma = this._ctx?.ma;
        if (apply) apply(v);
        else if (ma) this._call("media_player.volume_set", { entity_id: ma, volume_level: Math.round(v * 100) / 100 });
      }, 150);
    };
    vol.addEventListener("pointerdown", (ev) => { vol.setPointerCapture?.(ev.pointerId); vol._drag = true; set(ev); });
    vol.addEventListener("pointermove", (ev) => { if (vol._drag) set(ev); });
    const release = () => { vol._drag = false; clearTimeout(vol._free); vol._free = setTimeout(() => { vol._local = null; }, 2000); };
    vol.addEventListener("pointerup", release);
    vol.addEventListener("pointercancel", release);
  }

  _playerClick(ev) {
    const c = ev.target.closest("[data-c]")?.dataset.c;
    const ma = this._ctx?.ma, a = this._ctx?.st?.attributes ?? {};
    if (!c || !ma) return;
    if (c === "more") this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: ma } }));
    else if (c === "fav") this._favToggle(a.media_content_id);
    else if (c === "dev") this._go(this._config.speakers_path);
    else if (c === "pp") this._call("media_player.media_play_pause", { entity_id: ma });
    else if (c === "prev") this._call("media_player.media_previous_track", { entity_id: ma });
    else if (c === "next") this._call("media_player.media_next_track", { entity_id: ma });
    else if (c === "shuffle") this._call("media_player.shuffle_set", { entity_id: ma, shuffle: !a.shuffle });
    else if (c === "repeat") this._call("media_player.repeat_set", { entity_id: ma, repeat: { off: "all", all: "one", one: "off" }[a.repeat] ?? "all" });
  }

  // A tap on a row chooses the speaker; the checkbox adds it to the group of the chosen speaker, or takes it out
  _renderSpeakers() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t(), cfg = this._config, S = this._hass.states;
    const names = this._names(), { lead, mem } = this._groups();
    const leader = mem[this._ctx.ma] ?? this._ctx.ma;
    // solo: speakers that cannot play in sync with others, such as an old Chromecast built-in
    const solo = new Set(cfg.solo ?? []), alone = (cast, p) => solo.has(p) || solo.has(cast);
    const leaderAlone = Object.entries(cfg.players ?? {}).some(([cast, p]) => p === leader && alone(cast, p));
    const rows = Object.entries(cfg.players ?? {}).map(([cast, p]) => {
      const st = S[p], s = st?.state ?? "unavailable", a = st?.attributes ?? {};
      const off = ["unavailable", "unknown"].includes(s);
      const title = a.media_title || t.playing;
      const line = off ? t.offline : mem[p] ? t.with + (names[mem[p]] ?? mem[p])
        : ["playing", "buffering"].includes(s) ? title + (lead[p] ? " · " + t.leads : "")
        : s === "paused" ? t.paused + (lead[p] ? " · " + t.leads : "") : lead[p] ? t.leads : t.inactive;
      const on = p === leader || (lead[leader] ?? []).includes(p);
      // A speaker that is already in a group keeps its checkbox, so it can still leave
      const na = !on && (alone(cast, p) || leaderAlone);
      return { cast, p, leader: p === leader, on, na, badge: lead[p] ? "mdi:crown" : mem[p] ? "mdi:link-variant" : "",
        line: line + (alone(cast, p) && !off ? " · " + t.nogroup : ""), off, label: names[p] ?? p,
        vol: a.volume_level != null && !off ? this._pct(a.volume_level) : "–" };
    });
    const sig = "speakers|" + leader + "|" + JSON.stringify(rows);
    if (sig === this._sig) return;
    this._sig = sig;
    const card = this._skel("speakers", '<div class="hd"><span class="ht"></span><span class="hv"></span></div><div class="sp"></div><div class="toast"></div>',
      (ev) => this._speakerClick(ev));
    card.querySelector(".ht").textContent = t.speakers;
    card.querySelector(".hv").textContent = t.tick;
    card.querySelector(".sp").innerHTML = rows.map((r) => `<div class="spk${r.on ? " on" : ""}${r.off ? " off" : ""}" data-cast="${omEsc(r.cast)}" data-p="${omEsc(r.p)}">
      <div class="sq"><ha-icon icon="mdi:speaker"></ha-icon>${r.badge ? `<span class="badge"><ha-icon icon="${r.badge}"></ha-icon></span>` : ""}</div>
      <div class="text"><div class="title">${omEsc(r.label)}</div><div class="sub">${omEsc(r.line)}</div></div>
      <span class="vp">${omEsc(r.vol)}</span>
      <div class="chk${r.on ? " on" : ""}${r.leader ? " leader" : ""}${r.na ? " na" : ""}" data-chk="1">${r.on ? '<ha-icon icon="mdi:check"></ha-icon>'
        : r.na ? '<ha-icon icon="mdi:link-variant-off"></ha-icon>' : ""}</div></div>`).join("");
  }

  _speakerClick(ev) {
    const row = ev.target.closest(".spk");
    if (!row) return;
    const p = row.dataset.p, cast = row.dataset.cast, { lead, mem } = this._groups();
    const leader = mem[this._ctx?.ma] ?? this._ctx?.ma;
    if (ev.target.closest("[data-chk]")) {
      if (row.classList.contains("off") || !leader || p === leader) return;
      if (ev.target.closest(".chk.na")) {
        const t = this._t(), names = this._names(), solo = new Set(this._config.solo ?? []);
        this._toast(solo.has(p) || solo.has(cast) ? (names[p] ?? p) + t.solo : (names[leader] ?? leader) + t.sololead);
        return;
      }
      if ((lead[leader] ?? []).includes(p)) this._call("media_player.unjoin", { entity_id: p });
      else this._call("media_player.join", { entity_id: leader, group_members: [p] });
      return;
    }
    if (this._config.select) this._call("input_select.select_option", { entity_id: this._config.select, option: cast });
  }

  // The tracks after the current one; the track count opens the longer list
  _renderQueue() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t(), m = this._m, cfg = this._config;
    const max = this._open ? 30 : Number(cfg.limit) || 4;
    const v = queueView(m.items, this._ctx.cur, max + 1);
    const rows = v.rows.filter((r) => !r.current).slice(0, max);
    const empty = !this._ctx.qid || (m.items != null && !rows.length);
    const sig = ["queue", this._ctx.qid, this._ctx.cur, rows.map((r) => r.it.queue_item_id).join(","), v.upcoming, m.err ?? "", this._open ? 1 : 0, m.items ? 1 : 0].join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    const card = this._skel("queue", '<div class="hd"><span class="ht"></span><span class="hv link"></span></div><div class="lst"></div><div class="toast"></div>',
      (ev) => {
        if (ev.target.closest(".link")) { this._open = !this._open; this._sig = null; this._renderQueue(); return; }
        this._onClick(ev);
      });
    this.style.display = empty ? "none" : "";
    card.querySelector(".ht").textContent = t.upnext;
    card.querySelector(".hv").textContent = v.upcoming > 0 ? v.upcoming + (v.upcoming > 1 ? t.tracks : t.track1) + (this._open ? " ‹" : " ›") : "";
    const lst = card.querySelector(".lst");
    if (m.err) { lst.replaceChildren(this._el("div", "hint error", t.err + m.err)); return; }
    if (m.items == null) { lst.replaceChildren(this._el("div", "hint", t.load)); return; }
    lst.replaceChildren(...rows.map((r) => {
      const row = this._el("div", "row");
      Object.assign(row.dataset, { act: "queue-play", index: String(r.index) });
      const text = this._el("div", "text");
      text.append(this._el("div", "title", r.it.name ?? ""),
        this._el("div", "sub", [r.it.artists, r.it.album].filter((x) => typeof x === "string" && x)[0] ?? ""));
      row.append(this._thumb(r.it.image, "mdi:music-note"), text, this._el("div", "dur", formatDuration(r.it.duration)));
      return row;
    }));
  }

  // Recently played playlists and albums for the library, read again every 10 minutes
  async _fetchLibHome() {
    const L = (window.__origamiMusicLib ??= { pl: null, al: null, at: 0, pending: false, err: null, cards: new Set() });
    this._lib = L;
    L.cards.add(this);
    if (L.pending || Date.now() - L.at < 10 * 60 * 1000) return;
    L.pending = true; L.at = Date.now();
    try {
      const hass = this._hass;
      const entry = this._config.config_entry_id ?? (await hass.callWS({ type: "config_entries/get", domain: "music_assistant" }))?.[0]?.entry_id;
      const read = (type, limit) => hass.callWS({ type: "call_service", domain: "music_assistant", service: "get_library", return_response: true,
        service_data: { config_entry_id: entry, media_type: type, order_by: "last_played_desc", limit } }).then((x) => x?.response?.items ?? []);
      [L.pl, L.al] = await Promise.all([read("playlist", 4), read("album", 6)]);
      L.err = null;
    } catch (e) {
      L.err = e?.message ?? String(e);
    } finally {
      L.pending = false;
      for (const c of L.cards) {
        if (!c.isConnected) { L.cards.delete(c); continue; }
        c._sigLib = null;
        c._safe(() => c._renderLibrary());
      }
    }
  }

  // Reads the library root of the player once, then opens the category like the tabbed card does
  async _openCat(cat) {
    const t = this._t();
    if (!this._ctx?.ma) return;
    if (this._stack[1]?.id && this._stack[1].cat === cat) { this._stack = []; this._sigLib = null; this._renderLibrary(); return; }
    this._search.q = "";
    const input = this.shadowRoot?.querySelector(".lib input");
    if (input) input.value = "";
    if (!this._root) {
      try {
        const r = await this._hass.callWS({ type: "media_player/browse_media", entity_id: this._ctx.ma });
        this._root = libraryRoot(r?.children);
      } catch (e) {
        this._toast(t.err + (e?.message ?? e));
        return;
      }
    }
    const c = this._root.find((x) => x.media_content_id === cat);
    if (!c) { this._toast(t.nothing); return; }
    this._stack = [{ id: "", type: "", title: "", children: this._root, err: null }];
    this._browse(c.media_content_id, c.media_content_type, t.cat[cat] ?? c.title);
    this._stack[1].cat = cat;
  }

  _renderLibrary() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t(), cfg = this._config, L = this._lib ?? {}, srch = this._search;
    const { st } = this._ctx, a = st?.attributes ?? {};
    const live = ["playing", "paused", "buffering"].includes(st?.state);
    const card = this._skel("library", '<div class="now"></div><label class="search"><ha-icon icon="mdi:magnify"></ha-icon>'
      + '<input type="search"></label><div class="cats"></div><div class="libbody"></div><div class="toast"></div>',
      (ev) => {
        if (ev.target.closest(".now")) { this._go(cfg.back_path); return; }
        const chip = ev.target.closest("[data-cat]");
        if (chip) { this._openCat(chip.dataset.cat); return; }
        this._onClick(ev);
      });
    if (!card._wired) {
      card._wired = true;
      const input = card.querySelector("input");
      input.placeholder = t.placeholder;
      input.addEventListener("input", () => this._safe(() => { this._stack = []; this._runSearch(input.value); }));
      card.querySelector(".cats").innerHTML = ["playlists", "albums", "artists", "radio", "podcasts", "audiobooks"].map((c) =>
        `<div class="cat" data-cat="${c}"><ha-icon icon="${ORIGAMI_MUSIC_ICONS[c]}"></ha-icon><span>${omEsc(c === "audiobooks" ? t.books : t.cat[c])}</span></div>`).join("");
    }
    // The chip back to the player, only when back_path is set
    const back = live ? t.nowplaying + (a.media_title || t.playing) : t.toplayer;
    const now = card.querySelector(".now");
    now.hidden = !cfg.back_path;
    if (now.textContent !== back) { now.replaceChildren(this._icon(live ? "mdi:play" : "mdi:chevron-left"), this._el("span", null, back)); }
    const open = this._stack[1]?.cat ?? null;
    for (const c of card.querySelectorAll(".cat")) c.classList.toggle("on", c.dataset.cat === open);
    const mode = srch.q.trim().length >= 2 ? "search" : this._stack.length > 1 ? "browse" : "home";
    const level = this._stack[this._stack.length - 1];
    const sig = [mode, srch.q, srch.loading ? 1 : 0, srch.results?.length ?? -1, srch.err ?? "", this._stack.length, level?.children?.length ?? -1,
      level?.err ?? "", (L.pl ?? []).length, (L.al ?? []).length, L.err ?? ""].join("|");
    if (sig === this._sigLib) return;
    this._sigLib = sig;
    const body = card.querySelector(".libbody");
    // While a search loads, the current rows stay (dimmed), so a pop-up around the card keeps its height
    body.classList.toggle("busy", mode === "search" && srch.loading && body.childElementCount > 0);
    if (mode === "search") {
      if (srch.loading) { if (!body.childElementCount) body.replaceChildren(this._el("div", "hint", t.load)); }
      else if (srch.err) body.replaceChildren(this._el("div", "hint error", t.err + srch.err));
      else if (!srch.results?.length) body.replaceChildren(this._el("div", "hint", srch.results ? t.noresult : ""));
      else {
        const out = [];
        for (const [cls, items] of groupResults(srch.results)) {
          out.push(this._el("div", "section", t.cls[cls] ?? cls));
          out.push(...items.map((c) => this._itemRow(c)));
        }
        body.replaceChildren(...out);
      }
      return;
    }
    if (mode === "browse") { body.replaceChildren(...this._browseView()); return; }
    if (L.err) { body.replaceChildren(this._el("div", "hint error", t.err + L.err)); return; }
    if (!L.pl) { body.replaceChildren(this._el("div", "hint", t.load)); return; }
    const hd = (title, link, cat) => {
      const h = this._el("div", "hd");
      const l = this._el("span", "hv link", link);
      l.dataset.cat = cat;
      h.append(this._el("span", "ht", title), l);
      return h;
    };
    const playlists = this._el("div", "pgrid");
    playlists.append(...L.pl.map((it) => {
      const c = this._el("div", "pl");
      Object.assign(c.dataset, { act: "play-now", id: it.uri, type: "music" });
      c.title = t.play + " : " + (it.name ?? "");
      const pic = this._thumb(it.image, "mdi:playlist-music");
      const btn = this._el("span", "plbtn");
      btn.append(this._icon("mdi:play"));
      pic.append(btn);
      c.append(pic, this._el("div", "plname", it.name ?? ""));
      return c;
    }));
    const albums = this._el("div", "albums");
    albums.append(...L.al.map((it) => {
      const row = this._el("div", "row item");
      const text = this._el("div", "text");
      text.append(this._el("div", "title", it.name ?? ""),
        this._el("div", "sub", (it.artists ?? []).map((x) => x?.name).filter(Boolean).join(", ") || it.version || t.kind.album));
      const acts = this._el("div", "acts");
      for (const [act, icon, label] of [["next", "mdi:skip-next", t.next], ["play-now", "mdi:play", t.play]]) {
        const b = this._el("div", "act" + (act === "play-now" ? " main" : ""));
        Object.assign(b.dataset, { act, id: it.uri, type: "music" });
        b.title = label;
        b.append(this._icon(icon));
        acts.append(b);
      }
      row.append(this._thumb(it.image, "mdi:album"), text, acts);
      return row;
    }));
    body.replaceChildren(hd(t.cat.playlists, t.recentf, "playlists"), playlists, hd(t.cat.albums, t.recentm, "albums"), albums);
  }

  // --- Music pop-up with Spotify-like navigation (layout: app) ----------------------------------------------

  _entryId() {
    if (this._config.config_entry_id) return Promise.resolve(this._config.config_entry_id);
    return (window.__origamiMusicEntry ??= this._hass.callWS({ type: "config_entries/get", domain: "music_assistant" })
      .then((r) => r?.[0]?.entry_id)
      .catch((e) => { window.__origamiMusicEntry = null; throw e; }));
  }

  // Lists from the Music Assistant library, shared by the cards of the page and read again every 10 minutes
  _libList(key, data) {
    const C = (window.__origamiMusicLists ??= {});
    const e = (C[key] ??= { items: null, at: 0, pending: false, err: null, cards: new Set() });
    e.cards.add(this);
    if (!e.pending && Date.now() - e.at > 10 * 60 * 1000) {
      e.pending = true; e.at = Date.now();
      this._entryId()
        .then((entry) => this._hass.callWS({ type: "call_service", domain: "music_assistant", service: "get_library", return_response: true,
          service_data: { config_entry_id: entry, ...data } }))
        .then((x) => { e.items = x?.response?.items ?? []; e.err = null; })
        .catch((err) => { e.err = err?.message ?? String(err); e.items = e.items ?? []; })
        .finally(() => {
          e.pending = false;
          for (const c of e.cards) {
            if (!c.isConnected) { e.cards.delete(c); continue; }
            c._gen = (c._gen ?? 0) + 1;
            c._safe(() => c._update());
          }
        });
    }
    return e;
  }

  _expire(...keys) {
    const C = window.__origamiMusicLists ?? {};
    for (const k of keys) if (C[k]) C[k].at = 0;
  }

  // Favorite state of a Music Assistant item, shared by the cards and read again after 5 minutes
  _fav(uri) {
    if (!uri) return "na";
    const F = (window.__origamiMusicFav ??= new Map());
    let e = F.get(uri);
    if (!e || (!e.pending && Date.now() - e.at > 5 * 60 * 1000)) {
      e = { v: e?.v ?? null, pending: true, at: Date.now() };
      F.set(uri, e);
      this._hass.callWS({ type: "bubble_card_tools/ma_favorite_state", uri })
        .then((r) => { e.v = r?.supported === false ? "na" : !!r?.favorite; })
        .catch(() => { e.v = "na"; })
        .finally(() => { e.pending = false; this._favRefresh(); });
    }
    return e.v;   // null while unknown, "na" when the item cannot be a favorite (a stream, an AirPlay input)
  }

  _favToggle(uri) {
    const e = window.__origamiMusicFav?.get(uri), t = this._t();
    if (!e || typeof e.v !== "boolean") { this._toast(t.wait); return; }
    const v = !e.v;
    e.v = v; e.at = Date.now();
    this._favRefresh();
    this._hass.callWS({ type: "bubble_card_tools/ma_favorite_set", uri, favorite: v })
      .then(() => { this._toast(v ? t.like : t.unlike); this._expire("favs", "radios", "lib|radio|recent", "lib|radio|az", "lib|radio|added"); this._favRefresh(); })
      .catch((err) => { e.v = !v; this._favRefresh(); this._toast(t.err + (err?.message ?? err)); });
  }

  _favRefresh() {
    this._gen = (this._gen ?? 0) + 1;
    this._sig = null;
    this._safe(() => this._update());
  }

  _heart(uri, extra) {
    const v = this._fav(uri);
    const h = this._el("div", "heart" + (v === true ? " on" : "") + (extra ? " " + extra : ""));
    Object.assign(h.dataset, { act: "fav-toggle", id: uri });
    h.hidden = v === "na";
    h.title = this._t().favs;
    h.append(this._icon(v === true ? "mdi:heart" : "mdi:heart-outline"));
    return h;
  }

  // Draws a block only when its signature changes, as the card gets every state change of Home Assistant
  _paint(el, sig, fn) {
    sig = (this._gen ?? 0) + "|" + sig;
    if (el._sig === sig) return;
    el._sig = sig;
    fn();
  }

  _head(title, link, data) {
    const h = this._el("div", "hd");
    h.append(this._el("span", "ht", title));
    if (link) { const l = this._el("span", "hv lien", link); Object.assign(l.dataset, data ?? {}); h.append(l); }
    return h;
  }

  _groupPlayers() {
    const { lead, mem } = this._groups(), ma = this._ctx?.ma;
    const leader = mem[ma] ?? ma;
    return leader ? [leader, ...(lead[leader] ?? [])] : [];
  }

  _groupNames() {
    const names = this._names();
    return this._groupPlayers().map((x) => names[x] ?? x);
  }

  // The volume of a group moves every speaker by the same step, like the group volume of Music Assistant,
  // which Home Assistant does not expose. A preset sets every speaker to the same level.
  _groupVolume(v, same) {
    const S = this._hass.states, players = this._groupPlayers();
    const levels = players.map((p) => S[p]?.attributes?.volume_level ?? 0);
    const step = v - levels.reduce((x, y) => x + y, 0) / (levels.length || 1);
    players.forEach((p, i) => this._call("media_player.volume_set", { entity_id: p,
      volume_level: Math.round(Math.max(0, Math.min(1, same ? v : levels[i] + step)) * 100) / 100 }));
  }

  _paintGroupVolume(card) {
    const t = this._t(), S = this._hass.states, players = this._groupPlayers(), names = this._names();
    const levels = players.map((p) => S[p]?.attributes?.volume_level ?? 0);
    const vol = card.querySelector(".vrow .vol");
    vol._label = players.length > 1 ? t.group : "";
    if (!vol._drag && vol._local == null) this._paintVol(vol, levels.reduce((x, y) => x + y, 0) / (levels.length || 1));
    const more = card.querySelector(".vmore");
    this._setIcon(more, this._volOpen ? "mdi:chevron-up" : "mdi:chevron-down");
    more.classList.toggle("open", !!this._volOpen);
    more.title = t.volumes;
    const panel = card.querySelector(".vpanel");
    panel.hidden = !this._volOpen;
    if (!this._volOpen) return;
    if (!panel._presets) {
      panel._presets = true;
      const presets = this._config.presets ?? [0.15, 0.3, 0.5];
      panel.querySelector(".presets").replaceChildren(...[t.quiet, t.medium, t.loud].map((label, i) => {
        const b = this._el("div", "preset", label);
        b.dataset.preset = String(presets[i]);
        return b;
      }));
    }
    const rows = panel.querySelector(".mvols");
    if (rows._sig !== players.join(",")) {
      rows._sig = players.join(",");
      rows.replaceChildren(...players.map((p) => {
        const row = this._el("div", "mvol");
        row.dataset.p = p;
        const vol = this._el("div", "vol");
        vol.innerHTML = '<i class="vfill"></i><i class="vknob"></i><span class="vpct"></span>';
        this._wireVolume(vol, (v) => this._call("media_player.volume_set", { entity_id: p, volume_level: Math.round(v * 100) / 100 }));
        row.append(this._el("div", "mname", names[p] ?? p), vol);
        return row;
      }));
    }
    for (const row of rows.children) {
      const vol = row.querySelector(".vol");
      if (!vol._drag && vol._local == null) this._paintVol(vol, S[row.dataset.p]?.attributes?.volume_level ?? 0);
    }
  }

  // --- Also play on (layout: group): a tap adds a speaker to the group of the chosen one, or takes it out --------

  _groupState() {
    const cfg = this._config, S = this._hass.states, names = this._names(), { lead, mem } = this._groups();
    const leader = mem[this._ctx?.ma] ?? this._ctx?.ma;
    const solo = new Set(cfg.solo ?? []), alone = (cast, p) => solo.has(p) || solo.has(cast);
    const leaderAlone = Object.entries(cfg.players ?? {}).some(([cast, p]) => p === leader && alone(cast, p));
    const members = lead[leader] ?? [];
    const chips = Object.entries(cfg.players ?? {}).filter(([, p]) => p !== leader).map(([cast, p]) => {
      const off = ["unavailable", "unknown"].includes(S[p]?.state ?? "unavailable");
      const on = members.includes(p);
      return { p, name: names[p] ?? p, on, off, solo: alone(cast, p), na: !on && (off || alone(cast, p) || leaderAlone) };
    });
    return { leader, leaderAlone, members, chips, free: chips.filter((c) => !c.on && !c.na).map((c) => c.p) };
  }

  _renderGroup() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t(), g = this._groupState();
    const sig = "group|" + g.leader + "|" + JSON.stringify(g.chips);
    if (sig === this._sig) return;
    this._sig = sig;
    const card = this._skel("group", '<div class="hd"><span class="ht"></span><span class="hv lien" data-g="split"></span></div>'
      + '<div class="ghint"></div><div class="ggrid"></div><div class="toast"></div>', (ev) => this._groupClick(ev));
    card.querySelector(".ht").textContent = t.alsoOn;
    // A speaker that plays alone cannot lead a group: say so, instead of a grid that only answers to a tap
    const hint = card.querySelector(".ghint");
    hint.hidden = !g.leaderAlone;
    hint.textContent = g.leaderAlone ? (this._names()[g.leader] ?? g.leader) + t.sololead : "";
    const split = card.querySelector('[data-g="split"]');
    split.hidden = !g.members.length;
    split.replaceChildren(this._icon("mdi:link-variant-off"), this._el("span", null, t.ungroup));
    const chip = (cls, icon, text, data) => {
      const c = this._el("div", "gchip " + cls);
      Object.assign(c.dataset, data);
      c.append(this._icon(icon), this._el("span", null, text));
      return c;
    };
    card.querySelector(".ggrid").replaceChildren(
      ...g.chips.map((c) => chip((c.on ? "on" : "") + (c.na ? " na" : ""), "mdi:speaker", c.name, { p: c.p })),
      chip("all" + (g.free.length ? "" : " na"), "mdi:speaker-multiple", t.allSpeakers, { g: "all" }));
  }

  _groupClick(ev) {
    const t = this._t(), g = this._groupState(), names = this._names();
    const action = ev.target.closest("[data-g]")?.dataset.g, p = ev.target.closest(".gchip[data-p]")?.dataset.p;
    if (!g.leader) return;
    if (action === "split") { if (g.members.length) this._call("media_player.unjoin", { entity_id: g.members }); return; }
    if (action === "all") { if (g.free.length) this._call("media_player.join", { entity_id: g.leader, group_members: g.free }); return; }
    const c = g.chips.find((x) => x.p === p);
    if (!c) return;
    if (c.na) {
      this._toast(c.off ? (names[p] ?? p) + " · " + t.offline : c.solo ? (names[p] ?? p) + t.solo : (names[g.leader] ?? g.leader) + t.sololead);
      return;
    }
    if (c.on) this._call("media_player.unjoin", { entity_id: p });
    else this._call("media_player.join", { entity_id: g.leader, group_members: [p] });
  }

  _renderApp() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t();
    if (!["home", "search", "lib"].includes(this._tab)) this._tab = "home";
    const card = this._skel("app", '<div class="tabs2"></div><div class="pane"></div><div class="mini" hidden></div><div class="toast"></div>',
      (ev) => this._appClick(ev));
    if (!card._wired) {
      card._wired = true;
      card.querySelector(".tabs2").innerHTML = [["home", t.home], ["search", t.searchTab], ["lib", t.libTab]]
        .map(([k, l]) => `<div class="tab2" data-tab="${k}">${omEsc(l)}</div>`).join("");
    }
    for (const c of card.querySelectorAll(".tab2")) c.classList.toggle("on", c.dataset.tab === this._tab);
    this._renderMini(card.querySelector(".mini"));
    const pane = card.querySelector(".pane");
    if (this._stack.length) {
      const level = this._stack[this._stack.length - 1];
      if (pane.dataset.kind !== "browse") { pane.dataset.kind = "browse"; pane._sig = null; }
      this._paint(pane, ["browse", this._stack.length, level.id, level.children?.length ?? -1, level.err ?? ""].join("|"),
        () => pane.replaceChildren(...this._browseView()));
      return;
    }
    if (this._tab === "home") this._paneHome(pane);
    else if (this._tab === "search") this._paneSearch(pane);
    else this._paneLib(pane);
  }

  _switchTab(k) {
    this._tab = k;
    this._stack = [];
    const pane = this.shadowRoot?.querySelector("ha-card.app .pane");
    if (pane) pane.dataset.kind = "";
    this._renderApp();
    // From a link low on the home tab, scroll back up to the tabs, and no further
    this.shadowRoot?.querySelector("ha-card.app .tabs2")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  // Home: resume, recently played, trending, radio, favorites, artists
  _paneHome(pane) {
    const t = this._t(), cfg = this._config, { ma, chosen, st } = this._ctx, a = st?.attributes ?? {};
    if (pane.dataset.kind !== "home") {
      pane.dataset.kind = "home";
      pane.innerHTML = ["resume", "played", "trends", "radios", "favs", "artists"].map((k) => `<div class="sec ${k}"></div>`).join("");
    }
    const pl = this._libList("recent-pl", { media_type: "playlist", order_by: "last_played_desc", limit: 6 });
    const al = this._libList("recent-al", { media_type: "album", order_by: "last_played_desc", limit: 6 });
    const radios = this._libList("radios", { media_type: "radio", favorite: true, order_by: "sort_name", limit: 12 });
    const favs = this._libList("favs", { media_type: "track", favorite: true, order_by: "timestamp_added_desc", limit: 12 });
    const arts = this._libList("artists", { media_type: "artist", order_by: "play_count_desc", limit: 10 });
    const mix = pl.items && al.items ? interleave([pl.items, al.items]).slice(0, 6) : null;
    const live = ORIGAMI_MUSIC_LIVE.includes(st?.state);

    // Resume: when the chosen speaker is stopped, its last track (the queue is still there), else the last playlist or album
    const room = this._speakerName(chosen, ma);
    const resume = !ma || live ? null : a.media_title
      ? { act: "resume", name: a.media_title, sub: [a.media_artist, room].filter(Boolean).join(" · "), pic: typeof a.entity_picture === "string" ? a.entity_picture : null }
      : mix?.[0] ? { act: "play-now", id: mix[0].uri, name: mix[0].name, sub: [t.kind[mix[0].media_type], room].filter(Boolean).join(" · "), pic: safeImage(mix[0].image) } : null;
    const secR = pane.querySelector(".resume");
    this._paint(secR, JSON.stringify(resume), () => {
      if (!resume) { secR.replaceChildren(); return; }
      const c = this._el("div", "rcard");
      Object.assign(c.dataset, { act: resume.act, id: resume.id ?? "", type: "music" });
      const art = this._el("div", "art rart");
      this._art(art, resume.pic, "mdi:playlist-music");
      const text = this._el("div", "titles");
      text.append(this._el("div", "rlab", t.resume), this._el("div", "name", resume.name), this._el("div", "status", resume.sub));
      const pp = this._el("div", "pp big");
      pp.append(this._icon("mdi:play"));
      c.append(art, text, pp);
      secR.replaceChildren(c);
    });

    const secP = pane.querySelector(".played");
    this._paint(secP, mix ? mix.map((x) => x.uri).join(",") : "…", () => {
      if (!mix?.length) { secP.replaceChildren(); return; }
      const grid = this._el("div", "rgrid");
      grid.append(...mix.map((it) => {
        const c = this._el("div", "rtile");
        Object.assign(c.dataset, { act: "play-now", id: it.uri, type: "music" });
        c.title = t.play + " : " + (it.name ?? "");
        c.append(this._thumb(it.image, ORIGAMI_MUSIC_ICONS[it.media_type] ?? "mdi:music"), this._el("span", null, it.name ?? ""));
        return c;
      }));
      secP.replaceChildren(this._head(t.played), grid);
    });

    // Trending: one chart sensor per zone; a tap looks the track up in Music Assistant and plays it
    const zones = Object.keys(cfg.trends ?? {});
    const zone = zones.includes(this._zone) ? this._zone : zones[0];
    const S = this._hass.states, sensor = S[cfg.trends?.[zone]];
    const any = zones.some((z) => (S[cfg.trends[z]]?.attributes?.tracks ?? []).length);
    const rows = trendRows(sensor?.attributes?.tracks, sensor?.attributes?.previous).slice(0, this._topOpen ? 20 : 5);
    const secT = pane.querySelector(".trends");
    this._paint(secT, [any, zone, this._topOpen ? 1 : 0, sensor?.state, rows.map((r) => r.id + r.move).join(",")].join("|"), () => {
      if (!any) { secT.replaceChildren(); return; }
      const chips = this._el("div", "zones");
      for (const z of zones) {
        const chip = this._el("div", "zone" + (z === zone ? " on" : ""), z);
        Object.assign(chip.dataset, { act: "zone", zone: z });
        chips.append(chip);
      }
      const day = dayLabel(sensor?.state, new Date(), t);
      chips.append(this._el("span", "maj", day ? t.updated + day : ""));
      const box = this._el("div", "tlist");
      if (!rows.length) box.append(this._el("div", "hint", t.nothing));
      box.append(...rows.map((r, i) => {
        const row = this._el("div", "trow");
        Object.assign(row.dataset, { act: "trend-play", i: String(i) });
        row.title = t.play + " : " + r.title;
        const rank = this._el("div", "rank");
        const move = r.move === "up" ? "▲ " + r.gap : r.move === "down" ? "▼ " + r.gap : r.move === "new" ? t.isNew : r.move === "same" ? "=" : "";
        rank.append(this._el("b", null, String(r.rank)), this._el("i", "move-" + (r.move || "none"), move));
        const text = this._el("div", "text");
        text.append(this._el("div", "title", r.title ?? ""), this._el("div", "sub", r.artist ?? ""));
        const next = this._el("div", "nextb");
        Object.assign(next.dataset, { act: "trend-next", i: String(i) });
        next.title = t.next;
        next.append(this._icon("mdi:playlist-play"));
        row.append(rank, this._thumb(r.image, "mdi:music-note"), text, next);
        return row;
      }));
      secT.replaceChildren(this._head(t.trends, this._topOpen ? t.topLess : t.top, { act: "top" }), chips, box);
    });

    const secRa = pane.querySelector(".radios");
    this._paint(secRa, (radios.items ?? []).map((x) => x.uri + x.name).join(","), () => {
      if (!radios.items?.length) { secRa.replaceChildren(); return; }
      const box = this._el("div", "rad");
      box.append(...radios.items.map((it, i) => {
        const c = this._el("div", "radio");
        Object.assign(c.dataset, { act: "play-now", id: it.uri, type: "music" });
        c.title = t.play + " : " + (it.name ?? "");
        const short = radioShort(it.name);
        const sq = this._el("div", "sq" + (short.length > 5 ? " long" : ""), short);
        sq.style.backgroundColor = ORIGAMI_MUSIC_RADIO_COLORS[i % ORIGAMI_MUSIC_RADIO_COLORS.length];
        c.append(sq, this._el("div", "lab", it.name ?? ""));
        return c;
      }));
      secRa.replaceChildren(this._head(t.radios, t.edit, { act: "goto", k: "radio" }), box);
    });

    const secF = pane.querySelector(".favs");
    this._paint(secF, (favs.items ?? []).map((x) => x.uri).join(","), () => {
      if (!favs.items?.length) { secF.replaceChildren(); return; }
      const shelf = this._el("div", "shelf big");
      shelf.append(...favs.items.map((it, i) => {
        const c = this._el("div", "cover");
        Object.assign(c.dataset, { act: "fav-play", i: String(i) });
        c.title = t.play + " : " + (it.name ?? "");
        c.append(this._thumb(it.image ?? it.album?.image, "mdi:music-note"), this._el("div", "cname", it.name ?? ""),
          this._el("div", "ckind", (it.artists ?? []).map((x) => x?.name).filter(Boolean).join(", ")));
        return c;
      }));
      const head = this._head(t.favs, t.all, { act: "goto", k: "favs" });
      head.querySelector(".ht").append(this._icon("mdi:heart"));
      secF.replaceChildren(head, shelf);
    });

    const secA = pane.querySelector(".artists");
    this._paint(secA, (arts.items ?? []).map((x) => x.uri).join(","), () => {
      if (!arts.items?.length) { secA.replaceChildren(); return; }
      const box = this._el("div", "arts");
      box.append(...arts.items.map((it) => {
        const c = this._el("div", "art2");
        Object.assign(c.dataset, { act: "open", id: it.uri, type: "artist", title: it.name ?? "" });
        c.append(this._thumb(it.image, "mdi:account-music-outline"), this._el("span", null, it.name ?? ""));
        return c;
      }));
      secA.replaceChildren(this._head(t.artists), box);
    });
  }

  // Search: the field, recent searches (kept on this device), browse tiles, results
  _paneSearch(pane) {
    const t = this._t(), s = this._search;
    if (pane.dataset.kind !== "search") {
      pane.dataset.kind = "search";
      pane.innerHTML = '<label class="search big"><ha-icon icon="mdi:magnify"></ha-icon><input type="search"></label><div class="sres"></div>';
      const input = pane.querySelector("input");
      input.placeholder = t.placeholder;
      input.value = s.q;
      input.addEventListener("input", () => this._safe(() => this._runSearch(input.value)));
    }
    const res = pane.querySelector(".sres");
    if (s.q.trim().length < 2) {
      const recent = this._searches();
      this._paint(res, "idle|" + JSON.stringify(recent), () => {
        res.classList.remove("busy");
        const out = [];
        if (recent.length) {
          out.push(this._head(t.recentSearches, t.clear, { act: "searches-clear" }));
          const box = this._el("div", "list");
          box.append(...recent.map((r, i) => {
            const row = this._el("div", "row item lrow");
            Object.assign(row.dataset, r.expand ? { act: "open", id: r.id, type: r.type, title: r.title } : { act: "play", id: r.id, type: r.type });
            const thumb = this._thumb(r.thumb, ORIGAMI_MUSIC_ICONS[r.cls] ?? "mdi:music-note");
            if (r.cls === "artist") thumb.classList.add("round");
            const text = this._el("div", "text");
            text.append(this._el("div", "title", r.title), this._el("div", "sub", t.kind[r.cls] ?? ""));
            const x = this._el("div", "x");
            Object.assign(x.dataset, { act: "search-del", i: String(i) });
            x.title = t.forget + r.title;
            x.append(this._icon("mdi:close"));
            row.append(thumb, text, x);
            return row;
          }));
          out.push(box);
        }
        const grid = this._el("div", "cats2");
        grid.append(...ORIGAMI_MUSIC_BROWSE.map((b) => {
          const c = this._el("div", "cat2", b.cat ? t.cat[b.cat] : b.k === "favs" ? t.liked : t.added);
          Object.assign(c.dataset, { act: "goto", k: b.k });
          c.style.color = b.ink;
          c.style.backgroundColor = `color-mix(in srgb, ${b.ink} 16%, var(--ha-card-background, #fff))`;
          c.append(this._icon(b.icon));
          return c;
        }));
        out.push(this._head(t.browse), grid);
        res.replaceChildren(...out);
      });
      return;
    }
    this._paint(res, ["res", s.q, s.loading ? 1 : 0, s.results?.length ?? -1, s.err ?? ""].join("|"), () => {
      // While a search loads, the rows in place stay (dimmed), so the pop-up keeps its height
      res.classList.toggle("busy", s.loading && res.childElementCount > 0);
      if (s.loading) { if (!res.childElementCount) res.replaceChildren(this._el("div", "hint", t.load)); return; }
      if (s.err) { res.replaceChildren(this._el("div", "hint error", t.err + s.err)); return; }
      if (!s.results?.length) { res.replaceChildren(this._el("div", "hint", s.results ? t.noresult : "")); return; }
      const out = [];
      for (const [cls, items] of groupResults(s.results)) {
        out.push(this._el("div", "section", t.cls[cls] ?? cls));
        out.push(...items.map((c) => this._itemRow(c)));
      }
      res.replaceChildren(...out);
    });
  }

  _searches() {
    try { const r = JSON.parse(localStorage.getItem("origami-music-searches") ?? "[]"); return Array.isArray(r) ? r : []; }
    catch (e) { return []; }
  }

  _setSearches(list) {
    try { localStorage.setItem("origami-music-searches", JSON.stringify(list.slice(0, 6))); } catch (e) { /* storage not available */ }
    this._gen = (this._gen ?? 0) + 1;
  }

  _remember(id) {
    const c = (this._search.results ?? []).find((x) => x?.media_content_id === id);
    if (!c) return;
    const r = { id, type: c.media_content_type, title: c.title ?? "", thumb: safeImage(c.thumbnail), cls: c.media_class, expand: !!c.can_expand };
    this._setSearches([r, ...this._searches().filter((x) => x.id !== id)]);
  }

  // Library: filters, sort, liked songs pinned on top, the list; a tap opens the playlist, album or artist
  _paneLib(pane) {
    const t = this._t(), cfg = this._config;
    if (pane.dataset.kind !== "lib") {
      pane.dataset.kind = "lib";
      pane.innerHTML = '<div class="chips"></div><div class="sortb" data-act="sort"></div><div class="list libl"></div>';
    }
    const f = this._filter ?? null, sort = this._sort ?? "recent";
    const order = (type) => sort === "az" ? "sort_name" : sort === "added" ? "timestamp_added_desc" : type === "artist" ? "play_count_desc" : "last_played_desc";
    const read = (type, limit) => this._libList(["lib", type, sort].join("|"), { media_type: type, order_by: order(type), limit, ...(type === "radio" ? { favorite: true } : {}) });
    const lists = f ? [read(f, 60)] : [read("playlist", 20), read("album", 20), read("artist", 10)];
    const items = lists.every((l) => l.items) ? interleave(lists.map((l) => l.items)) : null;
    const chips = pane.querySelector(".chips");
    this._paint(chips, f ?? "-", () => {
      chips.replaceChildren(...[["playlist", "playlists"], ["album", "albums"], ["artist", "artists"], ["radio", "radio"], ["podcast", "podcasts"], ["audiobook", "audiobooks"]]
        .map(([k, cat]) => { const c = this._el("div", "chip" + (k === f ? " on" : ""), t.cat[cat]); Object.assign(c.dataset, { act: "filter", k }); return c; }));
    });
    const sb = pane.querySelector(".sortb");
    this._paint(sb, sort, () => sb.replaceChildren(this._icon("mdi:sort"), this._el("span", null, sort === "az" ? t.sortAZ : sort === "added" ? t.added : t.sortRecent)));
    const list = pane.querySelector(".libl");
    this._paint(list, [f, sort, items ? items.map((x) => x.uri).join(",") : "…", lists.map((l) => l.err ?? "").join("")].join("|"), () => {
      const out = [];
      if (!f || f === "playlist") {
        const row = this._el("div", "row item lrow");
        Object.assign(row.dataset, { act: "goto", k: "favs" });
        const thumb = this._el("div", "thumb favtile");
        thumb.append(this._icon("mdi:heart"));
        const text = this._el("div", "text");
        text.append(this._el("div", "title", t.liked), this._el("div", "sub", t.kind.playlist));
        row.append(thumb, text);
        out.push(row);
      }
      const err = lists.find((l) => l.err)?.err;
      if (err) out.push(this._el("div", "hint error", t.err + err));
      else if (!items) out.push(this._el("div", "hint", t.load));
      else if (!items.length) out.push(this._el("div", "hint", t.nothing));
      else out.push(...items.map((it) => {
        const row = this._el("div", "row item lrow");
        const type = it.media_type;
        if (["radio", "track"].includes(type)) Object.assign(row.dataset, { act: "play-now", id: it.uri, type: "music" });
        else Object.assign(row.dataset, { act: "open", id: it.uri, type, title: it.name ?? "" });
        const thumb = this._thumb(it.image, ORIGAMI_MUSIC_ICONS[type] ?? "mdi:music");
        if (type === "artist") thumb.classList.add("round");
        const who = (it.artists ?? []).map((x) => x?.name).filter(Boolean).join(", ") || it.owner || "";
        const text = this._el("div", "text");
        text.append(this._el("div", "title", it.name ?? ""), this._el("div", "sub", [t.kind[type], who].filter(Boolean).join(" · ")));
        row.append(thumb, text);
        if (type === "radio") row.append(this._heart(it.uri));
        return row;
      }));
      if (cfg.ma_path) {
        const ma = this._el("div", "row item lrow mal");
        Object.assign(ma.dataset, { act: "go", path: cfg.ma_path });
        const thumb = this._el("div", "thumb");
        thumb.append(this._icon("mdi:music-box-multiple-outline"));
        ma.append(thumb, this._el("div", "title", t.openMA));
        out.push(ma);
      }
      list.replaceChildren(...out);
    });
  }

  // Mini player docked at the bottom of the pop-up: a tap opens the player, the heart likes the track
  _renderMini(mini) {
    const t = this._t(), { ma, st } = this._ctx, a = st?.attributes ?? {};
    const show = !!ma && !!a.media_title && !["unavailable", "unknown"].includes(st?.state);
    mini.hidden = !show;
    if (!show) return;
    const fav = this._fav(a.media_content_id);
    const pic = typeof a.entity_picture === "string" ? a.entity_picture : null;
    const group = this._groupNames().join(" + ");
    this._paint(mini, [st.state, a.media_title, a.media_artist, pic, group, fav].join("|"), () => {
      const art = this._el("div", "art");
      this._art(art, pic, "mdi:music");
      const text = this._el("div", "titles");
      text.append(this._el("div", "name", a.media_title), this._el("div", "status", [a.media_artist, group].filter(Boolean).join(" · ")));
      const pp = this._el("div", "pp");
      pp.dataset.act = "mini-pp";
      pp.append(this._icon(st.state === "playing" ? "mdi:pause" : "mdi:play"));
      mini.replaceChildren(art, text, this._heart(a.media_content_id), pp);
      mini.dataset.act = "mini";
      mini.title = t.inplay;
    });
  }

  _appClick(ev) {
    const t = this._t(), cfg = this._config;
    const tab = ev.target.closest(".tab2");
    if (tab) { this._switchTab(tab.dataset.tab); return; }
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    const d = el.dataset, ma = this._ctx?.ma;
    ev.stopPropagation();
    if (d.act === "mini") this._go(cfg.player_path);
    else if (d.act === "mini-pp") { if (ma) this._call("media_player.media_play_pause", { entity_id: ma }); }
    else if (d.act === "resume") { if (ma) this._call("media_player.media_play", { entity_id: ma }); }
    else if (d.act === "fav-toggle") this._favToggle(d.id);
    else if (d.act === "zone") { this._zone = d.zone; this._renderApp(); }
    else if (d.act === "top") { this._topOpen = !this._topOpen; this._renderApp(); }
    else if (d.act === "trend-play") this._playTrend(Number(d.i), "play");
    else if (d.act === "trend-next") this._playTrend(Number(d.i), "next");
    else if (d.act === "fav-play") {
      // The tapped track and the favorites after it, like a playlist
      const uris = (window.__origamiMusicLists?.favs?.items ?? []).slice(Number(d.i)).map((x) => x.uri).filter(Boolean);
      if (ma && uris.length) this._hass.callService("music_assistant", "play_media", { entity_id: ma, media_id: uris, enqueue: "replace" })
        .then(() => this._toast(t.sent + (this._names()[ma] ?? ma)))
        .catch((e) => this._toast(t.err + (e?.message ?? e)));
    }
    else if (d.act === "goto") {
      if (d.k === "favs") { this._switchTab("lib"); this._browse("builtin://playlist/all_favorite_tracks", "playlist", t.liked); }
      else if (d.k === "added") { this._filter = null; this._sort = "added"; this._switchTab("lib"); }
      else { this._filter = d.k; this._switchTab("lib"); }
    }
    else if (d.act === "filter") { this._filter = this._filter === d.k ? null : d.k; this._renderApp(); }
    else if (d.act === "sort") { this._sort = { recent: "az", az: "added", added: "recent" }[this._sort ?? "recent"]; this._renderApp(); }
    else if (d.act === "searches-clear") { this._setSearches([]); this._renderApp(); }
    else if (d.act === "search-del") { const r = this._searches(); r.splice(Number(d.i), 1); this._setSearches(r); this._renderApp(); }
    else if (d.act === "go") this._go(d.path);
    else {
      if (this._tab === "search" && !this._stack.length && ["play", "next", "open", "play-now"].includes(d.act)) this._remember(d.id);
      this._onClick(ev);
    }
  }

  // A trending track: Music Assistant searches "artist title" on its providers, then the best match plays.
  // Neither an ISRC nor the artist filter of the search service finds chart tracks reliably.
  async _playTrend(i, enqueue) {
    const t = this._t(), cfg = this._config, ma = this._ctx?.ma;
    const zones = Object.keys(cfg.trends ?? {});
    const sensor = this._hass.states[cfg.trends?.[zones.includes(this._zone) ? this._zone : zones[0]]];
    const it = (sensor?.attributes?.tracks ?? [])[i];
    if (!it || !ma) return;
    this._toast(t.looking + it.title + "…");
    try {
      const entry = await this._entryId();
      const r = await this._hass.callWS({ type: "call_service", domain: "music_assistant", service: "search", return_response: true,
        service_data: { config_entry_id: entry, name: it.artist + " " + it.title, media_type: ["track"], limit: 8 } });
      const best = pickTrack(r?.response?.tracks, it.title, it.artist);
      if (!best?.uri) { this._toast(t.notFound + it.title); return; }
      this._play(best.uri, "music", enqueue);
    } catch (e) {
      this._toast(t.err + (e?.message ?? e));
    }
  }

  // --- Now playing pop-up (layout: nowplaying): big cover, heart, progress, controls, speakers, volume --------

  _renderNowPlaying() {
    if (!this.shadowRoot || !this._ctx) return;
    const t = this._t();
    const { ma, st } = this._ctx;
    const a = st?.attributes ?? {};
    const live = ORIGAMI_MUSIC_LIVE.includes(st?.state);
    const known = live || !!a.media_title;
    const card = this._skel("nowp", '<div class="bigart"></div>'
      + '<div class="ttl"><div class="titles"><div class="name"></div><div class="status"></div></div><div class="hslot"></div></div>'
      + '<div class="prog"><div class="bar"><i></i></div><div class="times"><span class="pos"></span><span class="dur"></span></div></div>'
      + '<div class="ctrls"><div class="c" data-c="shuffle"></div><div class="c" data-c="prev"></div><div class="c big" data-c="pp"></div>'
      + '<div class="c" data-c="next"></div><div class="c" data-c="repeat"></div></div>'
      + '<div class="devrow"><div class="dev" data-c="dev"><ha-icon icon="mdi:speaker"></ha-icon><span></span></div><span class="devn"></span>'
      + '<div class="more" data-c="more"></div></div>'
      + '<div class="vrow"><div class="vol"><i class="vfill"></i><i class="vknob"></i><span class="vic"></span><span class="vpct"></span></div>'
      + '<div class="vmore" data-c="vmore"></div></div><div class="vpanel" hidden><div class="presets"></div><div class="mvols"></div></div>'
      + '<div class="toast"></div>',
      (ev) => {
        const h = ev.target.closest('[data-act="fav-toggle"]');
        if (h) { this._favToggle(h.dataset.id); return; }
        const preset = ev.target.closest("[data-preset]");
        if (preset) { this._groupVolume(Number(preset.dataset.preset), true); return; }
        if (ev.target.closest('[data-c="vmore"]')) { this._volOpen = !this._volOpen; this._renderNowPlaying(); return; }
        this._playerClick(ev);
      });
    if (!card._vol) { card._vol = true; this._wireVolume(card.querySelector(".vrow .vol"), (v) => this._groupVolume(v)); }
    const group = this._groupNames();
    card.querySelector(".name").textContent = !ma ? t.nosel : known ? (a.media_title || t.playing) : t.idle;
    card.querySelector(".status").textContent = known ? [a.media_artist, a.media_album_name].filter(Boolean)[0] ?? "" : "";
    const pic = known && typeof a.entity_picture === "string" ? a.entity_picture : null;
    if (card._pic !== pic) { card._pic = pic; this._art(card.querySelector(".bigart"), pic, "mdi:music"); }
    const uri = known ? a.media_content_id : null, fav = this._fav(uri);
    if (card._fav !== uri + "|" + fav) { card._fav = uri + "|" + fav; card.querySelector(".hslot").replaceChildren(this._heart(uri, "big")); }
    card.querySelector(".dev span").textContent = group.join(" + ");
    card.querySelector(".devn").textContent = group.length > 1 ? group.length + t.speakersN : "";
    this._setIcon(card.querySelector('[data-c="more"]'), "mdi:dots-horizontal");
    const sh = card.querySelector('[data-c="shuffle"]');
    this._setIcon(sh, a.shuffle ? "mdi:shuffle" : "mdi:shuffle-disabled");
    sh.classList.toggle("on", !!a.shuffle);
    this._setIcon(card.querySelector('[data-c="prev"]'), "mdi:skip-previous");
    this._setIcon(card.querySelector('[data-c="pp"]'), st?.state === "playing" ? "mdi:pause" : "mdi:play");
    this._setIcon(card.querySelector('[data-c="next"]'), "mdi:skip-next");
    const rp = card.querySelector('[data-c="repeat"]');
    this._setIcon(rp, a.repeat === "one" ? "mdi:repeat-once" : a.repeat === "all" ? "mdi:repeat" : "mdi:repeat-off");
    rp.classList.toggle("on", a.repeat === "one" || a.repeat === "all");
    card.classList.toggle("dead", !st || ["unavailable", "unknown"].includes(st.state));
    card.classList.toggle("idle", !live);
    this._setIcon(card.querySelector(".vic"), (a.volume_level ?? 0) < 0.34 ? "mdi:volume-low" : (a.volume_level ?? 0) < 0.67 ? "mdi:volume-medium" : "mdi:volume-high");
    this._paintGroupVolume(card);
    this._tick();
    if (st?.state === "playing") { if (!this._tickT) this._tickT = setInterval(() => this._tick(), 1000); }
    else { clearInterval(this._tickT); this._tickT = null; }
  }

  disconnectedCallback() {
    // Bubble Card rebuilds a pop-up's content when it opens again, so everything starts over then
    clearInterval(this._tickT);
    this._tickT = null;
    this._sig = null;
  }

  _toast(text) {
    const el = this.shadowRoot?.querySelector(".toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
  }

  _fail(e) {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = '<ha-card style="padding:16px;color:var(--error-color,#c00)">origami-music v'
      + ORIGAMI_MUSIC_VERSION + " : " + String(e?.message ?? e).replace(/</g, "&lt;") + "</ha-card>";
    this._sig = null;
  }
}

const ORIGAMI_MUSIC_CSS = `
  :host { display: block; }
  ha-card { padding: var(--ha-space-4, 16px); display: flex; flex-direction: column; gap: var(--ha-space-3, 12px); position: relative; }
  .head { display: flex; align-items: flex-start; gap: var(--ha-space-2, 8px); }
  .titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 600); color: var(--primary-text-color); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .status { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--secondary-text-color); }
  .version { font-size: 10px; color: var(--secondary-text-color); opacity: var(--opacity-quiet, 0.6); }
  .tabs { display: flex; gap: var(--ha-space-2, 8px); }
  .tab {
    padding: 6px 12px; border-radius: 999px; cursor: pointer; user-select: none;
    flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
    font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 600);
    background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1)); color: var(--secondary-text-color);
    transition: var(--transition-interactive, background-color 0.2s);
  }
  .tab.on { background-color: var(--fill-strong, rgba(127, 127, 127, 0.22)); color: var(--primary-text-color); }
  .body { display: flex; flex-direction: column; gap: var(--ha-space-1, 4px); }
  .body:empty { display: none; }
  .row {
    display: flex; align-items: center; gap: var(--ha-space-3, 12px);
    min-height: 52px; padding: var(--ha-space-2, 8px); border-radius: var(--radius-inner, 12px);
    cursor: pointer; transition: var(--transition-interactive, background-color 0.2s);
  }
  .row:active { transform: scale(var(--press-scale, 0.98)); }
  .row.current { background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1)); cursor: default; }
  .thumb {
    flex: 0 0 auto; width: 44px; height: 44px; border-radius: var(--radius-inner, 10px); overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1)); color: var(--secondary-text-color);
    --mdc-icon-size: var(--icon-size-s, 20px);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .title, .sub { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .title { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 600); color: var(--primary-text-color); }
  .row.current .title { color: var(--accent-color, var(--primary-color)); }
  .sub { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--secondary-text-color); }
  .dur { flex: 0 0 auto; font-size: var(--ha-font-size-s, 12px); font-variant-numeric: tabular-nums; color: var(--secondary-text-color); }
  .acts { flex: 0 0 auto; display: flex; gap: var(--ha-space-1, 4px); }
  .act {
    width: 36px; height: 36px; border-radius: var(--radius-inner, 10px); display: flex; align-items: center; justify-content: center;
    background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1)); color: var(--primary-text-color);
    --mdc-icon-size: var(--icon-size-xs, 18px); cursor: pointer;
  }
  .act.main { background-color: var(--fill-strong, rgba(127, 127, 127, 0.22)); }
  .act:active { transform: scale(var(--press-scale, 0.95)); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ha-space-2, 8px); }
  .tile {
    display: flex; align-items: center; gap: var(--ha-space-3, 12px); padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
    border-radius: var(--ha-card-border-radius, 16px); background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1));
    font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 600); color: var(--primary-text-color);
    cursor: pointer; --mdc-icon-size: var(--icon-size-m, 22px);
  }
  .tile:active { transform: scale(var(--press-scale, 0.97)); }
  .back {
    display: flex; align-items: center; gap: 4px; padding: 4px 0 8px; cursor: pointer;
    font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 600); color: var(--primary-text-color);
    --mdc-icon-size: 20px;
  }
  .section {
    padding: var(--ha-space-3, 12px) 0 4px; font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-bold, 600);
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color);
  }
  .hint { padding: var(--ha-space-3, 12px) 0; font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .hint.error { color: var(--error-color, #c62828); }
  .search {
    display: flex; align-items: center; gap: var(--ha-space-2, 8px); padding: 0 var(--ha-space-3, 12px);
    height: 44px; border-radius: var(--radius-inner, 12px); background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1));
    color: var(--secondary-text-color); --mdc-icon-size: 20px;
  }
  .search input {
    flex: 1 1 auto; min-width: 0; border: none; outline: none; background: none;
    font: inherit; font-size: var(--ha-font-size-m, 14px); color: var(--primary-text-color);
  }
  .toast {
    position: absolute; left: 50%; bottom: 12px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
    padding: 6px 12px; border-radius: 999px; font-size: var(--ha-font-size-s, 12px);
    background-color: var(--primary-text-color); color: var(--card-background-color, #fff);
    transition: opacity 0.2s, transform 0.2s; white-space: nowrap;
  }
  .toast.show { opacity: 0.92; transform: translate(-50%, 0); }
  .art { flex: none; width: var(--tile-size, 40px); height: var(--tile-size, 40px); border-radius: var(--radius-inner, 10px); overflow: hidden;
    display: flex; align-items: center; justify-content: center; background-color: var(--fill-subtle, rgba(127, 127, 127, 0.1));
    color: var(--secondary-text-color); --mdc-icon-size: var(--icon-size-s, 20px); }
  .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pp { flex: none; width: 40px; height: 40px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
    background-color: var(--fill-strong, rgba(127, 127, 127, 0.22)); color: var(--primary-text-color); --mdc-icon-size: 22px; }
  .pp[hidden] { display: none; }
  .shelf { display: flex; gap: var(--ha-space-3, 12px); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
    margin: 0 calc(-1 * var(--ha-space-4, 16px)); padding: 0 var(--ha-space-4, 16px); scroll-padding-inline: var(--ha-space-4, 16px); }
  .shelf::-webkit-scrollbar { display: none; }
  .cover { flex: 0 0 96px; min-width: 0; scroll-snap-align: start; cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
  .cover:active { transform: scale(0.96); }
  .cover .thumb { width: 96px; height: 96px; border-radius: var(--radius-inner, 12px); --mdc-icon-size: 32px; }
  ha-card.banner { flex-direction: row; align-items: center; gap: 14px; height: 92px; box-sizing: border-box; padding: 14px 16px 14px 14px;
    border-radius: 30px; background: var(--ha-card-background, #fff); box-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.10));
    border: 0; cursor: pointer; }
  .art.big { width: 64px; height: 64px; border-radius: 20px; box-shadow: 0 4px 10px rgba(74, 70, 64, 0.18); --mdc-icon-size: 28px; }
  ha-card.banner .name { font-size: 19px; }
  ha-card.banner .status { font-size: 15px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .pp.big { width: 54px; height: 54px; background-color: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); --mdc-icon-size: 26px; }
  .nx { flex: none; width: 36px; height: 54px; display: flex; align-items: center; justify-content: center; color: var(--primary-text-color); --mdc-icon-size: 26px; }
  .nx[hidden] { display: none; }
  ha-card.shelfcard { background: none; box-shadow: none; border: 0; padding: 0; }
  .shelf.big { gap: 14px; margin: 0; padding: 4px 0 10px; }
  .shelf.big .cover { flex: 0 0 128px; gap: 8px; }
  .shelf.big .cover .thumb { width: 128px; height: 128px; border-radius: 24px; box-shadow: 0 6px 16px rgba(74, 70, 64, 0.16); --mdc-icon-size: 40px; }
  .shelf.big .cname { font-size: 15px; font-weight: var(--ha-font-weight-bold, 700); -webkit-line-clamp: 1; }
  .ckind { margin-top: -6px; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .hd { display: flex; align-items: center; justify-content: space-between; padding: var(--ha-space-6, 24px) 4px var(--ha-space-2, 8px) 0; }
  .ht { font-size: var(--ha-font-size-l, 20px); font-weight: var(--ha-font-weight-bold, 700); color: var(--primary-text-color); }
  .hv { font-size: var(--ha-font-size-m, 16px); font-weight: 700; color: var(--secondary-text-color); }
  .link { cursor: pointer; }
  ha-card.shelfcard .hd + .shelf { padding-top: 0; }
  .shelf.big.s { gap: 12px; }
  .shelf.big.s .cover { flex: 0 0 100px; gap: 6px; }
  .shelf.big.s .cover .thumb { width: 100px; height: 100px; border-radius: 20px; box-shadow: 0 4px 12px rgba(74, 70, 64, 0.14); }
  .shelf.big.s .cname { font-size: 13px; }
  .shelf.big.s .ckind { display: none; }
  ha-card.player { padding: 18px; gap: 16px; border-radius: 28px; background: var(--ha-card-background, #fff); border: 0;
    box-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.08)); }
  .np { display: flex; align-items: center; gap: 14px; }
  .art.np-art { width: 76px; height: 76px; border-radius: 22px; box-shadow: 0 6px 14px rgba(74, 70, 64, 0.18); --mdc-icon-size: 32px; }
  ha-card.player .name { font-size: 20px; }
  ha-card.player .status { font-size: 15px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .grp { font-size: 13px; font-weight: 600; color: var(--secondary-text-color); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .more { flex: none; width: 52px; height: 52px; border-radius: 16px; background: var(--fill-subtle, #f1efeb); display: flex;
    align-items: center; justify-content: center; cursor: pointer; color: var(--primary-text-color); --mdc-icon-size: 24px; }
  .prog { display: flex; flex-direction: column; gap: 6px; }
  .prog[hidden] { display: none; }
  .bar { height: 6px; border-radius: 999px; background: var(--fill-subtle, #ebe9e5); overflow: hidden; }
  .bar i { display: block; height: 6px; border-radius: 999px; background: var(--toggle-on, #5e5a54); }
  .times { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .ctrls { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; }
  .c { width: 44px; height: 44px; border-radius: 999px; display: flex; align-items: center; justify-content: center; cursor: pointer;
    color: var(--primary-text-color); --mdc-icon-size: 28px; -webkit-tap-highlight-color: transparent; }
  .c[data-c="shuffle"], .c[data-c="repeat"] { --mdc-icon-size: 22px; color: var(--secondary-text-color); }
  .c.on { color: var(--state-media_player-active-color, var(--light-blue-color, #6f93ab)); }
  .c.big { width: 68px; height: 68px; background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); --mdc-icon-size: 34px; }
  .c:active { transform: scale(0.94); }
  ha-card.player.dead .ctrls, ha-card.player.dead .vol { opacity: var(--opacity-disabled, 0.4); pointer-events: none; }
  .vol { position: relative; height: 48px; border-radius: 16px; background: var(--fill-subtle, #f1efeb); overflow: hidden; cursor: pointer; touch-action: pan-y; }
  .vfill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--primary-text-color) 10%, var(--fill-subtle, #f1efeb)); }
  .vknob { position: absolute; top: 12px; bottom: 12px; width: 4px; margin-left: -10px; border-radius: 2px; background: var(--toggle-on, #5e5a54); }
  .vic { position: absolute; left: 16px; top: 0; bottom: 0; display: flex; align-items: center; color: var(--primary-text-color); --mdc-icon-size: 22px; pointer-events: none; }
  .vpct { position: absolute; right: 16px; top: 0; bottom: 0; display: flex; align-items: center; font-size: 15px; font-weight: 600;
    color: var(--secondary-text-color); pointer-events: none; font-variant-numeric: tabular-nums; }
  ha-card.speakers, ha-card.queue, ha-card.shelfcard { background: none; box-shadow: none; border: 0; padding: 0; gap: 0; }
  .sp { display: flex; flex-direction: column; gap: 10px; }
  .spk { height: 68px; box-sizing: border-box; border-radius: 24px; background: var(--fill-subtle, #eae8e4); padding: 10px 16px 10px 10px;
    display: flex; align-items: center; gap: 14px; cursor: pointer; }
  .spk.on { background: var(--ha-card-background, #fff); box-shadow: var(--card-elevation-flat, 0 4px 14px rgba(74, 70, 64, 0.08)); }
  .spk .sq { position: relative; width: 48px; height: 48px; flex: none; border-radius: 16px; background: var(--ha-card-background, #fff);
    display: flex; align-items: center; justify-content: center; color: var(--primary-text-color); --mdc-icon-size: 22px; }
  .spk.on .sq { background: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 18%, var(--ha-card-background, #fff));
    color: var(--state-media_player-active-color, #6f93ab); }
  .spk .badge { position: absolute; top: -7px; right: -7px; width: 24px; height: 24px; box-sizing: border-box; border-radius: 999px;
    border: 2px solid var(--primary-background-color, #f4f3f0); background: var(--state-media_player-active-color, #6f93ab); color: #fff;
    display: flex; align-items: center; justify-content: center; --mdc-icon-size: 12px; }
  .spk .title { font-size: 17px; }
  .spk .sub { font-size: 14px; font-weight: 600; }
  .spk.off .title, .spk.off .sq { opacity: var(--opacity-disabled, 0.45); }
  .vp { flex: none; font-size: 16px; font-weight: 700; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .chk { width: 40px; height: 40px; flex: none; box-sizing: border-box; border-radius: 13px;
    border: 2px solid color-mix(in srgb, var(--primary-text-color, #4a4640) 22%, transparent);
    background: var(--ha-card-background, #fff); display: flex; align-items: center; justify-content: center; --mdc-icon-size: 22px; }
  .chk.on { border: 0; background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .chk.leader { cursor: default; }
  .spk.off .chk { visibility: hidden; }
  .chk.na { border-style: dashed; opacity: var(--opacity-disabled, 0.45); cursor: default; color: var(--secondary-text-color); --mdc-icon-size: 18px; }
  ha-card.queue .lst { border-radius: 26px; background: var(--fill-subtle, #eae8e4); padding: 8px; display: flex; flex-direction: column; }
  ha-card.queue .row { padding: 8px; min-height: 0; }
  ha-card.queue .thumb { width: 48px; height: 48px; border-radius: 14px; background: var(--ha-card-background, #fff); box-shadow: 0 2px 6px rgba(74, 70, 64, 0.08); }
  ha-card.queue .title { font-size: 15px; }
  ha-card.queue .sub, ha-card.queue .dur { font-size: 13px; font-weight: 600; }
  ha-card.library { background: none; box-shadow: none; border: 0; padding: 0; gap: 14px;
    min-height: calc(100vh - 180px); min-height: calc(100dvh - 180px); align-content: start; }
  .libbody.busy { opacity: 0.45; transition: opacity 0.15s; pointer-events: none; }
  /* The library can be much taller than the screen, so its message stays at the bottom of the visible area */
  ha-card.library .toast { position: fixed; bottom: 24px; z-index: 5; }
  .now { align-self: flex-start; display: flex; align-items: center; gap: 8px; height: 40px; box-sizing: border-box; padding: 0 16px 0 12px;
    border-radius: 999px; background: var(--ha-card-background, #fff); box-shadow: var(--card-elevation-flat, 0 4px 12px rgba(74, 70, 64, 0.08));
    font-size: 15px; font-weight: 700; color: var(--primary-text-color); cursor: pointer; max-width: 100%; --mdc-icon-size: 20px; }
  .now[hidden] { display: none; }
  .now span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  ha-card.library .search { height: 52px; border-radius: 18px; padding: 0 16px; background: var(--fill-subtle, #eae8e4); }
  ha-card.library .search input { font-size: 16px; }
  .cats { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .cats::-webkit-scrollbar { display: none; }
  .cat { flex: none; display: flex; align-items: center; gap: 7px; height: 40px; box-sizing: border-box; padding: 0 14px; border-radius: 999px;
    background: var(--fill-subtle, #eae8e4); color: var(--primary-text-color); font-size: 14px; font-weight: 700; cursor: pointer; --mdc-icon-size: 18px; }
  .cat.on { background: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 18%, var(--ha-card-background, #fff));
    color: var(--state-media_player-active-color, #6f93ab); }
  .libbody { display: flex; flex-direction: column; gap: 4px; }
  .libbody > .hd:first-child { padding-top: 6px; }
  .pgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .pl { display: flex; flex-direction: column; gap: 8px; min-width: 0; cursor: pointer; }
  .pl .thumb { position: relative; width: 100%; height: auto; aspect-ratio: 1; border-radius: 24px; box-shadow: 0 6px 16px rgba(74, 70, 64, 0.16); --mdc-icon-size: 40px; }
  .plbtn { position: absolute; right: 10px; bottom: 10px; width: 40px; height: 40px; border-radius: 999px; background: rgba(255, 255, 255, 0.9);
    color: #4a4640; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 22px; }
  .plname { font-size: 15px; font-weight: 700; color: var(--primary-text-color); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 2px; }
  .albums { border-radius: 26px; background: var(--fill-subtle, #eae8e4); padding: 8px; display: flex; flex-direction: column; }
  .albums .thumb { width: 52px; height: 52px; border-radius: 14px; }
  .albums .act { background: var(--ha-card-background, #fff); }
  .albums .act.main { background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .cname { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--primary-text-color);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; }
  /* Music pop-up with Spotify-like navigation (app) and the now playing pop-up (nowplaying) */
  ha-card.app { background: none; box-shadow: none; border: 0; padding: 0; gap: 18px;
    min-height: calc(100vh - 180px); min-height: calc(100dvh - 180px); }
  ha-card.app .toast, ha-card.nowp .toast { position: fixed; bottom: 104px; z-index: 5; }
  .tabs2 { display: flex; gap: 8px; }
  .tab2 { height: 40px; box-sizing: border-box; padding: 0 18px; border-radius: 999px; display: flex; align-items: center; cursor: pointer;
    background: var(--fill-subtle, #eae8e4); color: var(--primary-text-color); font-size: 15px; font-weight: 700; user-select: none;
    -webkit-tap-highlight-color: transparent; }
  .tab2.on { background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .pane { display: flex; flex-direction: column; gap: 18px; }
  .sec { display: flex; flex-direction: column; gap: 12px; }
  .sec:empty { display: none; }
  ha-card.app .hd { padding: 4px 4px 0 0; }
  ha-card.app .ht { font-size: 21px; display: flex; align-items: center; gap: 8px; --mdc-icon-size: 20px; }
  ha-card.app .ht ha-icon { color: #c9785c; }
  .rcard { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 26px; cursor: pointer;
    background: var(--ha-card-background, #fff); box-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.08)); }
  .rcard:active, .rtile:active, .trow:active, .radio:active, .art2:active, .lrow:active, .cat2:active { transform: scale(0.98); }
  .art.rart { width: 72px; height: 72px; border-radius: 20px; box-shadow: 0 6px 14px rgba(74, 70, 64, 0.18); --mdc-icon-size: 30px; }
  .rlab { font-size: 13px; font-weight: 700; color: var(--secondary-text-color); }
  .rcard .name { font-size: 17px; }
  .rcard .status { font-size: 13px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .rcard .pp.big { width: 52px; height: 52px; }
  .rgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .rtile { height: 58px; border-radius: 14px; background: var(--fill-subtle, #eae8e4); display: flex; align-items: center; gap: 10px;
    overflow: hidden; cursor: pointer; }
  .rtile .thumb { width: 58px; height: 58px; border-radius: 0; flex: none; }
  .rtile span { padding-right: 10px; font-size: 13px; font-weight: 700; line-height: 1.25; color: var(--primary-text-color);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .zones { display: flex; align-items: center; gap: 8px; margin-top: -4px; }
  .zone { height: 34px; box-sizing: border-box; padding: 0 14px; border-radius: 999px; display: flex; align-items: center; cursor: pointer;
    border: 1.5px solid color-mix(in srgb, var(--primary-text-color, #4a4640) 16%, transparent); background: var(--ha-card-background, #fff);
    font-size: 14px; font-weight: 700; color: var(--primary-text-color); }
  .zone.on { border: 0; background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .maj { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; }
  .tlist { border-radius: 26px; background: var(--ha-card-background, #fff); box-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.08));
    padding: 4px 8px 4px 12px; display: flex; flex-direction: column; }
  .trow { height: 64px; display: flex; align-items: center; gap: 12px; cursor: pointer; }
  .trow + .trow { border-top: 1px solid color-mix(in srgb, var(--primary-text-color, #4a4640) 8%, transparent); }
  .rank { width: 34px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .rank b { font-size: 18px; font-weight: 700; color: var(--primary-text-color); }
  .rank i { font-style: normal; font-size: 10px; font-weight: 700; white-space: nowrap; }
  .move-up { color: #5f8a4c; } .move-down { color: #b0674c; } .move-same { color: var(--secondary-text-color); }
  .move-new { color: var(--state-media_player-active-color, #6f93ab); }
  .trow .thumb { width: 48px; height: 48px; border-radius: 12px; }
  .trow .title { font-size: 15px; } .trow .sub { font-size: 12px; font-weight: 600; }
  .nextb { width: 40px; height: 40px; flex: none; border-radius: 13px; background: var(--fill-subtle, #f4f3f0); display: flex;
    align-items: center; justify-content: center; color: var(--primary-text-color); --mdc-icon-size: 20px; cursor: pointer; }
  .rad, .arts { display: flex; gap: 14px; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
  .rad::-webkit-scrollbar, .arts::-webkit-scrollbar { display: none; }
  .radio { width: 76px; flex: none; display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
  .radio .sq { width: 76px; height: 76px; border-radius: 22px; color: #fff; display: flex; align-items: center; justify-content: center;
    font-size: 19px; font-weight: 700; box-shadow: 0 4px 12px rgba(74, 70, 64, 0.14); overflow: hidden;
    box-sizing: border-box; padding: 0 6px; white-space: nowrap; text-overflow: ellipsis; }
  .radio .sq.long { font-size: 14px; }
  .radio .lab { font-size: 13px; font-weight: 700; color: var(--primary-text-color); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  ha-card.app .shelf.big .ckind { display: block; margin-top: -4px; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  ha-card.app .shelf.big .cname { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .art2 { width: 92px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; }
  .art2 .thumb { width: 92px; height: 92px; border-radius: 999px; box-shadow: 0 4px 12px rgba(74, 70, 64, 0.14); --mdc-icon-size: 32px; }
  .art2 span { max-width: 92px; font-size: 13px; font-weight: 700; text-align: center; color: var(--primary-text-color);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .mini { position: sticky; bottom: var(--origami-music-mini-bottom, 12px); z-index: 3; height: 64px; box-sizing: border-box;
    padding: 8px 10px 8px 8px; border-radius: 22px; background: var(--ha-card-background, #fff); cursor: pointer;
    box-shadow: 0 8px 22px rgba(74, 70, 64, 0.16); display: flex; align-items: center; gap: 12px; }
  .mini[hidden] { display: none; }
  .mini .art { width: 48px; height: 48px; border-radius: 14px; }
  .mini .name { font-size: 15px; }
  .mini .status { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .mini .pp { width: 44px; height: 44px; background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .heart { flex: none; width: 40px; height: 40px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
    color: var(--secondary-text-color); --mdc-icon-size: 22px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .heart.on { color: #c9785c; }
  .heart[hidden] { display: none; }
  .heart:active { transform: scale(0.9); }
  ha-card.app .search { height: 52px; border-radius: 18px; padding: 0 16px; background: var(--ha-card-background, #fff);
    box-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.08)); color: var(--primary-text-color); }
  ha-card.app .search input { font-size: 16px; font-weight: 600; }
  .sres { display: flex; flex-direction: column; gap: 4px; }
  .sres.busy { opacity: 0.45; transition: opacity 0.15s; pointer-events: none; }
  .list { display: flex; flex-direction: column; }
  .lrow { min-height: 68px; padding: 4px 0; gap: 14px; }
  .lrow .thumb { width: 60px; height: 60px; border-radius: 14px; box-shadow: 0 2px 8px rgba(74, 70, 64, 0.10); --mdc-icon-size: 26px; }
  .thumb.round { border-radius: 999px; }
  .lrow .title { font-size: 16px; } .lrow .sub { font-size: 13px; font-weight: 600; }
  .favtile { background: color-mix(in srgb, #c9785c 18%, var(--ha-card-background, #fff)); color: #c9785c; }
  .mal .thumb { background: var(--fill-subtle, #eae8e4); }
  .x { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color);
    --mdc-icon-size: 18px; cursor: pointer; }
  .cats2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .cat2 { position: relative; height: 72px; box-sizing: border-box; padding: 12px 14px; border-radius: 20px; overflow: hidden;
    font-size: 15px; font-weight: 700; cursor: pointer; }
  .cat2 ha-icon { position: absolute; right: 10px; bottom: 6px; --mdc-icon-size: 40px; transform: rotate(-12deg); opacity: 0.9; }
  .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -4px; padding: 0 4px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; height: 34px; box-sizing: border-box; padding: 0 14px; border-radius: 999px; display: flex; align-items: center; cursor: pointer;
    border: 1.5px solid color-mix(in srgb, var(--primary-text-color, #4a4640) 16%, transparent); background: var(--ha-card-background, #fff);
    font-size: 14px; font-weight: 700; color: var(--primary-text-color); }
  .chip.on { border: 0; background: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 18%, var(--ha-card-background, #fff));
    color: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 65%, var(--primary-text-color, #4a4640)); }
  .sortb { align-self: flex-start; height: 32px; display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 14px; font-weight: 700;
    color: var(--primary-text-color); --mdc-icon-size: 18px; }
  .playall { align-self: flex-start; display: flex; align-items: center; gap: 8px; height: 44px; box-sizing: border-box; padding: 0 18px 0 14px;
    border-radius: 999px; background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); font-size: 15px; font-weight: 700;
    cursor: pointer; --mdc-icon-size: 22px; margin-bottom: 4px; }
  ha-card.app .back { font-size: 17px; }
  ha-card.nowp { background: none; box-shadow: none; border: 0; padding: 0 4px; gap: 18px; }
  .bigart { width: 100%; aspect-ratio: 1; border-radius: 30px; overflow: hidden; box-shadow: 0 14px 34px rgba(74, 70, 64, 0.22);
    background: var(--fill-subtle, #eae8e4); display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color);
    --mdc-icon-size: 72px; }
  .bigart img { width: 100%; height: 100%; object-fit: cover; display: block; }
  ha-card.nowp.idle .bigart { opacity: 0.75; }
  .ttl { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
  ha-card.nowp .name { font-size: 24px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  ha-card.nowp .status { font-size: 16px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .heart.big { width: 48px; height: 48px; border-radius: 16px; background: var(--fill-subtle, #eae8e4); --mdc-icon-size: 26px; }
  .heart.big.on { background: color-mix(in srgb, #c9785c 18%, var(--ha-card-background, #fff)); }
  .devrow { display: flex; align-items: center; gap: 12px; }
  .dev { min-width: 0; height: 44px; box-sizing: border-box; padding: 0 16px 0 12px; border-radius: 999px; display: flex; align-items: center; gap: 8px;
    background: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 18%, var(--ha-card-background, #fff));
    color: color-mix(in srgb, var(--state-media_player-active-color, #6f93ab) 65%, var(--primary-text-color, #4a4640)); font-size: 14px; font-weight: 700; cursor: pointer; --mdc-icon-size: 18px; }
  .dev span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .devn { flex: none; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .devrow .more { margin-left: auto; width: 44px; height: 44px; border-radius: 14px; }
  ha-card.nowp.dead .ctrls, ha-card.nowp.dead .vol { opacity: var(--opacity-disabled, 0.4); pointer-events: none; }
  /* Group volume of the now playing pop-up, and the also play on grid (group) */
  .vrow { display: flex; align-items: center; gap: 8px; }
  .vrow .vol { flex: 1 1 auto; }
  .vmore { flex: none; width: 48px; height: 48px; border-radius: 16px; background: var(--fill-subtle, #f1efeb); display: flex;
    align-items: center; justify-content: center; cursor: pointer; color: var(--primary-text-color); --mdc-icon-size: 24px; }
  .vmore.open { background: var(--toggle-on, #5e5a54); color: var(--text-color-active, #fff); }
  .vpanel { display: flex; flex-direction: column; gap: 10px; }
  .vpanel[hidden] { display: none; }
  .presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .preset { height: 42px; border-radius: 14px; background: var(--fill-subtle, #eae8e4); display: flex; align-items: center;
    justify-content: center; font-size: 14px; font-weight: 700; color: var(--primary-text-color); cursor: pointer; }
  .preset:active, .gchip:active { transform: scale(0.97); }
  .mvols { display: flex; flex-direction: column; gap: 8px; }
  .mvol { display: flex; align-items: center; gap: 12px; }
  .mname { width: 96px; flex: none; font-size: 14px; font-weight: 700; color: var(--primary-text-color);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .mvol .vol { flex: 1 1 auto; height: 38px; border-radius: 13px; }
  .mvol .vknob { top: 9px; bottom: 9px; }
  .mvol .vpct { right: 12px; font-size: 13px; }
  ha-card.group { background: none; box-shadow: none; border: 0; padding: 0; gap: 0; }
  ha-card.group .hd { padding-top: 8px; }
  ha-card.group .hv { display: flex; align-items: center; gap: 6px; font-size: 14px; --mdc-icon-size: 18px; }
  ha-card.group .hv[hidden] { display: none; }
  .ghint { padding: 0 4px 10px; font-size: 13px; font-weight: 600; color: var(--secondary-text-color); }
  .ghint[hidden] { display: none; }
  .ggrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .gchip { height: 48px; box-sizing: border-box; padding: 0 14px; border-radius: 16px; display: flex; align-items: center; gap: 10px;
    background: var(--fill-subtle, #eae8e4); color: var(--secondary-text-color); font-size: 15px; font-weight: 700; cursor: pointer;
    --mdc-icon-size: 20px; min-width: 0; }
  .gchip span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .gchip.on { background: var(--ha-card-background, #fff); color: var(--primary-text-color);
    box-shadow: var(--card-elevation-flat, 0 4px 12px rgba(74, 70, 64, 0.08)); }
  .gchip.on ha-icon { color: var(--state-media_player-active-color, #6f93ab); }
  .gchip.na { opacity: var(--opacity-disabled, 0.45); }
  .gchip.all { background: none; border: 1.5px dashed color-mix(in srgb, var(--primary-text-color, #4a4640) 22%, transparent); }
`;

if (typeof customElements !== "undefined" && !customElements.get("origami-music")) {
  customElements.define("origami-music", OrigamiMusic);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "origami-music", name: "Origami Music", description: "Now playing, speakers, queue, library, search and charts for Music Assistant" });
}
