import { expect, test } from "@playwright/test";

const open = async (page, query) => {
  await page.goto(`/test/mock/index.html?${query}`);
  await page.evaluate(() => window.ready);
};
const card = (page, cls) => page.locator("origami-music").filter({ has: page.locator(`ha-card.${cls}`) });
const calls = (page) => page.evaluate(() => window.calls.filter((c) => c.service));
const ws = (page, type) => page.evaluate((t) => window.calls.filter((c) => c.ws === t).map((c) => c.message), type);

test("the banner shows what plays and pauses it", async ({ page }) => {
  await open(page, "fixture=banner");
  const banner = card(page, "banner");
  await expect(banner).toContainText("Golden Hour");
  await expect(banner).toContainText("The Lanterns · Living room");
  await banner.locator(".pp").click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "media_play_pause", data: { entity_id: "media_player.living_room" } }));
});

test("the banner offers to resume the last playlist when nothing plays", async ({ page }) => {
  await open(page, "fixture=banner&idle");
  const banner = card(page, "banner");
  await expect(banner).toContainText("Resume");
  await expect(banner).toContainText("Sunday Morning");
  await banner.locator(".pp").click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ entity_id: "media_player.living_room", media_content_id: "library://playlist/1", enqueue: "replace" }) }));
});

test("a tap on the banner opens the navigation path", async ({ page }) => {
  await open(page, "fixture=banner");
  await card(page, "banner").locator(".titles").click();
  expect(await page.evaluate(() => location.hash)).toBe("#music");
});

test("the shelf plays a recent album or playlist on the chosen speaker", async ({ page }) => {
  await open(page, "fixture=shelf");
  const shelf = card(page, "shelfcard");
  await expect(shelf.locator(".cover")).toHaveCount(6);
  await shelf.locator(".cover", { hasText: "Evening Lights" }).click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "library://album/1", enqueue: "replace" }) }));
});

test("cards that share a library read all show it", async ({ page }) => {
  await open(page, "fixture=shelf&theme=both");
  await expect(page.locator("origami-music").nth(0).locator(".cover")).toHaveCount(6);
  await expect(page.locator("origami-music").nth(1).locator(".cover")).toHaveCount(6);
  await open(page, "fixture=library&theme=both");
  await expect(page.locator("origami-music").nth(1).locator(".pl")).toHaveCount(4);
});

test("the player shows the track, the group and the progress", async ({ page }) => {
  await open(page, "fixture=player");
  const player = card(page, "player");
  await expect(player).toContainText("Golden Hour");
  await expect(player).toContainText("Living room + Kitchen");
  await expect(player.locator(".dur")).toHaveText("3:34");
  await expect(player.locator(".vpct")).toHaveText("32%");
});

test("the player controls the speaker", async ({ page }) => {
  await open(page, "fixture=player");
  const player = card(page, "player");
  await player.locator('[data-c="next"]').click();
  await player.locator('[data-c="repeat"]').click();
  const done = await calls(page);
  expect(done).toContainEqual(expect.objectContaining({ service: "media_next_track" }));
  expect(done).toContainEqual(expect.objectContaining({ service: "repeat_set", data: { entity_id: "media_player.living_room", repeat: "one" } }));
});

test("dragging the volume sets it once the finger stops", async ({ page }) => {
  await open(page, "fixture=player");
  const vol = card(page, "player").locator(".vol");
  const box = await vol.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => calls(page)).toContainEqual(expect.objectContaining({ service: "volume_set",
    data: { entity_id: "media_player.living_room", volume_level: 0.5 } }));
});

test("a tap on a speaker chooses it", async ({ page }) => {
  await open(page, "fixture=speakers");
  await card(page, "speakers").locator(".spk", { hasText: "Bedroom" }).locator(".title").click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "select_option",
    data: { entity_id: "input_select.speaker", option: "media_player.bedroom_speaker" } }));
});

