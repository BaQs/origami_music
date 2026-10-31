// A made-up home for the tests and the README images: five speakers, one group, a Music Assistant library and a queue.
import { createHass, mount } from "./mock-ha.js";

const cover = (n) => `${location.origin}/test/mock/img/cover${n}.svg`;
const SPEAKERS = [
  ["living_room", "Living room"], ["kitchen", "Kitchen"], ["bedroom", "Bedroom"], ["bathroom", "Bathroom"], ["office", "Office"],
];
const PLAYERS = Object.fromEntries(SPEAKERS.map(([id]) => [`media_player.${id}_speaker`, `media_player.${id}`]));
const NAMES = Object.fromEntries(SPEAKERS.map(([id, name]) => [`media_player.${id}_speaker`, name]));

const TRACKS = [
  ["Golden Hour", "The Lanterns", "Evening Lights", 1, 214], ["Slow River", "The Lanterns", "Evening Lights", 1, 241],
  ["Paper Boats", "Mira Vale", "Small Weather", 2, 198], ["Northern Line", "Odd Harbour", "Transit", 3, 263],
  ["Late Bloom", "Mira Vale", "Small Weather", 2, 187], ["Static", "Odd Harbour", "Transit", 3, 225],
];
const queue = TRACKS.map(([name, artists, album, n, duration], i) => ({
  queue_item_id: `q${i}`, uri: `library://track/${100 + i}`, name, artists, album, image: cover(n), duration,
}));

const PLAYLISTS = [["Sunday Morning", 4], ["Focus", 5], ["Dinner Jazz", 6], ["Road Trip", 3]];
const ALBUMS = [["Evening Lights", "The Lanterns", 1], ["Small Weather", "Mira Vale", 2], ["Transit", "Odd Harbour", 3],
  ["Blue Hours", "Juno Park", 5], ["Field Notes", "The Lanterns", 4], ["Harbour Lights", "Odd Harbour", 6]];
const library = {
  playlist: PLAYLISTS.map(([name, n], i) => ({ media_type: "playlist", uri: `library://playlist/${i + 1}`, name, image: cover(n) })),
  album: ALBUMS.map(([name, artist, n], i) => ({ media_type: "album", uri: `library://album/${i + 1}`, name, image: cover(n),
                                                  artists: [{ name: artist }] })),
};
library.radio = ["Radio Lumen", "Harbour FM", "Night Owl", "Jazz Corner"].map((name, i) => ({ media_type: "radio", uri: `library://radio/${i + 1}`, name }));
library.track = TRACKS.slice(1).map(([name, artist, , n], i) => ({ media_type: "track", uri: `library://track/${101 + i}`, name, image: cover(n),
                                                                 artists: [{ name: artist }] }));
library.artist = [["The Lanterns", 1], ["Mira Vale", 2], ["Odd Harbour", 3], ["Juno Park", 5]].map(([name, n], i) => ({ media_type: "artist",
  uri: `library://artist/${i + 1}`, name, image: cover(n) }));
library.podcast = [];
library.audiobook = [];

// Two made-up charts as a chart sensor reports them: tracks in order, and the order of the previous chart
const CHARTS = {
  france: [["Neon Avenue", "Kite Club", 5], ["Paper Boats", "Mira Vale", 2], ["Slow River", "The Lanterns", 1], ["Northern Line", "Odd Harbour", 3],
    ["Blue Hours", "Juno Park", 6], ["Field Notes", "The Lanterns", 4], ["Harbour Lights", "Odd Harbour", 6]],
  world: [["Static", "Odd Harbour", 3], ["Late Bloom", "Mira Vale", 2], ["Golden Hour", "The Lanterns", 1]],
};
const chart = (list, base) => ({ tracks: list.map(([title, artist, n], i) => ({ id: base + i, title, artist, image: cover(n) })) });
// Matches for "Kite Club Neon Avenue": a remix first, then the track itself
const SEARCH_TRACKS = [
  { name: "Neon Avenue (Night Remix)", uri: "spotify://track/remix", artists: [{ name: "Kite Club" }] },
  { name: "Neon Avenue", uri: "spotify://track/neon", artists: [{ name: "Kite Club" }, { name: "Mira Vale" }] },
];

let ORIGAMI_EMPTY_SEARCH = false;
let ORIGAMI_LOCAL_SEARCH = false;

