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