test("the checkbox adds a speaker to the group or takes it out", async ({ page }) => {
  await open(page, "fixture=speakers");
  const speakers = card(page, "speakers");
  await expect(speakers.locator('.spk[data-p="media_player.living_room"] .badge')).toHaveCount(1);
  await speakers.locator(".spk", { hasText: "Bedroom" }).locator(".chk").click();
  await speakers.locator(".spk", { hasText: "Kitchen" }).locator(".chk").click();
  const done = await calls(page);
  expect(done).toContainEqual(expect.objectContaining({ service: "join",
    data: { entity_id: "media_player.living_room", group_members: ["media_player.bedroom"] } }));
  expect(done).toContainEqual(expect.objectContaining({ service: "unjoin", data: { entity_id: "media_player.kitchen" } }));
  await expect(speakers.locator(".spk.off .chk")).toBeHidden();
});

test("the queue shows the tracks after the current one", async ({ page }) => {
  await open(page, "fixture=queue");
  const queue = card(page, "queue");
  await expect(queue.locator(".row")).toHaveCount(4);
  await expect(queue).toContainText("5 tracks");
  await expect(queue).not.toContainText("Golden Hour");
  await queue.locator(".row", { hasText: "Paper Boats" }).click();
  expect(await ws(page, "bubble_card_tools/ma_queue_command")).toContainEqual(expect.objectContaining({ command: "play_index", index: 2 }));
});

test("the library shows recent playlists and albums, categories and search", async ({ page }) => {
  await open(page, "fixture=library");
  const library = card(page, "library");
  await expect(library.locator(".pl")).toHaveCount(4);
  await expect(library.locator(".albums .row")).toHaveCount(6);
  await library.locator('.cat[data-cat="albums"]').click();
  await expect(library.locator(".back")).toContainText("Albums");
  await library.locator(".search input").fill("lanterns");
  await expect.poll(() => ws(page, "media_player/search_media")).toContainEqual(expect.objectContaining({ search_query: "lanterns" }));
  await expect(library.locator(".section").first()).toHaveText("Artists");
  await library.locator(".now").click();
  expect(await page.evaluate(() => location.hash)).toBe("#music");
});

test("the tabbed card shows the queue, the library and the search", async ({ page }) => {
  await open(page, "fixture=tabs");
  const tabs = page.locator("origami-music");
  await expect(tabs).toContainText("5 items up next");
  await tabs.locator('.tab[data-tab="browse"]').click();
  await expect(tabs.locator(".tile")).toHaveCount(7);
});

test("texts follow the language of Home Assistant", async ({ page }) => {
  await open(page, "fixture=speakers&lang=fr");
  await expect(card(page, "speakers")).toContainText("cocher pour écouter partout");
  await expect(card(page, "speakers")).toContainText("Avec Living room");
});

test("an error from Home Assistant shows on the card", async ({ page }) => {
  await open(page, "fixture=library&error=Unauthorized");
  await expect(card(page, "library")).toContainText("Error: Unauthorized");
});

test("a search result plays next, right after the current track", async ({ page }) => {
  await open(page, "fixture=library");
  const library = card(page, "library");
  await library.locator(".search input").fill("golden");
  await library.locator('.act[data-act="next"][data-id="library://track/100"]').click();
  expect(await page.evaluate(() => window.calls)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "library://track/100", enqueue: "next" }) }));
  await expect(library.locator(".toast")).toHaveText("Will play next on Living room");
  await expect(library.locator(".toast")).toBeInViewport();
});

test("the library keeps its rows while a search loads", async ({ page }) => {
  await open(page, "fixture=library&slow");
  const library = card(page, "library");
  await expect(library.locator(".pl")).toHaveCount(4);
  await library.locator(".search input").fill("lanterns");
  await expect(library.locator(".libbody.busy")).toHaveCount(1);
  await expect(library.locator(".pl")).toHaveCount(4);
  await expect(library.locator(".section").first()).toHaveText("Artists");
  await expect(library.locator(".libbody.busy")).toHaveCount(0);
});