const item = (media_class, title, id, n) => ({ media_class, media_content_type: "music", media_content_id: id, title,
                                                thumbnail: n ? cover(n) : null, can_play: true, can_expand: media_class === "artist" });

const states = (idle, stopped) => {
  const now = new Date().toISOString();
  const playing = idle ? { state: "idle" } : {
    state: "playing", media_title: "Golden Hour", media_artist: "The Lanterns", media_album_name: "Evening Lights",
    entity_picture: "/test/mock/img/cover1.svg", media_duration: 214, media_position: 96, media_position_updated_at: now,
    media_content_id: "library://track/100",
  };
  // stopped: the queue is still there but nothing plays, as after a pause that lasted
  if (stopped) playing.state = "idle";
  const out = {
    "input_select.speaker": { state: "media_player.living_room_speaker", attributes: { options: Object.keys(PLAYERS) } },
    "media_player.living_room": { state: playing.state, attributes: { ...playing, friendly_name: "Living room", volume_level: 0.32,
      shuffle: false, repeat: "all", active_queue: "queue-living-room", group_members: idle ? [] : ["media_player.living_room", "media_player.kitchen"] } },
    // Music Assistant reports the same group_members list on every player of a group, with the leader first
    "media_player.kitchen": { state: playing.state, attributes: { ...playing, friendly_name: "Kitchen", volume_level: 0.25,
      group_members: idle ? [] : ["media_player.living_room", "media_player.kitchen"] } },
    "media_player.bedroom": { state: "idle", attributes: { friendly_name: "Bedroom", volume_level: 0.18 } },
    "media_player.bathroom": { state: "paused", attributes: { friendly_name: "Bathroom", volume_level: 0.4, media_title: "Morning Rain" } },
    "media_player.office": { state: "unavailable", attributes: { friendly_name: "Office" } },
    "sensor.charts_france": { state: now, attributes: { ...chart(CHARTS.france, 1), previous: [2, 1, 3, 7, 4] } },
    "sensor.charts_world": { state: now, attributes: chart(CHARTS.world, 11) },
  };
  return out;
};

const ws = {
  "config_entries/get": [{ entry_id: "music_assistant", domain: "music_assistant" }],
  call_service: ({ service, service_data }) => (service === "search" ? { response: { tracks: ORIGAMI_EMPTY_SEARCH ? [] : service_data.name.includes("Late Bloom")
    ? [{ name: "Early Bloom", uri: "spotify://track/early", artists: [{ name: "Mira Vale" }] },
       { name: "Late Bloom (feat. Juno Park)", uri: "spotify://track/bloom", artists: [{ name: "Mira Vale" }] }]
    : SEARCH_TRACKS } }
    : { response: { items: library[service_data.media_type].slice(0, service_data.limit) } }),
  "bubble_card_tools/ma_favorite_state": ({ uri }) => ({ uri, supported: true, favorite: uri === "library://track/101" }),
  "bubble_card_tools/ma_favorite_set": ({ favorite }) => ({ favorite }),
  "bubble_card_tools/ma_queue_items": { items: queue },
  "bubble_card_tools/ma_queue_command": {},
  "auth/sign_path": ({ path }) => ({ path }),
  "media_player/search_media": () => ORIGAMI_LOCAL_SEARCH ? { result: [
    { media_class: "playlist", media_content_type: "music", media_content_id: "library://playlist/9", title: "Halloween party", thumbnail: cover(3), can_play: true },
    { media_class: "music", media_content_type: "music", media_content_id: "radiobrowser://radio/a1", title: "Halloween Radio", can_play: true },
    { media_class: "music", media_content_type: "music", media_content_id: "radiobrowser://radio/a2", title: "Halloween Hit Radio", can_play: true },
  ] } : { result: [
    item("artist", "The Lanterns", "library://artist/1"), item("album", "Evening Lights", "library://album/1", 1),
    item("album", "Field Notes", "library://album/5", 4), item("track", "Golden Hour", "library://track/100", 1),
    { media_class: "track", media_content_type: "music", media_content_id: "spotify--x://track/sn1", title: "Spooky Night", thumbnail: cover(2), can_play: true },
  ] },
  "media_player/browse_media": ({ media_content_id }) => {
    if (!media_content_id) {
      return { children: ["artists", "albums", "tracks", "playlists", "radio", "podcasts", "audiobooks"].map((id) => ({
        media_content_id: id, media_content_type: id, title: id, can_expand: true })) };
    }
    if (media_content_id.startsWith("builtin://")) {
      return { title: "Liked songs", children: library.track.map((t) => ({ ...item("track", `${t.artists[0].name} - ${t.name}`, t.uri),
        thumbnail: t.image })) };
    }
    return { children: ALBUMS.map(([name, , n], i) => ({ ...item("album", name, `library://album/${i + 1}`, n), can_expand: true })) };
  },
};

