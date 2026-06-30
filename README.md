# Detour

A minimalist, fully-offline browser remake of a Quoridor-style tactical race game. *Don't be mad.*

Two pawns start on opposite rows of a 9×9 board. Each turn you either **move** one step or **place a wall** to lengthen your opponent's route. First pawn to reach the far side wins. Walls can slow an opponent but can never fully trap them — every placement must leave both players a path home.

## Run it

No build, no server, no dependencies. Open `index.html` in a browser (double-click works, `file://` is supported).

## Modes

- **vs Bot** — pick a difficulty:
  - *Easy* — moves at random.
  - *Medium* — races forward, walls when it slips behind.
  - *Hard* — an expert engine: negamax search with alpha-beta pruning and iterative deepening (a ~0.7s budget per move), a shortest-path-difference evaluation, and wall candidates pruned to the opponent's shortest-path corridor. It looks several moves ahead, walls for tempo, and races to close out a won position — it will comfortably beat the easier bots and most humans.
- **Freeplay** — two players, one device (hotseat).
- **Tournament** (local) — round-robin: add named players, everyone plays everyone in pass-and-play, with a leaderboard between matches (win 3 pts, draw 1).
- **Play with a Friend** — online 1v1 over a room code (needs internet).
- **Tournament** (online) — host a room, friends join by code; everyone plays everyone and whoever isn't in the current match watches it live (needs internet).

The bot, freeplay, and local-tournament modes are fully offline. LAN play, LAN tournaments, random matchmaking, and ranked are placeholders (*Soon*).

### Your name & game settings

