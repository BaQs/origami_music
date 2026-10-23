<img alt="The banner and the shelf of Origami Music in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_music/main/images/hero.png">

Origami Music brings Music Assistant to a dashboard, in the style of [Origami](https://github.com/hazymorning/origami). On the home view, a banner shows what plays and a shelf holds the albums and playlists played last. In a pop-up, a player, the speakers with their groups, the queue and a library with search, or a music pop-up that works like Spotify: home, search and library tabs, trending charts, radio and liked songs, with a mini player that opens the full player.

## Installation

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=BaQs&repository=origami_music&category=plugin)

Download Origami Music in HACS. If HACS asks you to add the repository, select **Add**. HACS adds the card to the dashboard resources. You need Home Assistant 2026.9 or newer with the [Music Assistant](https://www.home-assistant.io/integrations/music_assistant/) integration. The queue and the favorites also need [Bubble Card Tools](https://github.com/Clooos/Bubble-Card-Tools).

<details>
<summary><b>Manual installation</b></summary>

<br>

Download `origami-music.js` from the [latest release](https://github.com/BaQs/origami_music/releases/latest) into `config/www/` and add `/local/origami-music.js?v=0.8.0` as a JavaScript module in **Settings** > **Dashboards** > **Resources**. Change the version after each update, otherwise your browser keeps using the old file.

</details>

## Usage

```yaml
type: custom:origami-music
layout: banner
entity: media_player.living_room
navigation_path: "#music"
```

The banner shows the track that plays on a Music Assistant player, or offers to resume the last playlist. Tapping it opens `navigation_path`, for example a [Bubble Card](https://github.com/Clooos/Bubble-Card) pop-up with the player, the speakers and the queue.

<img alt="The player, the speakers and the queue in a pop-up, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_music/main/images/popup.png">

<details>
<summary><b>Layouts</b></summary>

<br>

| Layout | Shows |
| --- | --- |
| `banner` | What plays, with play and next, or the last playlist or album to resume |
| `shelf` | The albums and playlists played last. A tap plays one. |
| `player` | The track, the group, the progress, shuffle, repeat and the volume |
| `speakers` | Every speaker with what it plays and its volume. A tap chooses it, the checkbox groups it with the chosen speaker. |
| `queue` | The tracks after the current one. A tap plays one. |
| `library` | Search, categories, and the playlists and albums played last. Each result plays now or right after the current track. |
| `app` | The music pop-up with home, search and library tabs and a mini player. See Music pop-up. |
| `nowplaying` | The full player: big cover, heart, controls, the speakers of the group and the volume of the group, which unfolds into presets and a slider for each speaker |
| `group` | Also play on: a tap adds a speaker to the group of the chosen speaker or takes it out, with All and Ungroup |
| none | The tabbed card: queue, library and search in one card |

</details>

<details>
<summary><b>Choosing a speaker</b></summary>

<br>

With `entity`, a card follows one Music Assistant player. To follow the speaker chosen on the dashboard instead, keep it in an `input_select` and list the speakers in `players`, each with its Music Assistant player. The speakers layout writes the choice into the `input_select`, and every card with the same `select` follows it.

```yaml
select: input_select.speaker
players:
  media_player.living_room_speaker: media_player.living_room
  media_player.kitchen_speaker: media_player.kitchen
names:
  media_player.living_room_speaker: Living room
  media_player.kitchen_speaker: Kitchen
```

The entities in `players` can be the Music Assistant players themselves. The checkbox of a speaker calls `media_player.join` with the chosen speaker as the leader, and `media_player.unjoin` to take it out again. A crown marks the leader and a link its members.

</details>

<details>
<summary><b>Pop-ups</b></summary>

<br>

The player pop-up of the screenshot. The YAML anchor writes the speakers once; in the visual editor, repeat `select` and `players` in each card.

```yaml
type: vertical-stack
cards:
  - type: custom:bubble-card
    card_type: pop-up
    hash: "#music"
    name: Music
  - &music
    type: custom:origami-music
    layout: player
    select: input_select.speaker
    players:
      media_player.living_room_speaker: media_player.living_room
      media_player.kitchen_speaker: media_player.kitchen
  - <<: *music
    layout: speakers
  - <<: *music
    layout: queue
    limit: 4
  - <<: *music
    layout: shelf
    size: s
    title: Recently played
    link:
      text: Library ›
      path: "#library"
```

The library in its own pop-up, with a chip back to the player:

<img alt="The library in a pop-up, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_music/main/images/library.png">

```yaml
type: custom:origami-music
layout: library
back_path: "#music"
entity: media_player.living_room
```

</details>

<details>
<summary><b>Music pop-up</b></summary>

<br>

The `app` layout puts the music in one pop-up, with the navigation of Spotify:

| Tab | Shows |
| --- | --- |
| Home | Resume the queue of the chosen speaker when it is stopped, recently played, trending charts, radio, liked songs and artists |
| Search | Recent searches on this device, browse tiles, and results that play now or next |
| Library | Filters, sort, liked songs pinned on top, and playlist, album and artist pages with Play all |

A mini player stays at the bottom. A tap opens `player_path`, the heart likes the track and the button plays or pauses. The `nowplaying` layout is the full player for that pop-up, and its speakers chip opens `speakers_path`. In a group, its volume moves every speaker by the same step, as the group volume of Music Assistant does, and the arrow next to it shows Quiet, Medium and Loud presets and a slider for each speaker. The `group` layout goes below it.

<img alt="The music pop-up and the now playing pop-up, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_music/main/images/app.png">

<img alt="The now playing pop-up with also play on and the queue, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_music/main/images/now-playing.png">

```yaml
type: custom:origami-music
layout: app
select: input_select.speaker
players:
  media_player.living_room_speaker: media_player.living_room
player_path: "#now-playing"
speakers_path: "#speakers"
trends:
  France: sensor.charts_france
  World: sensor.charts_world
```

The radio row shows the radio stations that are favorites in Music Assistant, and the heart next to a radio in the search adds it. Liked songs are the favorite tracks, from the built-in playlist of Music Assistant. The full example with the three pop-ups is in `examples/music-popup.yaml`.

</details>

<details>
<summary><b>Trending charts</b></summary>

<br>

The charts come from sensors. A chart sensor has the date of the chart as its state, and two attributes: `tracks`, a list of `{ id, title, artist, image }` in chart order, and `previous`, the ids of the chart before, for the arrows. A tap on a track searches for "artist title" in Music Assistant and plays the best match.

This example reads the "Top France" playlist of Deezer, which needs no account, every 3 hours. "Top Worldwide" is the playlist `3155776842`. The `rest_command` integration only loads when Home Assistant starts.

```yaml
rest_command:
  deezer_chart:
    url: "https://api.deezer.com/playlist/{{ playlist }}/tracks?limit=50"
    method: get

template:
  - triggers:
      - trigger: time_pattern
        hours: "/3"
      - trigger: homeassistant
        event: start
    actions:
      - action: rest_command.deezer_chart
        data:
          playlist: "1109890291"
        response_variable: chart
        continue_on_error: true
      - variables:
          ok: "{{ chart is defined and chart.status == 200 and (chart.content.data | default([]) | count) > 0 }}"
    sensor:
      - name: Charts France
        unique_id: charts_france
        device_class: timestamp
        state: >
          {{ ((chart.content.data | map(attribute='time_add') | max) | as_datetime).isoformat() if ok else this.state }}
        attributes:
          tracks: >
            {% if ok %}{% set ns = namespace(l=[]) %}
            {% for t in chart.content.data[:20] %}{% set ns.l = ns.l + [{'id': t.id, 'title': t.title_short, 'artist': t.artist.name, 'image': t.album.cover_medium}] %}{% endfor %}
            {{ ns.l }}{% else %}{{ this.attributes.tracks | default([]) }}{% endif %}
          ids: "{{ chart.content.data | map(attribute='id') | list if ok else this.attributes.ids | default([]) }}"
          previous: >
            {% set old = this.attributes.ids | default([]) %}
            {% set new = chart.content.data | map(attribute='id') | list if ok else old %}
            {{ old if old and old != new else this.attributes.previous | default([]) }}
```

</details>

<details>
<summary><b>Options</b></summary>

<br>

| Option | Default | Description |
| --- | --- | --- |
| `layout` | | See Layouts. Without it, the tabbed card. |
| `entity` | | The Music Assistant player to follow, when there is no `select` |
| `select` | | An `input_select` that holds the chosen speaker |
| `players` | | The speakers of the `input_select`, each with its Music Assistant player |
| `names` | | Short names for the speakers |
| `solo` | | Speakers that cannot play in a group, such as an old Chromecast built-in. Their checkbox is turned off. |
| `navigation_path` | | Opened by a tap on the banner |
| `speaker` | `true` | The banner shows the name of the speaker |
| `limit` | `10` | The number of tracks in the queue, or of albums and playlists on the shelf |
| `recent` | `[playlist, album]` | What the shelf and the banner show, from `playlist`, `album`, `artist`, `track` and `radio` |
| `title`, `link`, `size` | | The shelf's heading, a link next to it as `{ text, path }`, and `s` for smaller covers |
| `back_path` | | The library's chip back to the player |
| `trends` | | `app`: chart sensors by zone, such as `{ France: sensor.charts_france }`. The keys name the chips. |
| `player_path`, `speakers_path` | | `app`, `nowplaying`: opened by the mini player and by the speakers chip |
| `ma_path` | | `app`: a link to Music Assistant at the end of the library |
| `presets` | `[0.15, 0.3, 0.5]` | `nowplaying`: the volumes of the Quiet, Medium and Loud presets |
| `config_entry_id` | | The Music Assistant entry, when there is more than one |

</details>

<details>
<summary><b>How it works</b></summary>

<br>

The banner, the shelf and the library read the albums and playlists played last with the `music_assistant.get_library` action, once every 10 minutes for all the cards of a page. The library and the search use the media browser of Home Assistant. The queue comes from Bubble Card Tools, which reads the Music Assistant queue and also signs cover images, so that an http image shows on an https dashboard. Every player of a Music Assistant group reports the same members, and the first one leads the group. The heart reads and sets favorites with Bubble Card Tools, which adds an item to the Music Assistant library when needed. The texts follow the language of Home Assistant, in English or French.

</details>

<sub>The screenshots use the Origami theme with made-up data.</sub>

<sub>AI is used as a tool in this project.</sub>