test("a solo speaker stays out of groups", async ({ page }) => {
  await open(page, "fixture=speakers&solo=media_player.bathroom");
  const speakers = card(page, "speakers");
  const bathroom = speakers.locator('.spk[data-p="media_player.bathroom"]');
  await expect(bathroom).toContainText("no groups");
  await bathroom.locator(".chk.na").click();
  await expect(speakers.locator(".toast")).toHaveText("Bathroom can't join a group");
  expect(await page.evaluate(() => window.calls.filter((c) => c.service === "join"))).toEqual([]);
});

test("every player of a group reports the same members, and the first one leads", async ({ page }) => {
  await open(page, "fixture=speakers");
  const speakers = card(page, "speakers");
  await expect(speakers.locator('.spk[data-p="media_player.living_room"] .badge ha-icon')).toHaveAttribute("icon", "mdi:crown");
  await expect(speakers.locator('.spk[data-p="media_player.kitchen"] .badge ha-icon')).toHaveAttribute("icon", "mdi:link-variant");
  await expect(speakers.locator('.spk[data-p="media_player.kitchen"]')).toContainText("With Living room");
});


test("the music pop-up opens on Home with the library, the charts and a mini player", async ({ page }) => {
  await open(page, "fixture=app");
  const app = card(page, "app");
  await expect(app.locator(".tab2.on")).toHaveText("Home");
  await expect(app.locator(".rtile")).toHaveCount(6);
  await expect(app.locator(".trow")).toHaveCount(5);
  await expect(app.locator(".radio")).toHaveCount(4);
  await expect(app.locator(".favs .cover")).toHaveCount(5);
  await expect(app.locator(".art2")).toHaveCount(4);
  await expect(app.locator(".resume .rcard")).toHaveCount(0);
  await expect(app.locator(".mini")).toContainText("Golden Hour");
  await expect(app.locator(".mini")).toContainText("The Lanterns · Living room + Kitchen");
  await app.locator(".mini .titles").click();
  expect(await page.evaluate(() => location.hash)).toBe("#player");
});

test("Resume plays the queue of a stopped speaker again, or the last playlist", async ({ page }) => {
  await open(page, "fixture=app&stopped");
  await card(page, "app").locator(".rcard", { hasText: "Golden Hour" }).click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "media_play", data: { entity_id: "media_player.living_room" } }));
  await open(page, "fixture=app&idle");
  await card(page, "app").locator(".rcard", { hasText: "Sunday Morning" }).click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "library://playlist/1", enqueue: "replace" }) }));
});

test("trending tracks show how they moved, and a tap plays the best match from Music Assistant", async ({ page }) => {
  await open(page, "fixture=app");
  const app = card(page, "app");
  const rows = app.locator(".trow");
  await expect(rows.nth(0)).toContainText("▲ 1");
  await expect(rows.nth(1)).toContainText("▼ 1");
  await expect(rows.nth(2)).toContainText("=");
  await expect(rows.nth(4)).toContainText("new");
  await expect(app.locator(".maj")).toHaveText("Updated today");
  await expect(app.locator(".tmore")).toHaveText("See the top 7");
  await app.locator(".tmore").click();
  await expect(rows).toHaveCount(7);
  await expect(app.locator(".tmore")).toHaveText("See less");
  await app.locator(".tmore").click();
  await expect(rows).toHaveCount(5);
  await rows.nth(0).click();
  await expect.poll(() => calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "spotify://track/neon", enqueue: "play" }) }));
  expect(await ws(page, "call_service")).toContainEqual(expect.objectContaining({ service: "search",
    service_data: expect.objectContaining({ name: "Kite Club Neon Avenue" }) }));
  await app.locator('.zone[data-zone="World"]').click();
  await expect(rows).toHaveCount(3);
  await expect(app.locator(".tmore")).toHaveCount(0);
  await expect(rows.nth(0)).toContainText("Static");
  // A "(feat. ...)" on one side only still finds the track, over a first result with another title
  await rows.nth(1).locator(".nextb").click();
  await expect.poll(() => calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "spotify://track/bloom", enqueue: "next" }) }));
});

