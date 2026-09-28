# Detour

A minimalist, fully-offline browser remake of a Quoridor-style tactical race game. *Don't be mad.*

Two pawns start on opposite rows of a 9×9 board. Each turn you either **move** one step or **place a wall** to lengthen your opponent's route. First pawn to reach the far side wins. Walls can slow an opponent but can never fully trap them — every placement must leave both players a path home.

The board doesn't have to be 9×9 — or even square. In **Race** both pawns line up on the *same* side and run for the same finish line, and in **King of the hill** there's no finish line at all: a single square in the dead centre of the board decides it. All of them are modifiers, so they work in every mode below.

## Run it

No build, no server, no dependencies. Open `index.html` in a browser (double-click works, `file://` is supported).

## Modes

- **vs Bot** — a full screen with the three opponents side by side (your win/loss record against each one under its name), the game settings, and one **Play** button:
  - *Easy* — moves at random.
  - *Medium* — races forward, walls when it slips behind.
  - *Hard* — an expert engine built along the same lines as a modern chess engine: principal variation search with alpha-beta, a transposition table, null-move and futility pruning, iterative deepening (a ~0.7s budget per move), and an exactly solved endgame once both players run out of walls. It walls for tempo, races to close out a won position, and plays the ending perfectly — it will comfortably beat the easier bots and most humans.
- **Freeplay** — two players, one device (hotseat).
- **Tournament** (local) — round-robin: add named players, everyone plays everyone in pass-and-play, with a leaderboard between matches (win 3 pts, draw 1).
- **Play with a Friend** — online 1v1 over a room code (needs internet).
- **Random Match** — online 1v1 with no code: you're auto-paired with anyone else looking for a game right now (needs internet).
- **Tournament** (online) — host a room, friends join by code; everyone plays everyone and whoever isn't in the current match watches it live (needs internet).

The bot, freeplay, and local-tournament modes are fully offline.

### Your name & game settings

The menu has a **name** field (defaults to `Player-XXXX`, a random persisted suffix, so two people rarely collide — it's the name shown in online tournaments).

**Game settings live wherever you set up a game** — never in the menu — so it's always obvious which game they apply to. The same controls appear on the bot screen, the Freeplay setup, the local-tournament card, the **create** side of a friend room, and the online-tournament lobby (host only).

Every one of them opens on a **Standard / Custom** switch:

- **Standard** is the normal game and is held there — a 9×9 board, walls of 2, every modifier off. You can still set the clock, the bonus and the wall count, and nothing else can drift.
- **Custom** unfolds the board sizes and the modifier list. On a **wide landscape** screen they open as a panel **beside** the base settings rather than as a dropdown below them — there is room sideways and none downwards, and a modified game is exactly when you want every switch visible at once. Portrait screens and phones keep the dropdown, where stacking is the only thing that fits.

The two exist so a room can say what it is. A created room is labelled **Standard game** or **Custom game** with its settings spelled out, and a joiner is shown the same label before they commit — nobody drops into a 15×6 inverted debris match expecting Detour. The split is judged on what the settings *are*, not on the label that came with them, so a "standard" room really is one. Flipping to Standard parks your custom board rather than deleting it: switch back and it's still there.

The base controls:

- **Clock** — minutes per player (default 10; `0` turns the clock off).
- **Bonus** — seconds added to your clock after each move (default 5).
- **Walls** — walls per player (default 10).

…plus a **Modifiers** dropdown that changes the rules themselves (all combinable, and the bot adapts to every one). Incompatible modifiers switch each other off automatically:

- **Board width / height** — two separate inputs, each **5** to **15** (default 9×9), so the board needn't be square: play a wide **15×6** sprint or a long **6×15** marathon. The engine, the bot, the move notation, the coordinate strips, and the layout all follow both sides independently. *(4 players keeps the two locked together — see below.)*
- **Wall length** — how many cells a placed wall spans, from **1** to **the shorter side − 1** (default 2). Shrinking the board pulls this back down to fit.
- **King of the hill** — the goal stops being an edge and becomes **one cell, dead centre**. Everyone keeps their usual start and races that single square; first pawn to stand on it wins, and reaching the far side now does nothing. It changes the shape of the game completely: there's one chokepoint instead of a whole row of them, so a wall near the middle bites far harder than one out on a flank — though it can never seal the hill off, since every player must keep a route to it. A single centre cell only exists on an odd board, so this **rounds both sides down to odd** (5, 7, 9, 11, 13, 15) and the +/− steppers move two at a time. The hill is drawn as a neutral ringed target, and the status bar shows **Hill**. Combines with **Race** (both pawns from the same side, still exactly equidistant) and with **4 players** (all four edges racing one centre — the fairest free-for-all on offer). *(Not combinable with Inverted.)*
- **Race** — both pawns start on the **bottom row**, in their own lanes either side of the middle, and race to the **same top row**. Equal distance, no head-on jumping duel, and every wall cuts both ways: block the lane next to yours and you may well be blocking your own. The finish line is drawn in neutral gray because it belongs to nobody, the board **isn't flipped** for the second player (you both already run upward — each of you keeps your own colour), and the status bar shows **Race**. *(Not combinable with Inverted or 4 players.)*
- **Debris** — the board starts with **2–6 neutral (grey) length-2 walls** scattered at random, for a fresh puzzle every game; they never fully trap either player. In friend games the host rolls them and ships them to the guest so both sides start from an identical board.
- **Random wall orientation** — you don't choose horizontal/vertical; each wall's orientation is rolled when you pick it up, and the Rotate button is hidden.
- **Inverted** — misère mode: reaching your goal row makes you **lose**. To stop anyone stalling, when you move you must step **strictly closer** to your goal — though you may place a wall instead, which is how you lengthen your own forced route or shorten the gap on your opponent. The status bar shows **Inverted** and only your forced-forward squares light up. *(Not combinable with Race, King of the hill — which has no edge to flee along — or 4 players.)*
- **4 players** — a free-for-all on a bigger board. Four opposing edges only race fairly if they match, so this one **squares the board off** (change either side and the other follows) and then grows the play area to **(N+2)×(N+2) with the four corner cells cut out** (an octagon), and four pawns — **Bottom / Left / Top / Right** — start at the middle of each outer edge and race to the opposite one. Turns go **clockwise**; first pawn home wins; a wall must leave *all four* players a route. Play it **local** (Freeplay with four people pass-and-play, or vs Bot as you against three bots) or **online**: with the modifier on, **Play with a Friend → Create a room** opens a 4-player room — exactly **four people** join by code (everyone needs the modifier on), the host starts, and the host's browser runs the authoritative board and relays it to the others. The clock is off in 4-player, and it's not combinable with Race or Inverted.

Your choices persist and stay in sync across every setup surface. Settings saved before the Standard/Custom split are filed as **Custom** if they were already modified, so nothing you had set up is wiped by the upgrade. When you **join a friend's room** you don't set them — the **host's** apply, and you see them in full before the board appears. When you **join an online tournament** the host's settings show **read-only in the lobby** (updating live if the host tweaks them) so you know the clock and wall count before the bracket starts and locks them in. Each player has a chess clock shown in their rail; running out of time loses the game (or the match, in a tournament).

### Online tournament (host-as-hub)

No game server: the **host's browser is the hub**. Other players connect to it over WebRTC (PeerJS signaling), the host owns the bracket and the authoritative boards, and it relays every game as a state snapshot.

- **Games run continuously.** The **host only clicks Start once.** Every pairing is queued, and a match **launches the moment both its players are free** — so several games run at the same time (up to `floor(players / 2)` early on) and each one starts as soon as its two players have finished their previous game. Nobody waits on the host between matches.
- **A 5-second cooldown between your matches.** When your game ends you're dropped back to the ranking for a short breather — the **Watch buttons hide** during it — then your next match starts automatically (or the Watch buttons return if you're waiting on an opponent).
- **Not playing right now? You see the ranking page.** It lists every game in progress; tap **Watch** to spectate any of them and **Back** to return to the ranking. When your own match starts you're taken straight to your board (**Resume** from the ranking if you step away).
- **Chat.** The lobby and ranking pages have a tournament-wide chat (the host relays every message to everyone), and **each game in progress has its own in-game chat** for that game's two players and its spectators.
- **Kick.** The host can remove a player with the ✕ on their row — in the lobby, or mid-tournament (a kicked player is auto-forfeited from their remaining games, same as a disconnect).
- **The host must stay connected** — if the host leaves, the tournament ends for everyone (no host migration).
- A player who **resigns** concedes their current game but stays in; a player who **disconnects** is auto-forfeited from their remaining games so the bracket keeps moving.
- **Who starts is random** each game (no fixed first-move advantage), decided by the host.
- Needs internet (the PeerJS broker). Connections use several STUN servers plus a **TURN** relay so peers behind strict/symmetric NATs can still connect; if a connection still can't be made within ~30s the player gets a clear "couldn't connect" message instead of a silent hang. **Phones on cellular data almost always need TURN**, and the public fallback relay can be rate-limited or flaky. For reliable, still-free mobile play, paste your own **metered.ca** free-tier credentials into the config block at the top of `net.js` (`METERED_SUBDOMAIN` / `METERED_API_KEY`) — the browser then fetches fresh TURN credentials at connect time; see **Free TURN setup** below. A truly offline LAN tournament still needs a local hub server.