The menu has a **name** field (defaults to `Player-XXXX`, a random persisted suffix, so two people rarely collide — it's the name shown in online tournaments).

**Game settings live wherever you set up a game** — never in the menu — so it's always obvious which game they apply to. The same three controls appear on the bot picker, the Freeplay setup, the local-tournament card, the **create** side of a friend room, and the online-tournament lobby (host only):

- **Clock** — minutes per player (default 10; `0` turns the clock off).
- **Bonus** — seconds added to your clock after each move (default 5).
- **Walls** — walls per player (default 10).

Your choices persist and stay in sync across every setup surface. When you **join a friend's room** you don't set them — the **host's** apply. When you **join an online tournament** the host's settings show **read-only in the lobby** (updating live if the host tweaks them) so you know the clock and wall count before the bracket starts and locks them in. Each player has a chess clock shown in their rail; running out of time loses the game (or the match, in a tournament).

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

"Play with a Friend" connects two browsers peer-to-peer over WebRTC. One player **creates a room** and shares the 4-character code; the other **joins** with it. Once you create a room the join field disappears (you're the host now, waiting on an opponent — same flow as hosting a tournament). There is no game server: both browsers run the same rules and exchange only the action taken each turn (deterministic lockstep), so they stay in sync. When a game ends, a **rematch needs both players** — pressing Rematch sends the other player a request to accept or decline; if both press Rematch, you go straight into the next game. A friend match also has an **in-game chat** in the side panel so the two of you can talk during the game.

- Signaling uses the free public **PeerJS** broker, lazy-loaded from a CDN only when you open the online screen — the offline modes never touch the network.
- Each player sees themselves as **blue at the bottom** and the opponent as **orange at the top**; the board is rotated 180° for the guest so both play "upward." **Who moves first is random** (the host rolls it and shares it, for the first game and every rematch), so hosting carries no advantage.
- Online games show a **Forfeit** flag (turns red on hover) instead of Restart — forfeiting hands the win to your opponent.
- Connections use STUN plus a free public **TURN** relay (Open Relay) so peers behind strict/symmetric NATs can still connect; if a connection can't be made within ~20s you get a clear "couldn't connect" message instead of a silent hang. For heavy use, swap in your own TURN credentials in `net.js` (`PEER_OPTS`).

## Menu

Cards are grouped into **Solo** (vs Bot, Freeplay), **Local network** (LAN Lobby, Tournament — both *Soon*), and **Online** (Play with a Friend, plus Random Match and Ranked — *Soon*). The *Soon* cards are disabled placeholders for planned features.

## Controls

- **Move**: legal destinations highlight; **click one, or drag your pawn onto it** (the pawn is a pick-up-able 3D piece).
- **Walls**: your remaining walls sit in the tray under the board (the opponent's count is shown above it). Pick orientation with **Rotate** (or press **Space**), then **drag a wall onto a board junction**. A preview shows it in your colour if legal, red if not. Illegal placements (overlaps, crosses, or fully trapping a player) are rejected. In pass-and-play (Freeplay / local Tournament) the second player gets **their own Rotate button** on the top rail, so each side can set wall orientation from their own end.
- Jump a face-to-face opponent in a straight line; if a wall is behind them, side-step around instead.

Each player has 10 walls, drawn down from the tray as you place them.

The match controls (in the side rail next to the board, or below it on phones) depend on the mode: **Restart** (↺) in freeplay only; **Resign** (⚑, red on hover) and **Draw** (½) in friend games and in local/online tournaments; bot games have neither (use **Back** to leave, then Rematch from the result card to replay). **Resign and Draw ask for confirmation first** so you can't trigger them by accident. Draw then asks the other player to agree — face-to-face for hotseat, or as an offer the opponent accepts/declines over the network (online tournaments route it through the host).

If a network game loses its connection — including the silent kind (a phone changing networks or going to sleep) — a **Connection lost** popup appears instead of leaving you stuck: peers exchange a heartbeat, so a connection that goes quiet for ~20s is treated as dropped.

## On-screen layout & the move list

On wide screens the board sits in the centre with the **player info down the left** (opponent on top, you on the bottom — name, walls left, and clock), the **Resign / Draw / Restart** controls just under your card, and a **scrolling move list down the right**, chess.com-style. On phones it all stacks instead: opponent, board, you, controls, then the move list. The drag-to-place wall tray always travels with your own info, so it stays to hand. **Rank numbers (1–9) and file letters (a–i) frame the board**, oriented for whichever side you're on.

Every **online game has its own chat** below the move list — both in a **friend match** and in **each tournament game**. The two players and (in a tournament) anyone **spectating that game** share the same thread, so you can talk through the game as it happens. It's per-game: it shows the chat for whatever board you're currently watching, and it's separate from the tournament-wide chat on the lobby/ranking screens.

Squares are named like chess — files **a–i** left to right, ranks **1–9** bottom to top (player 0 starts on rank 1, like `e1`). A **pawn move** is written as its destination square (`e8`). Placing a **wall** — its own kind of move, which we simply call a *Wall* — is written as the wall's junction square plus its orientation, `h` or `v` (`e4h`). The notation is **absolute**: it never depends on which side you're on, so both players and every spectator read the exact same list even though the guest's board is flipped 180°. In the list your moves carry a teal marker and the opponent's an amber one, and walls show a small bar (laid flat or upright) in the placer's colour.

## Look & feel

Type is **Space Grotesk** (loaded from Google Fonts, with a system-font fallback if offline). The palette is a single cool-gray surface family with one teal accent; the two players are a teal/amber duel. Behind everything, a low-contrast **canvas background** drifts a faint board-grid and teal/amber wall segments — on-theme texture rather than a generic gradient, and it pauses when the tab is hidden and honours reduced-motion. The lobby, setup, and standings screens share one **tournament card** (a separated header, then `rank · name#tag · score` rows). **Walls are coloured by who placed them** (teal vs amber), and winning rows are tinted in the owner's colour with a bright edge.

In networked games the board flips per player so each sees themselves teal at the bottom. **Local games (freeplay and tournament) don't flip** — the board stays put, each player keeps a fixed side and colour, and the player to move drags walls from their own rail.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: menu, game screen, tournament cards, overlays |
| `styles.css` | All styling; colors live in CSS custom properties on `:root` |
| `bg.js` | Atmospheric canvas background — drifting board-grid + teal/amber wall motif (`#bg`) |
| `rules.js` | Pure game logic — state, moves, jumps, wall legality, path validation (`window.Rules`) |
| `bot.js` | Easy (random) / medium / hard AI (`window.Bot`) |
| `net.js` | WebRTC transport via the PeerJS broker — 1v1 and host-as-hub (`window.Net`) |
| `app.js` | UI rendering, input, turn flow, online flow, persistence |
| `favicon.svg` | Game icon — a pawn detouring around a wall |

## Persistence

- `detour_stats` — win/loss records keyed by bot difficulty (`easy` / `medium` / `hard`), shown in the difficulty picker.
- `detour_name` — your display name (auto-generated default), used in online tournaments.
- `detour_settings` — clock minutes, bonus seconds, and wall count.