test("the heart adds the playing track to the favorites", async ({ page }) => {
  await open(page, "fixture=app");
  const heart = card(page, "app").locator(".mini .heart");
  await expect(heart).not.toHaveClass(/on/);
  await heart.click();
  expect(await ws(page, "bubble_card_tools/ma_favorite_set")).toContainEqual(expect.objectContaining({ uri: "library://track/100", favorite: true }));
  await expect(card(page, "app").locator(".mini .heart")).toHaveClass(/on/);
  await expect(card(page, "app").locator(".toast")).toHaveText("Added to your favorites");
});

test("a radio and a liked song play in one tap", async ({ page }) => {
  await open(page, "fixture=app");
  const app = card(page, "app");
  await app.locator(".radio", { hasText: "Harbour FM" }).click();
  await app.locator(".favs .cover", { hasText: "Paper Boats" }).click();
  const done = await calls(page);
  expect(done).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "library://radio/2", enqueue: "replace" }) }));
  expect(done).toContainEqual(expect.objectContaining({ domain: "music_assistant", service: "play_media",
    data: { entity_id: "media_player.living_room", media_id: ["library://track/102", "library://track/103", "library://track/104", "library://track/105"], enqueue: "replace" } }));
});

test("the search tab keeps the recent searches on this device", async ({ page }) => {
  await open(page, "fixture=app");
  const app = card(page, "app");
  await app.locator('.tab2[data-tab="search"]').click();
  await expect(app.locator(".cat2")).toHaveCount(6);
  await app.locator(".search input").fill("golden");
  await app.locator('.act[data-act="play"][data-id="library://track/100"]').click();
  await app.locator(".search input").fill("");
  await expect(app.locator(".lrow", { hasText: "Golden Hour" })).toHaveCount(1);
  await app.locator(".lrow .x").click();
  await expect(app.locator(".lrow")).toHaveCount(0);
});

test("the library tab filters the library and opens the liked songs with Play all", async ({ page }) => {
  await open(page, "fixture=app");
  const app = card(page, "app");
  await app.locator('.tab2[data-tab="lib"]').click();
  await expect(app.locator(".lrow").first()).toContainText("Liked songs");
  await app.locator('.chip[data-k="album"]').click();
  await expect(app.locator(".lrow").first()).toContainText("Evening Lights");
  await app.locator('.chip[data-k="album"]').click();
  await app.locator(".lrow", { hasText: "Liked songs" }).click();
  await expect(app.locator(".back")).toContainText("Liked songs");
  await app.locator(".playall").click();
  expect(await calls(page)).toContainEqual(expect.objectContaining({ service: "play_media",
    data: expect.objectContaining({ media_content_id: "builtin://playlist/all_favorite_tracks", enqueue: "replace" }) }));
  await app.locator(".back").click();
  await expect(app.locator(".chips")).toBeVisible();
});

test("the now playing pop-up shows the group and opens the speakers", async ({ page }) => {
  await open(page, "fixture=nowplaying");
  const now = card(page, "nowp");
  await expect(now).toContainText("Golden Hour");
  await expect(now.locator(".dev")).toHaveText("Living room + Kitchen");
  await expect(now.locator(".devn")).toHaveText("2 speakers");
  await now.locator(".dev").click();
  expect(await page.evaluate(() => location.hash)).toBe("#speakers");
  await now.locator(".heart").click();
  expect(await ws(page, "bubble_card_tools/ma_favorite_set")).toContainEqual(expect.objectContaining({ uri: "library://track/100", favorite: true }));
});