const BASE = { type: "custom:origami-music", select: "input_select.speaker", players: PLAYERS, names: NAMES };

// A pop-up sheet like the Bubble Card pop-ups of the Origami dashboard
const sheet = (column, title) => {
  column.style.background = "color-mix(in srgb, var(--primary-background-color) 55%, #8a8780)";
  column.style.paddingTop = "48px";
  const el = document.createElement("div");
  el.style.cssText = "background: var(--primary-background-color); border-radius: 32px 32px 0 0; padding: 22px 16px 24px;"
    + "margin: 0 -16px -16px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12)";
  el.innerHTML = `<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 4px">
    <span style="font-size: 28px; font-weight: 700">${title}</span><ha-icon icon="mdi:close" style="--mdc-icon-size: 26px; opacity: 0.6"></ha-icon></div>`;
  column.append(el);
  return el;
};

// slow: the search answers after a second, so a test can look at the card while it loads
const slowWs = { ...ws, "media_player/search_media": (m) => new Promise((r) => setTimeout(() => r(ws["media_player/search_media"](m)), 1000)) };

export async function show(name, params, column) {
  ORIGAMI_EMPTY_SEARCH = params.has("emptysearch");
  ORIGAMI_LOCAL_SEARCH = params.has("localsearch");
  const hass = createHass({ states: states(params.has("idle"), params.has("stopped")), ws: params.has("slow") ? slowWs : ws, language: params.get("lang") ?? "en" });
  if (params.get("error")) hass.callWS = () => Promise.reject(new Error(params.get("error")));
  const extra = params.get("solo") ? { solo: [params.get("solo")] } : {};
  const add = (config) => mount("origami-music", { ...BASE, ...extra, ...config }, hass, column);
  if (name === "home") {
    await add({ layout: "banner", navigation_path: "#music" });
    return add({ layout: "shelf", limit: 6 });
  }
  if (name === "player") {
    await add({ layout: "player" });
    await add({ layout: "speakers" });
    await add({ layout: "queue", limit: 4 });
    return add({ layout: "shelf", limit: 6, size: "s", title: "Recently played", link: { text: "Library ›", path: "#library" } });
  }
  if (name === "popup") {
    const el = sheet(column, "Music");
    const put = (config) => mount("origami-music", { ...BASE, ...config }, hass, el);
    await put({ layout: "player" });
    await put({ layout: "speakers" });
    await put({ layout: "queue", limit: 4 });
    return put({ layout: "shelf", limit: 6, size: "s", title: "Recently played", link: { text: "Library ›", path: "#library" } });
  }
  if (name === "library-popup") {
    return mount("origami-music", { ...BASE, layout: "library", back_path: "#music" }, hass, sheet(column, "Library"));
  }
  if (name === "library") return add({ layout: "library", back_path: "#music" });
  const APP = { layout: "app", player_path: "#player", speakers_path: "#speakers", ma_path: "/music-assistant",
                trends: { France: "sensor.charts_france", World: "sensor.charts_world" } };
  if (name === "app") return add(APP);
  if (name === "app-popup") return mount("origami-music", { ...BASE, ...APP }, hass, sheet(column, "Music"));
  if (name === "nowplaying") return add({ layout: "nowplaying", speakers_path: "#speakers" });
  if (name === "nowplaying-popup") {
    const el = sheet(column, "Now playing");
    await mount("origami-music", { ...BASE, layout: "nowplaying", speakers_path: "#speakers" }, hass, el);
    await mount("origami-music", { ...BASE, layout: "group" }, hass, el);
    return mount("origami-music", { ...BASE, layout: "queue", limit: 3 }, hass, el);
  }
  if (name === "tabs") return add({});
  return add({ layout: name, navigation_path: "#music", limit: name === "queue" ? 4 : 6 });
}