### Free TURN setup (fixes phone joining, no backend, no cost)

TURN is the relay that carries traffic when two peers can't reach each other directly — which is the normal case on cellular. The site stays a static GitHub Pages app; only the relay is external.

1. Create a free account at [metered.ca](https://www.metered.ca/) (free tier is ~50 GB/month — plenty for casual play).
2. In the dashboard, find your **app subdomain** (e.g. `yourapp.metered.live`) and your **API key**.
3. Open `net.js` and fill in the two constants near the top:
   ```js
   const METERED_SUBDOMAIN = 'yourapp';   // → yourapp.metered.live
   const METERED_API_KEY   = 'your-key';
   ```
4. Commit and push. That's it — when someone opens an online screen the browser fetches fresh TURN credentials and uses them; if the fetch fails it falls back to the public servers.

Notes: the API key lives in client-side JS, so it's **public** — that's unavoidable for a backend-less static site, and the metered key only authorizes TURN-credential requests against your (rate-limited, free) quota. Alternatives if you'd rather: **Cloudflare**'s TURN service (generous free allotment), or self-hosting **coturn** on an always-free cloud VM (e.g. Oracle Cloud Always Free) and putting that server's static credentials into `FALLBACK_TURN`.

## Online play

"Play with a Friend" connects two browsers peer-to-peer over WebRTC. One player **creates a room** and shares the 4-character code; the other **joins** with it. Once you create a room the join field disappears (you're the host now, waiting on an opponent — same flow as hosting a tournament), and the code is captioned with the game you're offering.

**Nobody is dropped into a game sight unseen.** Connecting is not the same as starting: the host builds its board (rolling any Debris walls) and *offers* it, and the joiner gets a card naming their opponent, whether it's a **Standard** or **Custom** game, and the clock, walls, board and every modifier that's on. **Play** starts it on both sides at once; **Not this one** backs out, and the host keeps its room and waits for the next person instead of being stranded. The same card appears for a **Random match**, where you have even less idea what you've been paired into. While it's open the host's status names whoever is looking. There is no game server: both browsers run the same rules and exchange only the action taken each turn (deterministic lockstep), so they stay in sync. When a game ends, a **rematch needs both players** — pressing Rematch sends the other player a request to accept or decline; if both press Rematch, you go straight into the next game. A friend match also has an **in-game chat** in the side panel so the two of you can talk during the game.

- Signaling uses the free public **PeerJS** broker, lazy-loaded from a CDN only when you open the online screen — the offline modes never touch the network.
- Each player sees themselves as **blue at the bottom** and the opponent as **orange at the top**; the board is rotated 180° for the guest so both play "upward." **Who moves first is random** (the host rolls it and shares it, for the first game and every rematch), so hosting carries no advantage.
- Online games show a **Forfeit** flag (turns red on hover) instead of Restart — forfeiting hands the win to your opponent.
- Connections use STUN plus a free public **TURN** relay (Open Relay) so peers behind strict/symmetric NATs can still connect; if a connection can't be made within ~20s you get a clear "couldn't connect" message instead of a silent hang. For heavy use, swap in your own TURN credentials in `net.js` (`PEER_OPTS`).

### Random match (no code, no backend)

**Random Match** pairs you with anyone else who's searching, without a room code. There's still no server: the matchmaking reuses the **PeerJS broker as a rendezvous**. One well-known "lobby" peer id holds at most one waiting player — so when you search, you either **connect to whoever's waiting** (and you're paired) or, if nobody is, you **become the waiter** yourself. On a match the waiter opens an ordinary private 1v1 room, hands its code to the joiner over the lobby channel, and immediately **releases the lobby** so the next pair can form. From that point it's a normal friend game (same lockstep, chat, and rematch), so a random opponent can rematch you too. Tap **Cancel** to stop searching. Because the lobby id is global to the deployed site, you're matched with anyone online anywhere — which also means with a tiny player base you may simply wait until a second person is searching.

## Menu

**The menu is the board.** Not a list of buttons over a picture of one: a real grid, built from the same cell/gap tracks the game uses, with every mode standing on cells and walls sitting in the gaps between them — so the first thing you see is the thing you are about to play.

It is a 9×5 board. **Play vs Computer** takes a 4×2 block in the accent, the one thing you came here to do. Everything else is a tile on the squares beside it — two players, tournament, play a friend, **quick join** (a code box you type straight into, no screen in between), random match, online tournament, and **game history**, which carries its own count and how the last game went. Modes that don't exist yet are drawn as **bare board**: same fill as an empty cell, no edge, because a square with nothing standing on it is exactly what they are.

Placement lives on each tile as `data-at="row,col,rowSpan,colSpan"`; the script turns cell coordinates into grid lines (cell *c* occupies track `2c-1`, and the gap after it is track `2c`, which is the whole of the arithmetic) and paints the empty cells and walls behind them. Below 820px a nine-column board stops being readable long before the screen runs out, so the tiles become a plain stack and the cells and walls step aside.

Your name and the way into **Appearance** sit in the header, the one-line explanation of the rules and "How to play" underneath.

## Controls

- **Move**: legal destinations highlight; **click one, or drag your pawn onto it** (the pawn is a pick-up-able 3D piece).
- **Walls**: your remaining walls sit in the tray under the board (the opponent's count is shown above it). Pick orientation with **Rotate** (or press **Space**), then place a wall either way — **drag one onto a board junction**, or **click one to take it in hand and click a junction to put it down**. A held wall lifts out of the rail, the board's junctions light up, and **Space** still rotates it while you hold it; **Esc**, clicking the wall again, or clicking anywhere else on the board puts it back. A preview shows it in your colour if legal, red if not; clicking an illegal junction keeps the wall in hand rather than dropping it. Illegal placements (overlaps, crosses, or fully trapping a player) are rejected. In pass-and-play (Freeplay / local Tournament) the second player gets **their own Rotate button** on the top rail, so each side can set wall orientation from their own end.
- Jump a face-to-face opponent in a straight line; if a wall is behind them, side-step around instead.

Each player has 10 walls, drawn down from the tray as you place them.

The match controls (in the side rail next to the board, or below it on phones) depend on the mode: **Restart** (↺) in freeplay only; **Resign** (⚑, red on hover) and **Draw** (½) in friend games and in local/online tournaments; bot games have neither (use **Back** to leave, then Rematch from the result card to replay). **Resign and Draw ask for confirmation first** so you can't trigger them by accident. Draw then asks the other player to agree — face-to-face for hotseat, or as an offer the opponent accepts/declines over the network (online tournaments route it through the host).

If a network game loses its connection — including the silent kind (a phone changing networks or going to sleep) — a **Connection lost** popup appears instead of leaving you stuck: peers exchange a heartbeat, so a connection that goes quiet for ~20s is treated as dropped.

## On-screen layout & the move list

On wide screens the board sits in the centre with the **player info down the left** (opponent on top, you on the bottom — name, walls left, and clock), the **Resign / Draw / Restart** controls just under your card, and a **scrolling move list down the right**, chess.com-style. On phones it all stacks instead: opponent, board, you, then the move list — and the **action rail moves up into the header**, beside the "Your turn" text, because a row of buttons under the board costs the scarcest thing on a phone and beside the status it costs nothing. The desktop layout places that rail by grid area inside the play grid, so the element is physically moved between the two rather than reordered by CSS. The wall tray always travels with your own info, so it stays to hand. Nothing on the board page is text-selectable, so dragging a wall across the coordinates and rail labels never leaves a smear of highlighted text behind the gesture — the chat log and its input stay selectable. **Rank numbers and file letters frame the board** — one letter per column, one number per row, so a non-square board gets the right count on each strip — oriented for whichever side you're on.

Every **online game has its own chat** below the move list — both in a **friend match** and in **each tournament game**. The two players and (in a tournament) anyone **spectating that game** share the same thread, so you can talk through the game as it happens. It's per-game: it shows the chat for whatever board you're currently watching, and it's separate from the tournament-wide chat on the lobby/ranking screens.

Squares are named like chess — files **a, b, c…** left to right (one per column), ranks **1** upward from the bottom (one per row), so a 9×9 board runs a–i and 1–9 and a 13×7 one runs a–m and 1–7. Player 0 starts on rank 1, like `e1`. A **pawn move** is written as its destination square (`e8`). Placing a **wall** — its own kind of move, which we simply call a *Wall* — is written as the wall's junction square plus its orientation, `h` or `v` (`e4h`). The notation is **absolute**: it never depends on which side you're on, so both players and every spectator read the exact same list even though the guest's board is flipped 180°. In the list your moves carry a marker in your colour and the opponent's in theirs, and walls show a small bar (laid flat or upright) in the placer's colour.

## Look & feel

The rule is **printed, not rendered**: the interface should read like a board printed in flat spot inks. There are no gradients anywhere, no gloss, and nothing pretends to be a physical object — separation is a 1px rule, a background step, or space. Corners are nearly square, because the board is made of squares and so is everything standing on it; the only round things left are the pawns, the move dots and the eval gauge, which are pieces rather than panels. The one texture on the page is a fixed film of paper grain.

### Appearance

Six axes, each independent of the others, on an **Appearance** screen reached from the menu. A real board sits beside the controls and changes as you pick — it is built by the same code the game uses, so the preview cannot drift from what you get.

- **Theme** — light, dark, or match your system.
- **Palette** — **Press** (vermilion against ink blue), **Dusk** (ochre against violet), **Signal** (magenta against cyan), **Moss** (rust against deep teal).
- **Corners** — square or rounded. One variable scale, so every panel, button and cell follows.
- **Pawns** — token, solid, ring, block.
- **Board** — cells, checker, flat, bare.
- **Sound** — on or off.

Each is an attribute on `<html>` that the stylesheet reads, and the whole set is stored in `detour_look`. An inline script in the `<head>` applies them **before the first paint**, so nobody sees a wrong frame and a correction.

#### Sound

`sfx.js`. Every other asset here is code — the background is canvas, the icon is inline SVG, there is no build step and `file://` has to work — so the sounds are code too: short envelopes over one or two oscillators and the odd burst of filtered noise. Nothing to download, nothing to cache, about four kilobytes.

A pawn gets a light tap; a wall gets the same tap an octave down with more wood behind it, so the two are told apart without looking. A wall that will not go where you dropped it says so, since nothing on screen changes to tell you. There is a result, and a blip for an incoming chat line.

The interface has two of its own — a **hover** and a **click** — and they are the quietest things in the set by a distance, because they fire far more often than anything else: a pawn moves fifty times a game, a pointer can cross fifty controls getting to it. Both are pitched well above the board's sounds, and a click (0.245 summed peak) sits deliberately under a pawn move (0.378), so a button can never be mistaken for a move or compete with one.

Three things keep them from becoming a nuisance, and each is the answer to a way it would have:

- **They only fire on real controls**, so they cannot double up with the board. A cell is a `div` and a wall in the tray is a `div`, so moving a pawn or placing a wall still makes exactly one sound — its own.
- **A hover never opens the audio context.** Moving a mouse is not a user gesture; asking for a context there hands back a suspended one and logs a warning on every visit, so hover stays silent until something real has opened it.
- **Sitting on a button is one hover, not a stream of them.** `pointerover`/`pointerout` are not enter/leave: they fire again for every boundary crossed *inside* a control, and a menu tile is a button wrapping three spans. Drifting a few pixels across one fired out-on-the-button — the pointer had moved to a child — then over-on-the-child, which replayed the sound without ever leaving the button. The test is `relatedTarget`, the element on the other side of the crossing: if it is inside the same control, nothing has been entered or left.
- **A touch is not a hover.** The gate is the pointer type that raised *this* event, not `matchMedia('(hover: hover)')` — a laptop with a touchscreen answers yes to that query and still sends touch events, and the query is evaluated once at load while the way you are pointing can change at any moment. Without it, `pointerover` firing just before every tap would make each press sound doubled.

Two rules keep them from wearing:

- **The board stays quiet while you are scrubbing.** Stepping through a review or a rewind replays dozens of positions a second, and a knock for each one is unbearable. The interface's own click still answers, because you pressed a button — and the arrow keys, which is how scrubbing is actually done at speed, raise no click at all.
- **The audio context is not created until you touch the page.** Browsers refuse to start audio before an interaction; asking on load gets a suspended context and a console warning on every visit.

There is one exception to the no-files rule, and it is the honest kind: a recorded voice is not something oscillators can fake, so the clip that plays on a **brilliant** move is a file in `assets/`. It goes through an `<audio>` element rather than the Web Audio graph, because decoding needs `fetch()` and `fetch()` of a local file is blocked from a `file://` page.

The whole set was lifted in level — it was too quiet to hear over anything else — and a limiter sits across the output. That is not an effect: at the new level two sounds landing on the same frame (your move, then a fast bot's reply) would sum past full scale and crackle, and the limiter is inaudible on any single sound, which is the only time it does nothing.

#### Menu music

`music.js`. Generated rather than played back, for the same reasons as the sounds: slow chords that change every eight bars, a sparse bell line over a minor pentatonic, everything under one low-pass so nothing catches the ear. It is scheduled a bar at a time, so leaving the page open for an hour accumulates nothing and stopping is immediate.

Its onset is quick on purpose. The first version faded the bus up over four seconds while each pad took two and a half to reach level, and those multiply: a second in you were hearing a fraction of a fraction, which on a menu is indistinguishable from nothing playing at all. It was measured rather than guessed — by capturing the scheduled gain automation, since `startRendering()` on an `OfflineAudioContext` never resolves under headless Chrome's virtual clock — and is now up within about a second.

It plays on the menu and the screens on the way to a game, and stops when a board appears — you are reading a position, and a bed of pads under that is noise. Which screens those are is decided in one place rather than per caller, so a screen cannot be added that forgets to stop it.

Drop an audio file at `assets/menu.mp3` and it is used instead, with the fade, the mute, the unlock and the stop-on-game unchanged. Nothing probes for it but an attempted load, because a HEAD request is not available from `file://` either.

Which makes one distinction load-bearing: **a refused autoplay is not a broken file.** The first request for music happens as the look is applied at load, before the page has been interacted with, so the browser rejects `play()` with `NotAllowedError`. Treating that as "there is no track here" marked a perfectly good mp3 dead for the rest of the session and left the generator playing over it. `NotAllowedError` now means *not yet* — the file is kept and retried on the first gesture — while the element's own `error` event, which is the real signal that a file is missing or undecodable, is what falls back to the generator. When the track does start, the generator is stopped, so the two can never overlap.

Light is **paper**: cream stock, dark ink, two spot colours, the way a board game is actually printed. Dark is the opposite idea rather than the same one dimmed — a cold blue-black ground with the inks turned up until they signal.

#### How a palette is built

Surfaces are generated, not listed. Each mode has a **neutral ramp** (`--n-bg` → `--n-surface-3` → `--n-line`, plus three ink tiers) chosen purely for contrast, and a palette supplies a `--tint` that is mixed into every step at a few percent:

```css
--surface: color-mix(in srgb, var(--tint) 7%, var(--n-surface));
```

So a palette is **six colours per mode**, not twenty, and no palette can quietly wreck the contrast the ramp was picked for. Player inks (`--me`, `--opp`), `--good` and `--danger` are supplied per palette; everything else falls out of the ramp. Green always means *correct* — Path's move, "best" in the verdict list, a win — and is never a player, so a green arrow can never be mistaken for a piece.

Contrast is checked rather than assumed: a headless pass reads the **computed** colours for all four palettes in both modes and holds 22 real foreground/background pairs to WCAG thresholds — 176 checks. (Computed `color-mix()` comes back as `color(srgb 0..1)` while a plain hex comes back as `rgb(0..255)`; parsing both the same way silently zeroes every luminance and makes the audit pass everything, which is how the first version of that check lied.)

### Type

Three voices, and each one has a job:

- **Bricolage Grotesque** — display. A grotesque drawn with its irregularities left in, which is where the page gets its character. The wordmark, screen titles, overlay headings.
- **Space Grotesk** — the interface. Everything you operate: labels, buttons, copy.
- **Space Mono** — the machine. Clocks, room codes, move notation, evaluations, accuracies: everything the game *measures* rather than says. It is what Space Grotesk was drawn from, so the two sit together without being introduced.

All three load from Google Fonts with a system fallback if you're offline. Numbers are tabular wherever they change in place, so clocks and evaluations don't jitter.

### Which way up the board sits

In networked games the board flips per player, so each of you sees yourself in the accent at the bottom. **Local games (freeplay and tournament) don't flip** — the board stays put, each player keeps a fixed side and colour, and the player to move drags walls from their own rail. **Race never flips either**, in any mode: both pawns already start at the bottom and run upward, so a flip would only put the finish line behind the second player — you tell yourselves apart by colour instead.

### Details

Pawns are **flat tokens** — solid ink with one darker ring pressed into it. They used to be shaded spheres with a specular highlight, the only thing on the board pretending to be a real object; everything else was printed, and now so are they.

Behind every screen, a low-contrast **canvas background** drifts a faint grid of junction marks and wall bars. It reads its colours out of the stylesheet rather than carrying its own, so it follows the theme switch and the system preference both; it pauses when the tab is hidden and honours reduced-motion. The lobby, setup, and standings screens share one **tournament card** (a separated header, then `rank · name#tag · score` rows). **Walls are coloured by who placed them**, and winning rows are tinted in the owner's colour with a flat edge bar.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: menu, game screen, tournament cards, overlays |
| `styles.css` | All styling; colors live in CSS custom properties on `:root` |
| `bg.js` | The drifting board behind every screen — junction marks + wall bars, in whichever theme is on (`#bg`) |
| `rules.js` | Pure game logic — state, moves, jumps, wall legality, path validation (`window.Rules`) |
| `bot.js` | Easy / medium AI, and hard for every modifier the engine doesn't cover (`window.Bot`) |
| `path/` | Everything belonging to the engine. `rules.js` is deliberately not in here: it is the game's rules, shared with the app |
| `path/engine.js` | The analysis engine for the standard game — bitboard-ish board, principal variation search with a transposition table, forward pruning, a solved endgame tablebase and the learned evaluation (`window.Engine`) |
| `path/netweights.js` | The trained evaluation's weights, as plain JS so a `file://` page can load them. Loaded before the engine; without it the engine falls back to the handcrafted evaluation |
| `path/engine-worker.js` | The search off the main thread. Its `importScripts` are relative to `path/`, so `rules.js` is one level up |
| `path/engine-classic.js` | A frozen copy of the handcrafted engine (`window.EngineClassic`), loaded by nothing. It exists so "stronger" always has something fixed to mean |
| `path/book.js` | Generated opening book, so known openings are labelled rather than graded |
| `tools/genbook.js` | Offline generator for `path/book.js` (not loaded by the page) |
| `net.js` | WebRTC transport via the PeerJS broker — 1v1 and host-as-hub (`window.Net`) |
| `app.js` | UI rendering, input, turn flow, online flow, persistence |
| `sfx.js` | The game's sounds, synthesised at runtime, plus the one sampled voice (`window.Sfx`) |
| `music.js` | The menu's music: generated, or a file from `assets/` if you supply one (`window.Music`) |
| `assets/` | The two things that are not code: the icon, and the clip that plays on a brilliant move |
| `favicon.svg` | Game icon — your route turning around the opponent's wall; flat, two inks, a palette per theme |

## Path — the engine

**Path** (`path/engine.js`) is a separate, much faster engine for the **standard game only** — two players, length-2 walls, opposite goal edges, any rectangular board. Every modifier (race, king of the hill, inverted, 4-player, debris, other wall lengths) still uses `bot.js`, and `Engine.supports(state)` is what decides which one runs.

It is built the way Stockfish is built, because the problems are the same ones: a tree too large to enumerate, an evaluation too cheap to trust, and an ending small enough to solve outright. Everything below says what was borrowed, what had to be changed to fit this game, and what was measured.

Against the version before that work, given the same time per move, it wins **83.3%** — 65–13 over 78 paired games at 100ms a move. Stripped of its speed advantage, on the same *number of nodes*, it still wins **71.2% ± 4.2** over 139. On the same 200ms budget, average depth over the bench positions goes from **4.6 to 12.8** — and it plays the ending perfectly rather than well.

### How a position is stored

`rules.js` is written for clarity, not speed: a shortest-path lookup there costs about 90µs because it builds a `Map` keyed by `"r,c"` strings. Path keeps the same board as flat typed arrays:

- `adj` — one `Uint8Array` per cell holding four bits (up/down/left/right) for which neighbours are still reachable. Placing a wall clears bits; removing it sets them back. There is no wall list to consult during search.
- `pawn[2]`, `hand[2]` — pawn cells as flat `r * cols + c` indices, and walls still in hand.
- `wall[orient][junction]` — which junctions are occupied, for legality only.
- `hashLo` / `hashHi` — a 64-bit Zobrist hash kept incrementally as two signed 32-bit halves, plus `wLo` / `wHi`, the same hash over the walls alone.
- `touch` — how many walls meet at each grid point. Three counters per wall, maintained on the way in and out.

Moves are made and unmade **in place** rather than by cloning, which brings the shortest-path primitive to about 0.9µs.

Two things then remove most of what is left. Both come from the same observation NNUE is built on — the expensive part of an evaluation is worth computing once and reusing, not recomputing at every node.

**The path memo.** A shortest path depends only on the walls and on one pawn, so it is a pure function of `(wLo, pawn)` and memoises perfectly. Wall placements commute, so the same layout is reached by an enormous number of move orders, and every one of them used to pay again. The table is never invalidated, because the key says everything the answer depends on.

**The cut filter.** Every wall the search tries has to be checked for trapping someone, and that check was two shortest paths. But a wall can only trap a player by *closing* a barrier — a chain of walls running from one edge of the board to another, or a ring around a region. The new wall is a link in that chain, so the chain has to continue from two of the three grid points the wall touches, each one either running into the board's edge or meeting a wall that was already there. Fewer than two such points and nothing can have closed. It is a filter, not an answer: it never misses a real cut, it only declines to ask when asking is pointless. Verified exhaustively — **1,475 real cuts across 17,198 wall placements on five board shapes, none missed** — and it skips the route search on 43% of placements.

Together: **the identical tree — 711,801 nodes on the bench either way, which is the point — at 203k nodes/second before and 389k after.**

### The search

Negamax with alpha-beta, run under **iterative deepening**. On top of that, in the order they matter:

- **Principal variation search.** The first move at a node gets the full window; every move after it is first asked a yes/no question — "can you beat the best so far?" — with a null window, which is far cheaper than working out *how much* better it would be. Only a move that answers yes is searched properly. On a tree this wide it is most of the saving.
- **Transposition table** — 2²⁰ entries, indexed by the Zobrist hash, storing the score, the best move, the bound type and **the static evaluation**. The table matters more here than in chess because wall placements commute; caching the static evaluation matters because two shortest paths is the most expensive thing a node does.
- **Forward pruning** — reverse futility (if the position is already far enough above beta that the opponent cannot claw it back in the plies left, take the static score), **null move** (hand the turn over and see whether the position is still winning without doing anything), and **move-count pruning** (past a depth-dependent count of tried moves, the rest are walls nothing has ever recommended). Together these are the single biggest thing in the file: **switching all three off scores 8.2%** — 9 games to 101 — against leaving them on.
- **Late move reductions** — moves far enough down the list get a shallower look first, and only a full-depth search if that comes back well. Stockfish's `log(depth) × log(move number)` shape, but see below: *when* they start had to be retuned completely.
- **Internal iterative reduction** — no table move means no idea which move is best, and searching a fifty-wide node in the dark to full depth mostly wastes the depth.
- **Move ordering** — table move, then killer moves, then a **history heuristic** with Stockfish's update rule: the entry is pulled *towards* the bonus rather than accumulating without limit, and every move tried before the one that cut takes the same size of penalty. Without the penalty a move only ever climbs, and history comes to mean "seen often" instead of "better than its siblings".
- **Aspiration windows** — the search starts in a narrow window around the previous iteration's score and widens it geometrically on a fail, so a small miss costs one cheap re-search rather than a full-width one.
- **Wall candidate pruning** — walls are only generated on or beside a shortest path, or touching an existing wall, or next to a pawn. A wall somewhere else cannot lengthen anything. On an empty 9×9 that is 40 walls generated out of 128 legal ones, and it is the one place where playing well and *explaining* well pull apart — see **Rating a move the search ignored**.

Between them these take the cost of a fixed nominal depth down by two orders of magnitude: reaching depth 7 on the bench positions took **711,801 nodes** before and **3,992** after. That number flatters itself — a reduced, pruned depth 7 is not the same tree as a full-width one, which is exactly why the honest measure is games and not depth — but the direction is not in doubt.

### Reductions have to wait for the ordering

The single largest surprise. Shipped with Stockfish's settings — reduce from the third move on — late move reductions **lost**: 43% against simply not reducing at all.

The reason is that a reduction is a bet on the move ordering. It says *if this move were any good, the ordering would have put it near the front by now.* Chess move ordering earns that bet after a move or two. This game's does not. A node has around fifty candidates, most of them walls, and the heuristics that rank walls — is it on the opponent's route, does it touch an existing wall, has it caused a cutoff before — cannot tell the one wall that works from a dozen that look exactly like it. Reducing from the third move buries the real move.

Starting the reductions later fixes it, and nothing else does:

| Reductions start at move | Score vs no reductions |
|---|---|
| 3 (Stockfish's setting) | 43.0% |
| 7 | 54.7% |
| 13 | 57.8% |
| 21 | 56.7% |
| 13, without the extra ply expected-cutoff nodes used to get | **60.0%** |

Softening the reduction *amount* instead barely helped — dropping the history term and the cut-node bonus, or halving the log coefficient, moved 43% to at best 47.5%. It was never how hard, only how soon. Move-count **pruning**, which throws late moves away outright, was strongly positive from the start, and it only bites from the 13th move at depth 3 and the 29th at depth 5 — the same lesson from the other side. Cutting off the tail of this game's move list is safe; touching its head is not.

The forward-pruning margins wanted the same treatment. Reverse futility is essential — switching it off scores **34.9%** — but the chess-sized margin was far too aggressive: 190 per ply lost to 120 at **63.0% ± 3.4** over 219 games, and 120 in turn lost to 90 and to 60. Put together, the retuned settings beat the ones this engine was first written with by **54.4% ± 3.4** over 215 games.

The pattern in all of it is the same. Every constant borrowed from Stockfish wanted to be *gentler* here, and for one reason: chess move ordering is good enough to justify betting against the moves it ranks low, and this game's is not.

### Null moves and zugzwang

A null move is not a legal move in the game; it is a question. *If I could do nothing at all and still be winning by this much, is there any point searching my real moves?* In chess that question is unsafe in zugzwang, where being obliged to move is itself the problem.

Detour has a narrower version of the same trap. A player with no walls left has only pawn moves, and in a pocket every one of them can lose ground — so doing nothing really would be better than moving, and the answer to the question would be a lie. Null moves are therefore only asked by a player who still holds a wall, who always has a quiet move available and so is never in zugzwang. They are also never asked in a pure race, where a tempo is the whole game.

### Evaluation

Deliberately tiny — three terms:

| Term | Weight | Meaning |
|---|---|---|
| `dist` | 100 | per step of shortest-path advantage. Dominates, as it should. |
| `hand` | 130 | per spare wall — so a wall is worth **1.3 steps in hand**, and the engine only spends one when it buys more than that. |
| `tempo` | 50 | side to move. |

`tempo` is exactly half of `dist` and that is **derived, not fitted**: with both players simply advancing, a full round changes nothing, and an evaluation that scores that as zero must have `tempo == dist/2`. At any other value the engine believes plain racing creates ground out of nothing, which produces an even-odd wobble.

The weights were tuned by **playing matches**, not by fitting game outcomes. A regression on outcomes reads "still holding walls" as a *cause* of winning when it is mostly a *symptom* of already being ahead: it values a spare wall at 7.5 steps, and an engine that believes that never places a wall at all. Match play puts it at 1.3. The one thing regression *is* right for is `scale`, the logistic constant that turns a score into the win probability on the eval bar, because that is pure calibration.

#### Why there is no neural network here

The NNUE idea is that a hand-written evaluation cannot express what actually matters, so you learn it instead, and you make the network cheap by updating it incrementally as moves are made. The second half of that transfers and is used above — the path memo and the cut filter are both "compute the expensive shared thing once". The first half does not. What matters in this game is the length of a shortest path, and that is not a feature a small network approximates; it is a global, highly non-linear function of the whole wall layout, and Path already computes it *exactly* for under a microsecond. A network would be replacing an exact number with a guess at it.

That is a claim, so it was checked rather than asserted: **giving the engine four times as many nodes wins 76.7%** of a paired match against itself. The search is nowhere near saturated, which is where the strength still is.

#### The search runs on its own thread, when the page is allowed one

A search this size wants a thread to itself, and the budget it can be given is set by how long
the page may stop responding — 420ms for the analysis panel, 700ms for the hard bot. That is a
harsh limit: **four times the nodes is worth about 63%** in a paired match, so the thread is
worth more than any change to the evaluation.

A worker **cannot be created from a `file://` page at all**: `new Worker('engine-worker.js')`
raises `SecurityError: Script ... cannot be accessed from origin 'null'`, the same origin rule
that blocks `fetch()` here, and handing the same code over as a Blob URL does not get round it
— measured side by side, both forms work over `http://` and neither answers from `file://`.

So `engine-worker.js` is an upgrade the page takes when it can rather than something it depends
on. Served over http, searches go to the worker and get seconds instead of milliseconds; opened
from a local file, `new Worker` throws, and the same search runs inline on the main thread at
the old budget with nothing else changed. There is no second copy of the engine: the worker
loads the very same `rules.js`, `engine.js` and `book.js` the page does. `serState`/`deState`
moved from app.js into rules.js for the same reason — the worker has to rebuild a position from
the same snapshot, and two copies of that are two things to keep in step.

Everything that asks the engine a question now gets a promise back, which is the whole cost of
the change on the page's side: the bot's reply, the live panel and the review's progressive
analysis were all already behind a `setTimeout`, so they became `.then`. A reply is only played
if the board has not moved on while the search was in flight.

Measured on the same position: the panel reaches **depth 10** through the worker where it
managed **depth 5** on the main thread.

Testing it needed a new harness. Headless Chrome's `--virtual-time-budget` and workers do not
mix: the moment the page awaits a worker the main thread goes idle, virtual time runs straight
to the end of the budget, and Chrome dumps the page and exits before the reply arrives. So the
worker path is driven on a real clock, with the page handing its result back over http — which
is available for exactly the same reason the worker is.

### Measured against another engine

Self-play says whether a change helped; it cannot say whether the engine is any good. So Path
is also played against an outside opponent: **[gorisanson's Quoridor AI](https://github.com/gorisanson/quoridor-ai)**,
a Monte-Carlo tree search agent with published results against several other programs. It is a
genuinely different kind of engine — tens of thousands of random playouts per move where Path
searches a tree — which is what makes it worth playing.

Two engines can only be compared if they are playing the same game, so that was established
rather than assumed. Every legal pawn move, every legal wall, every jump, the turn order, the
wall counts and the winner were compared position by position over **200 random games and
46,957 plies, with no disagreements**. The coordinates and wall numbering happen to match
exactly, so the bridge between them is a rename rather than a translation, and both engines run
their own real code over one shared position.

**Who moves first decides most of these games, so a result from one seat is not a result.**
With the *same engine on both sides*, the first mover scores **78.3% +/- 10.6 over 60 games** —
about 220 Elo of advantage handed out before anyone has played a move. That is far larger than
the gap between any two engines worth comparing, and it has a blunt consequence: four wins from
one seat and two losses from the other, which is what Path and gorisanson's strongest level have
produced so far, is *exactly* what two equal engines look like. It is not evidence that Path is
better, and reading it that way was a mistake made here before the seat effect was measured.
Every cross-engine claim in this file is played from both seats in equal numbers for that reason.

A second outside program, **[danielborowski's Quoridor AI](https://github.com/danielborowski/quoridor-ai)**,
was read rather than played, because reading it settled the question. It has no search and no
evaluation function: it places each candidate wall, measures how many steps that adds to each
side's shortest route, and then runs a cascade of hand-written conditions over those two numbers
— including hardcoded board squares and several `Math.random()` thresholds — to decide between
the best wall and the best pawn move. Its whole idea, "a wall is worth what it adds to their
route less what it adds to mine", is Path's evaluation at one ply, and Path reaches depth 11 on
the same idea and solves the ending exactly on top of it. It is also bound to the page it runs
in, reading the position back out of the DOM. There is nothing in it to port.

### Where the strength actually is

Before changing anything, three things were measured.

* **The candidate wall generator is not the bottleneck.** Widening the root from the candidates
  to every legal wall changed Path's move in **0 of 27** midgame positions.
* **The search is not shallow.** At its normal budget Path completes **depth 11**, and each
  extra ply costs only about **1.8x** the last — the forward pruning is doing its job.
* **More search still helps, but is bounded.** At these budgets (65k nodes against 15k),
  4.3x the nodes is worth **63.5% +/- 10.0** over 96 paired games.

That pointed at the evaluation, so the static score was compared against a depth-13 search over
**889 midgame positions** and the *difference* — what the search knows that the evaluation does
not — was regressed against candidate features. The share of that difference each one explains
is measured on the 427 positions that carry every candidate.

#### What that found, and why almost none of it shipped

| Candidate | Share of the residual | Match play |
|---|---|---|
| path fragility (how much one wall could lengthen a route) | 12.8% | **38.1%** |
| the same idea counted as cells rather than edges | 9.3% | **38.6%** |
| raise `tempo` to match the residual's offset | — | **44.2%** |
| closeness to the finish (`1/distance`) | 8.0% | 51.9% +/- 4.2 over 540 games |

The strongest signal in the regression was the **worst** move in play. Fragility is real — a
route that one wall can lengthen by four steps is genuinely worse than one it cannot — but
handing that number to the evaluation makes the engine buy width it does not need at the cost of
distance it does. The systematic offset in the residual looked exactly like an underrated tempo,
and raising tempo lost twelve points.

The one candidate that survived, a `1/distance` term for being near the finish, was still not
good enough: 55.6% over 180 games, and **51.9% +/- 4.2 once it had played 540** — an interval
that contains 50. It is not in the engine. The project's rule is that a weight earns its place
by winning matches, and this one did not.

None of this makes the search worse, and the negative results are worth as much as a positive
one would have been: they are four evaluation ideas that no longer need trying.

### Exact endgames — the tablebase

Stockfish stops guessing in simple endings and looks the answer up in a tablebase. The same thing is available here, and the hard part of a chess tablebase — there are too many positions to store — does not arise.

Once both players are out of walls the board can never change again, so the rest of the game is a pursuit on a fixed graph with exactly `(rows*cols)² × 2` positions: **13,122 on a 9×9**, 101,250 on the largest board the game allows. That is small enough to solve outright at the root, by working backwards from the positions that are already won — a position is won if any move reaches a position the opponent loses from, and lost when every move reaches one the opponent wins from. It takes about 18ms on a 9x9 and under 50ms on the largest board the game offers, once, and is cached for the rest of the ending — the wall layout cannot change again, so one solve covers every position that follows.

The result is not an estimate. It is the game-theoretic value of every position the ending can reach, together with the exact number of moves. It supersedes the counting rule the evaluation uses in exactly the cases counting cannot see: shortest paths ignore the other pawn and a jump covers two cells, so a pawn standing in the way is worth a tempo, and inside a one-step margin plain counting is wrong about 1.7% of the time.

Checked two ways: **120 five-by-five endings cross-checked against an exhaustive search, no disagreements**, and **128 positions the table called won, played out — every one won, every one in exactly the number of moves claimed.** The analysis panel says `solved` and *Win in N* rather than a depth and a percentage when it applies.

### A race is decided sooner than it looks

A race can only be settled by counting once nothing can lengthen a route again, and the
engine used to require **both** players to be out of walls before it would count. That is
stricter than the game is. A route is lengthened by the *other* player's walls, so:

- the opponent is out of walls → my distance can never grow and theirs can only grow (I may
  still wall them), so being ahead by the margin is a **proven win**;
- I am out of walls → their distance can never grow and mine can only grow, so being behind
  by the margin is a **proven loss**.

Waiting for both hands left the commonest decided endgame there is — one player out of walls,
the other holding a few they can no longer use in time — reported as a percentage when it was
already over. It is a claim about the future rather than about the board, so it was tested by
making it and then playing the position out with the engine on both sides: **120 positions the
rule calls decided, 120 where the claimed winner actually won.** The one-step margin that
covers the jump-and-pawn-meeting tempo (see the tablebase, above) still applies and is what
keeps it honest.


#### Out of walls, or merely out of squares to put them on

Being out of walls is the obvious way for a route to be beyond reach. It is not the only way.
A player can hold six walls and have nowhere legal to put one that touches the runner's route,
and for the purposes of counting that is the same thing.

This came from a reported position: blue three steps from home, orange holding four walls, and
the panel quoting **41% for orange**. Orange really was lost — the walls that would have cut
blue's route were all illegal, the decisive one because it would have sealed blue in, which the
rules forbid. The search could prove it, but only at depth 8 and 435,000 nodes, far more than
the panel is given. Counting proves it at depth 1.

The test has to be about **every** shortest route, not the length of the current one. The first
version of this asked "does any single wall make the route longer", which proves a fact about
one move and then claims a fact about the rest of the game: a wall can cut one shortest route
while another survives, and a second wall finishes the job. Played out, that version lied in
**3 positions out of 54**. Asking instead whether any legal wall can cut **any step that lies on
a shortest route** is sound, and stays sound as the game goes on — a wall placed away from those
steps leaves them all open, so the same routes are still there, and a wall that is illegal now
stays illegal, because walls only ever accumulate.

The candidate steps are found by walking forward from the pawn along moves that reduce the
distance, which is exactly the set of squares a shortest route can pass through. Using the
distance map alone instead marks the whole goal edge, nearly all of which the runner can never
reach, and one legal wall out there vetoes every position — that version never fired at all.

Checked the same way as the rule above: **52 positions it alone calls decided, 52 where the
claimed winner actually won.** It is gated to short routes, because that is where it pays for
itself and where the candidate list is small.

### Playing on when the game is already lost

A decided race is scored by the **winner's** distance alone. That is correct about who wins, but it means every move the losing side can make leads to a position worth exactly the same number — so the search returns a set of moves it rates identically and takes whichever came first, which is what a lost position looked like from the outside.

There are now two answers, because there are two regimes.

**With no walls left, the table settles it.** It stores the distance to the end, so the losing side plays the move that puts the end off longest — the most resistance the position allows, which is the same reason Syzygy stores a distance and not just a win/draw/loss. Over 150 lost solved endings it holds out as long as the position allows **every time**.

That also retired the heuristic that used to do this job. The old rule was "take the tied move that leaves the pawn nearest its own goal", and the table shows that is sometimes the *wrong* move. Asking the table how long every legal move can make the position last, over 113 lost endings: the engine's choice differs from the nearest-goal move in 5 of them, and in **all 5 the engine's move holds out longer**, never shorter. Standing in the way buys more time than walking home does. It was a proxy, and the real answer disagrees with it.

**With walls still in hand there is no table**, and the tie-break still applies — but it has to know which way it is facing. Winning and losing want opposite things, and one rule for both is what produced the answer that looks like a forfeit. Winning: arrive in the fewest moves, and among moves that arrive together, leave the opponent furthest away. **Losing: the score is the same however you lose, so the only thing left to play for is time** — take the move that puts the winner furthest from their goal, and only then walk toward your own.

Ranking a lost position by your own distance, which is what it did before, picks a step forward over a wall that would have held the winner up for two moves. Measured over 14 lost positions where the loser still held a wall: walls that actually delay the winner went from **3 to 5**, and the case where a delaying wall was available and a useless one was played disappeared — every remaining wall choice is one where no wall delays at all.

It lives at the **root** deliberately. The same idea expressed as an evaluation term changes scores inside the search, and the scores of decided races move by more than the aspiration window, so the engine starts failing high and low and spends its time re-searching. Four variants of that were measured and all looked worse.

### Measuring a change

Any change to how Path chooses has to be **measured by playing games**, and the harness has to be checked before the number is believed.

**Openings are paired.** Every opening is played twice, once with each engine as player 0. Alternating seats across *different* openings does not cancel, because the opening itself decides a lot of these games.

**Each move has to be a pure function of the position.** A time budget is not: the same position searched twice reaches different depths, so the two games of a pair drift apart and the control wanders off 50% for reasons that have nothing to do with either engine. A *node* budget is deterministic — except that the transposition table carried between moves is state, so the harness clears it before each move. With that done, the control is exactly 50.0%, 30–30. Without it, the same control returned 40.0% and 37.5%.

**Run the control first.** An earlier version of this harness returned **34%** for one engine against itself, and that unnoticed bias made four separate variants look like 36–41% regressions when nothing had regressed at all.

**Each side needs its own engine, not just its own settings.** One engine object means one transposition table, and a table is shared work: the side searching fewer nodes reads entries the side searching more nodes just paid for. The control cannot catch this — with identical settings the theft is symmetric and it still prints exactly 50.0% — so it hides until a comparison of *budgets* comes back impossible. It did: a 50,000-node engine scored **20.8%** against a 5,000-node one, and the ladder it sat in was non-transitive. Two independent engine instances, and the same matchup is **93.8%**.

**Depth comparisons have to keep parity.** Depth 5 against depth 4 scores 55.1%, which looks like depth barely matters. Depth 6 against depth 4 scores **73.3%**. The first number is an artifact of comparing an odd search with an even one — at odd depths the engine sees its own move last — not a fact about the game.

### The search must agree with plain minimax

Alpha-beta, principal variation search and the transposition table are shortcuts, not opinions: with reductions and forward pruning switched off, the search has to return exactly what a plain minimax of the same tree returns. That invariant is checked on small boards, where minimax can actually finish, across both table settings.

It caught a real bug, and the way it surfaced is the interesting part. One position in ninety came back **150 where minimax said 180**, and only with the table switched on. It was not a hash collision — 16.7 million slots still missed it — and not the table's cutoffs, which could be disabled without fixing it. Disabling only the table's *move ordering* fixed it, which was the clue: the search's value was depending on the order its moves were tried in, and reordering moves is the one thing a table is guaranteed to do.

The cause was one clamp:

```js
const d = Math.max(1, depth - 1 - (r >> 10));   // r = the reduction, 0 when LMR is off
```

That clamp is there to stop a *reduction* taking the search below one ply. But it also fires when there is no reduction at all: at a depth-1 node `depth - 1` is 0, and it lifts that to 1 — so the first move was scored by a static evaluation while every later move got a whole extra ply, and which move came first is decided by the ordering.

In ordinary play it cost about **12% of the nodes and a tenth of a ply** (28,728 → 25,404 nodes for a fixed depth 6; mean depth 10.90 → 11.00 in 340ms), because reductions and forward pruning were throwing most of those nodes away anyway. With them switched off, as this very test runs, nothing was absorbing it: the 9×9 leg went from over seventy minutes to about two.

```js
const d = r ? Math.max(1, depth - 1 - (r >> 10)) : depth - 1;
```

Ninety comparisons, zero mismatches after, and eighteen more on a full 9×9 board confirming the table does not change a value at depths minimax cannot reach.

The fix had to be paid for in games, because what it removes is a *selective* deepening — only moves after the first, and only where alpha-beta does not cut them off — and selectivity is where search strength lives. The first match said **42.9%**, which would have been a serious regression. It was noise: 120 games is nowhere near enough to resolve five points. Run properly it is **48.6% over 694 decided games** across two node budgets (50.3% at 15k, 47.3% at 40k), with the self-play control at exactly 50.0% — indistinguishable from even, though the interval is still wide enough not to exclude a small real loss. Correct, cheaper, and no measurable cost. Two smaller things fell out of the same investigation: the table stored **win distances raw** although `WIN - ply` is measured from the node, so a value saved at ply 6 and read at ply 2 claimed a win four moves further off than it was (wall placements commute, so transpositions are everywhere here); and **internal iterative reduction was not gated** with the other reductions, which meant the test could not actually switch every reduction off and would have quietly passed a search that was still reducing.

### The table was handing positions each other's evaluations

The single largest strength bug found in this engine, and it was four words of missing code.

The transposition table caches each position's static evaluation next to its score, so a
position reached again does not pay for `evaluate()` twice. The write looked like this:

```js
if (useTT && cachedEval === NO_EVAL) ttEval[idx] = staticEval;
```

Writing into a slot means **claiming** it, and this did not. A position that missed the probe —
different key, same index — still overwrote the evaluation belonging to whichever position held
the slot. When that position came back, its key still matched, so it read a stranger's
evaluation and believed it. The static evaluation drives reverse futility pruning, the null-move
decision, the improving flag and the early return for a settled race, so the damage was spread
across the whole search rather than concentrated anywhere obvious.

Most of the time it is a few points of noise. Occasionally the stolen number was a **proven**
score, and then the node returned it without searching anything — the engine announcing a won
game it had never looked at. That is not a hypothetical: in a real game against an outside
engine it reported a proven win at ply 32 from a position it was losing, shuffled between two
squares for three plies because a proven race score carries no notion of time, and reported a
proven loss at ply 35.

It was caught by the invariant the table is not allowed to break — alpha-beta and the table are
shortcuts, not opinions, so with reductions and forward pruning off the same depth must give the
same value whether the table is on or off:

| depth | table on | table off |
|---|---|---|
| 4, 5, 6 | 140 | 140 |
| **7** | **1047564** (proven win) | **140** |

The fix claims the slot before writing the evaluation into it, resetting the score fields so
nothing else reads what is no longer there. Afterwards every depth agrees, the false win is
gone, and that position searches to depth 14 where it had managed 10.

**In games it is worth 73.4% +/- 7.0 over 160 paired games** — around 176 Elo, and by a wide
margin the biggest change ever measured in this project.

Two things about how it was found are worth keeping. The first is that the bug had been sitting
behind a test that could not see it: the falsification harness sampled `evaluate()` directly and
found 51 proven claims, all sound, because the false claims were never *produced* by `evaluate`
— they were minted inside the search. Testing the search's own verdict instead is what exposed
it. The second is that this is the second cache in this file to be written without claiming its
slot; the path-length memo had the same shape of bug earlier. It is worth assuming the pattern
recurs.

### What did not work

Kept here because the negative results are as informative as the positive ones, and all of them were plausible before they were measured.

- **Ranking walls by what they actually do.** Stockfish sorts captures by what they win; the obvious equivalent is to place each candidate wall, measure how many steps it adds to the opponent's route less what it adds to our own, and sort by that. It orders *worse* than the cheap heuristic it replaced — 26,632 nodes to reach depth 8 against 21,412 — as well as costing two shortest paths per candidate. The best wall is frequently not the greediest one, and an ordering that believes otherwise puts the real move further down the list.
- **A losing-position term in the evaluation.** See above: it moves decided-race scores across the aspiration window. Measured 43.3%.
- **Futility pruning at the move itself** (as opposed to the reverse-futility test on the node). Neutral at every margin tried — 50.0%, 52.2%, 52.8% over 90 games each — so it is not in the file. The node-level test appears to be doing all the work already.

### The learned evaluation, and the ceiling it has

Path's evaluation is a small network now, trained the way Stockfish bootstrapped NNUE: positions
from self-play, each labelled with what the engine's own **deep search** said about it, and the
network fitted to predict that label from features cheap enough to compute at every leaf. The
gain is not that it knows something the search does not. It is that it knows it *immediately*.

**The design was decided by cost, not by accuracy.** `evaluate()` runs millions of times a
search, so the first question was how much a slower evaluation costs. Fourteen features, all
either already computed by `evaluate()` or O(1) from the position — no extra shortest paths, no
scans of the wall grid. Distances are given to the network rather than left to be learned,
because shortest path through walls is a graph algorithm and a small network has no chance of
discovering it from wall occupancy.

| hidden units | error vs the handcrafted evaluation | cost in a real search |
|---|---|---|
| 8 | 5.2% less | — |
| **16** | **13.8% less** | **1.40x** |
| 24 | 15.5% less | 1.55x |
| 48 | 19.6% less | — |

The microbenchmark said a 16-unit network costs 2.7x a call. In a real search it costs **1.40x**,
because the transposition table caches evaluations and so `evaluate()` does not run at every
node. That difference is the whole reason this was affordable.

Matches are at **equal time**, not equal nodes — comparing at equal nodes would hide the
slowdown entirely — so the network engine plays on proportionally fewer nodes:

| node budget | the handcrafted evaluation scores |
|---|---|
| 60,000 | 22.9% +/- 10.0 |
| 150,000 | 20.0% +/- 9.6 |
| **500,000** | **50.0% +/- 14.1** |

**You cannot distil a teacher and then outrun it.** The labels came from a 20,000-node search, so
the network learned that search's judgement. At 60k and 150k nodes, having it instantly is worth
about 230 Elo. At 500k the search has already overtaken the teacher and the network adds exactly
nothing. Path searches ~150k nodes on the main thread and ~500k in the worker, so the gain is
real where the page cannot afford to think and absent where it can.

The 24-unit network predicts better and wins by the same margin (20.0% at 150k), so the extra
accuracy buys no extra strength and the cheaper network ships.

The network replaces **only** the heuristic branch of `evaluate()`. The solved race, the counting
rule and the tablebase are exact, and a network has nothing to add to a fact. The weights are a
separate file loaded before the engine, so a page that fails to load them gets the handcrafted
evaluation rather than nothing.

### Levels, and what a number on the dial means

Path plays at full strength by default. The slider on the bot screen weakens it, on a scale
that runs 100 to 3200 like the one Stockfish exposes.

Stockfish weakens itself two ways at once — a depth cap plus noise added to each root move's
score — and this does the same thing with one substitution. **A node cap, not a depth cap.**
Depth caps behave badly here: a search that ends on an odd ply has just seen its own move
without the reply, and the resulting bias is large enough to be mistaken for strength. Depth 1
scored 46.9% against depth 3 and 3.1% against depth 2, which is not a fact about how far the
engine is looking. Node caps are smooth, and they have a second advantage that matters more for
a *rating*: a level defined in nodes is the same opponent on a phone as on a desktop, where a
level defined in milliseconds is not.

**The noise is the knob that does the work, and it is far more potent than it looks.** It is
added in the evaluation's own units, where 100 is one step of path. A quarter of a step is worth
about 300 points: `k1500` beat the same engine with 25 units of noise **91.7%**.

**How the numbers were set.** Thirteen rungs, each playing its neighbours in paired self-play
with its own transposition table, 1,300-odd games, and the whole table fitted to Elo at once by
maximum likelihood. The rungs' order and spacing are that fit. The absolute scale is not: the
measured span from the full search down to effectively random is about **1,800 points**, so the
dial stretches it by 1.7x to reach 100. A number on it is a place on Path's own ladder, which is
also all a Stockfish `UCI_Elo` is.

**Why the floor is so high.** Even swamped with noise, the engine still solves wall-less endings
exactly and still refuses to randomise a *proven* score, so its worst level is a competent racer
rather than a random mover. Taking the tablebase away from it as well was measured and is worth
**22 Elo**, so it is not done. Below about 1600 units of noise nothing further is measurable at
all — the bottom three rungs tried (3200, 6400, 12800) were indistinguishable from each other
and were dropped rather than shipped as a stretch of dial that does nothing.

The mechanism is checked to be a **true no-op at full strength**: the same positions at the same
node budget, with and without the whole level system compiled in, must return the same move, the
same score, the same depth, the same node count and the same score for every root move. 960
searches over 480 positions, zero differences, re-run after every change to the file.

### Live analysis

The graph button in bot and local games (never online, where it would just be cheating) opens:

- an **eval bar** beside the board, filled from your side with your win probability. Once a result is proven it shows the distance rather than the fact — **W5** is a win in five moves, **L5** a loss in five — because by then how long it takes is the only thing left to know;
- Path's **best move**, drawn on the board in **green** — an **arrow** for a pawn move, a **ghost wall** for a wall — from the moment you open it;
- a **verdict on every move** — Brilliant, Best, Book, Excellent, Good, Inaccuracy, Mistake, Blunder or Missed win — badged in the move list, spelled out in the panel, and **marked on the board where the move happened**: the far corner of the square the pawn landed on, or the near end of the wall that was placed. It is a grid item on the board rather than a pixel offset, so it follows the squares when the board resizes;
- a running **accuracy** percentage for both players.

Everything in the panel describes **the move that produced the position on screen**, not the one about to be played. The board mark always did; the panel and the move list did not, so the two contradicted each other and the last move of a game never got a verdict at all, because no position follows it. Clicking a move now shows the position it led to, so the move you picked is the one highlighted, marked and described. A move with no verdict now says which kind of nothing it is — still being analysed, outside what the engine handles, or genuinely unratable — because hiding the box made those three look identical, which is not something you can report a bug about.


Moves are graded on how much win probability they give up, not on raw score, because half a step matters enormously in a close race and not at all in a decided one.

**Brilliant** means a move that turned the game over: play anything else here and you come out behind, play this and you come out ahead. Two things about how that is measured were settled by counting rather than by taste.

It is measured in **score, not win probability**. Win probability was the obvious choice and it does not work — in a position the engine has not already decided, the probabilities crowd around 50%, so a ±5% band fired 22 times in 667 moves and a ±10% band fired once. Score is the unit the game is actually played in (100 is one step of path), and the same sweep falls off smoothly, which is what makes a threshold choosable at all. It is set at 0.8 of a step each way — a swing of more than a step and a half — which lands at about one move in ninety.

And it has to be a move the engine had to **find**. In a race it has already counted out, every step on the shortest path wins and every other move loses, so any test like this fires on each step in turn: three times inside five plies in one measured game. Those are forced, not brilliant, so a position whose result is already proven cannot produce one. When one does happen in a live game, you hear it.

### Rating a move the search ignored

The generator above is a *candidate* generator, and that is the right call for strength: a wall crossing neither route, touching nothing and standing beside neither pawn cannot change the position, so searching it only costs depth. But review grades a move by looking up what the search thought of it, and a move the search never generated has nothing to look up. On an empty board that is **88 of the 128 legal walls**, and those 88 are exactly the moves a person plays and an engine would not — so the moves most worth a verdict were the ones reliably not getting one. Worse, an unrated move dropped out of the accuracy average too, so a game was scored only on its explicable moves.

Two ways to fix it, and the cheap one turned out to also be the accurate one:

- **Put every legal move in the root.** Correct by construction, and it costs a full ply — depth 8.83 → 7.75 at review's budget, because the root roughly doubles.
- **Search the one move being asked about, on its own, to the depth the main search reached.** About a sixtieth of a position.

Measured against a complete-root search, moves the probe scored disagreed on the verdict **3.2%** of the time, against **8.2%** for the moves the candidate root had all along — so the probe is not where the error is, and the ply is not worth paying. (A first comparison put the probe at 31.8%; it was comparing two whole searches with different root sets, which moves every value in the position, not just the probed ones.)

A real game makes the shape of it plain. In one 22-move game, `g3h` and `g6h` — a pair of walls two files away from both pawns, touching nothing — were the **only two moves the generator never produced**, and they were exactly the two that came back with no verdict. Everything else in the game was generated and rated.

The same fix repaired a second symptom: guessing one of those walls in review used to be reported as **"That move is not available here"** for a perfectly legal move.

#### A tuning result can reverse with the node budget

The most expensive lesson of the project, and it nearly shipped a change that loses a couple of
hundred Elo.

Turning the aspiration window off in the playing search measured **73.6% +/- 7.5** over 140
paired games at 60,000 nodes — a huge gain, apparently overturning the finding below. Before
shipping it, the same comparison was run at a larger budget and came back **23.8%**. Same
engines, same harness, opposite conclusion. The self-play control was re-checked at every budget
and printed exactly 50.0% each time, so the harness was not at fault. Nor were the openings; it
reproduces across seeds:

| node budget | seed 21 | seed 404 | seed 77 |
|---|---|---|---|
| 60,000 | 73.6% | 70.0% | — |
| 150,000 | 19.2% | — | 23.8% |

The mechanism is the window's interaction with the node cap. Aspiration buys nodes and costs
robustness: a re-search aborted part way through discards the whole iteration and the engine
falls back to the previous depth. At a small budget there is nothing spare and that waste
dominates; at a large one the nodes the window saves buy a whole extra ply, which dominates
instead. The two cross somewhere between 60k and 150k nodes.

Path searches about 150,000 nodes on the main thread and half a million in the worker, so it
sits on the side where the window wins. It stays. **The rule this leaves behind: measure at the
budget the engine actually plays at, and treat a result from a cheaper budget as a hypothesis
rather than a finding.**

**The aspiration window cannot see a decided position.** The root guesses that this iteration's
score lands near the last one's and searches a narrow window around it. That is fine for a score
that drifts and useless for one that jumps to a proven win or loss a million points away: every
root move is then searched with a null window, reduced hard as a non-PV node, and a reduced
search never uncovers the six-ply win that makes them all lose. Measured on one such position,
the search reached **depth 18 and 40,000,000 nodes without ever proving it**, while the same
search with the window off proved it at **depth 8 in 435,000**. The window is not removable —
without it the engine loses games, 45.8% over 120 — and it does not affect the numbers on
screen, because analysis asks for `exactRoot`, which already turns it off. It is recorded here
because the next person to wonder why a won position is scored as a percentage during PLAY
should not have to find it twice.

**And `exactRoot` was not exact.** The flag exists so analysis gets a true value for every move rather than a bound, but the aspiration window above still narrowed the root to ±80, and under `exactRoot` nothing raises alpha — so every move worse than the window failed low and its score was a fail-soft *upper* bound. Over 656 root moves, **only 27% carried their true score and 66% came back too high**, which rated **342 moves too kindly against 30 too harshly**. Aspiration is now off whenever a caller asks for exact root values. It costs 2.3× the nodes, which is the honest price: computing exact values for bad moves is precisely what alpha-beta exists to avoid.

### The analysis board

A board you play both sides of, with Path already open and no clock running. It is the ordinary match machinery — the difference is who is meant to be sitting there, so it needs no board, no rules and no review of its own. Reaching a goal ends it like any other game, but it is **not saved to history**: a position you shuffled into to look at something is not a game you played.

It is also the one place where stepping back leaves a position you can *play* from: see [Looking back mid-game](#looking-back-mid-game).

It has **no status line**. Nobody is waiting on you there and there is no bot, so "Your turn" and "Bot thinking…" were both simply untrue — the board fell through to the bot-game wording because it is neither a hotseat game nor a networked one. The scrubber underneath already says which move you are on.

### Carrying a game out and back

A saved game is already a self-contained record — the setup, who opened, any Debris walls and every action — because that is exactly what review replays from. So the exchange format is that record with a marker around it, rather than a second notation to keep in step: **anything review can open, a file can carry.**

```json
{ "magic": "detour-game", "version": 1, "game": { … } }
```

**Export** sits at the end of a match, on each row of Game history, in the review panel and on the analysis board. **Import** sits on Game history, in the review panel and on the analysis board; an imported game is added to history and opens straight into review. A bare record with no wrapper is accepted too — someone will paste one in, and refusing it on a technicality when it is obviously a game would just be rude.

Both directions work from `file://`, which is what rules out the obvious implementations: a Blob URL on the way out and `FileReader` on the way in need no server, where `fetch()` would have been blocked.

### Looking back mid-game

You can read an earlier position without leaving a game, in **every** mode — online ones included. The control is the review's scrubber, not a second one to learn: the same first / previous / next / latest arrows, the same `n / total` count, in the same place under the board, sharing the same `.rv-nav` styling so the two cannot drift apart. It appears once there is a move to look back at. Clicking a move in the list, **←** / **→** and **Esc** all do what they do in review.

While you are back there the board carries an accent outline and the status line says which move you are on. The board is **read-only**, and any move, yours or your opponent's, brings you straight back to the live position — so you can never lose a game because you were looking at move 12.

The analysis board is the exception: you are both players there and there is nothing to protect, so a move played from an earlier position is simply a **new line**. Everything after it is dropped, the game carries on from where you were looking, and the verdicts already worked out for the moves before the branch are kept rather than recomputed. Path keeps reading the position you stepped back to, because on a board you are there to study, an engine that goes quiet the moment you look at anything is no use.

The board gives back the height the scrubber takes whenever it is on screen, the same way review does, so a long game never pushes it off the bottom of the window.

Online tournaments and 4-player online are the exception, and not on purpose: those modes are driven by a host that ships positions rather than actions, so there is no move list to replay from. They keep their move list and get the scrubber when they record one.

Giving online games a scrubber exposed a bug that had been sitting in the network handler: it read `M.state` once at the top, which while you are looking back is the position **you are looking at**, not the live one. The opponent's move was then checked for legality against the wrong board and silently dropped, and a forfeit or a timeout would have ended the game on a replay that is discarded the moment you step forward. Anything arriving from the opponent now ends the rewind before it touches the board.

It costs no memory: the match already records every action from ply 0 and which side opened, which is everything a replay needs, so an earlier position is *replayed* on demand through the same code the review uses.

### One rule for hiding things

Every control in the action rail is shown or hidden by the `hidden` attribute, which is the browser's own mechanism and the one `setControls()` writes to. But an author stylesheet beats the browser's `[hidden] { display: none }` no matter how unspecific it is, so a single line like `.icon-btn { display: inline-flex }` silently re-showed **every** button the rail could hold — Restart, Import, Export and Path all sitting in a live online game with the code that hid them running correctly. `[hidden] { display: none !important; }` now settles it once, near the top of the stylesheet, instead of a per-component patch each time it bites.

The test suite missed it for the same reason twice over: its `vis()` helper asked the element whether it was `hidden` instead of asking the browser what it drew, so it agreed with the code rather than with the screen. It measures now.

### Game review

**Game review** replaces "back to menu" when a game ends, and every finished game is also kept under **Game history** on the menu. A review gives you:

- the whole game as a **scrubbable timeline** — the move list, the arrow keys, or the evaluation graph, which doubles as a scrubber and ticks every mistake and blunder so it reads as a table of contents;
- **Path's move**, and only Path's move, drawn on the board as a **green** arrow or ghost wall. The move that was actually played is already in front of you — the pawn has moved, the wall is standing — so drawing it a second time only competed with the one thing you opened review to see;
- **Find best move**, which hands the board back to you at any position: play what you think is right and Path tells you whether it agrees, and what your move costs if it doesn't;
- **accuracy** for both players across the game.

Analysis is progressive — a 60-ply game means 60 searches, so they run one per tick with whichever position you are looking at jumped to the front of the queue. You can start reading the review immediately while the rest fills in behind you.

Reviews reuse the game board rather than building a second one, so walls, the board flip for the far seat and the coordinate strips all behave exactly as they do during play. The one thing a finished position cannot tell you is who moved first — games open with a random side — so that is recorded with the moves, and a replay that diverges from legal play raises rather than quietly showing a corrupted game.

## Persistence

- `detour_stats` — win/loss records keyed by bot difficulty (`easy` / `medium` / `hard`), shown under each bot on the **Play vs Computer** screen.
- `detour_look` — the Appearance set: theme, palette, corners, pawns, board. Read by an inline script in the `<head>` before the first paint. Anything unrecognised falls back to the default for that axis.
- `detour_name` — your display name (auto-generated default), used in online tournaments.
- `detour_games` — the last 40 finished games (setup, any Debris walls, who moved first, and the moves), for **Game history** and review. Cleared from the history screen.
- `detour_settings` — the Standard/Custom choice, clock minutes, bonus seconds, wall count, and every modifier (board width/height, wall length, king of the hill, race, 4 players, debris, random orientation, inverted). Settings saved by an older version are migrated on load: a single square "board size" becomes equal width and height, and a bundle with no Standard/Custom choice is filed as Custom if its board or modifiers were already off the default.