test("the music pop-up speaks French with a French Home Assistant", async ({ page }) => {
  await open(page, "fixture=app&lang=fr");
  const app = card(page, "app");
  await expect(app.locator(".tabs2")).toContainText("Accueil");
  await expect(app).toContainText("Tendances du moment");
  await expect(app.locator(".maj")).toHaveText("Mis à jour aujourd'hui");
});

test("the volume of a group moves every speaker of the group by the same step", async ({ page }) => {
  await open(page, "fixture=nowplaying");
  const vol = card(page, "nowp").locator(".vrow .vol");
  await expect(vol.locator(".vpct")).toContainText("Group · ");
  const box = await vol.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect.poll(async () => (await calls(page)).filter((c) => c.service === "volume_set").map((c) => c.data.entity_id).sort())
    .toEqual(["media_player.kitchen", "media_player.living_room"]);
  const set = Object.fromEntries((await calls(page)).filter((c) => c.service === "volume_set").map((c) => [c.data.entity_id, c.data.volume_level]));
  expect(set["media_player.living_room"] - set["media_player.kitchen"]).toBeCloseTo(0.07, 2);
});

test("the volume panel has presets and a slider for each speaker", async ({ page }) => {
  await open(page, "fixture=nowplaying");
  const now = card(page, "nowp");
  await expect(now.locator(".vpanel")).toBeHidden();
  await now.locator(".vmore").click();
  await expect(now.locator(".mvol")).toHaveCount(2);
  await expect(now.locator(".mvol").first()).toContainText("Living room");
  await now.locator(".preset", { hasText: "Medium" }).click();
  const done = await calls(page);
  for (const entity_id of ["media_player.living_room", "media_player.kitchen"]) {
    expect(done).toContainEqual(expect.objectContaining({ service: "volume_set", data: { entity_id, volume_level: 0.3 } }));
  }
});

test("also play on adds a speaker to the group, takes one out, adds them all or splits the group", async ({ page }) => {
  await open(page, "fixture=group");
  const group = card(page, "group");
  await expect(group.locator(".gchip.on")).toHaveText("Kitchen");
  await expect(group.locator('.gchip[data-p="media_player.office"]')).toHaveClass(/na/);
  await group.locator(".gchip", { hasText: "Bedroom" }).click();
  await group.locator(".gchip", { hasText: "Kitchen" }).click();
  await group.locator('.gchip[data-g="all"]').click();
  await group.locator('[data-g="split"]').click();
  await group.locator(".gchip", { hasText: "Office" }).click();
  const done = (await calls(page)).filter((c) => ["join", "unjoin"].includes(c.service)).map((c) => [c.service, c.data]);
  expect(done).toEqual([
    ["join", { entity_id: "media_player.living_room", group_members: ["media_player.bedroom"] }],
    ["unjoin", { entity_id: "media_player.kitchen" }],
    ["join", { entity_id: "media_player.living_room", group_members: ["media_player.bedroom", "media_player.bathroom"] }],
    ["unjoin", { entity_id: ["media_player.kitchen"] }],
  ]);
  await expect(group.locator(".toast")).toHaveText("Office · Offline");
});

test("a solo speaker is left out of also play on", async ({ page }) => {
  await open(page, "fixture=group&solo=media_player.bathroom");
  const group = card(page, "group");
  await group.locator('.gchip[data-g="all"]').click();
  expect((await calls(page)).filter((c) => c.service === "join").map((c) => c.data.group_members)).toEqual([["media_player.bedroom"]]);
  await group.locator(".gchip", { hasText: "Bathroom" }).click();
  await expect(group.locator(".toast")).toHaveText("Bathroom can't join a group");
  await expect(group.locator(".ghint")).toBeHidden();
  await open(page, "fixture=group&solo=media_player.living_room");
  await expect(card(page, "group").locator(".ghint")).toHaveText("Living room plays alone, so no group is possible");
});
