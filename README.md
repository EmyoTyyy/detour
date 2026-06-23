# Detour

A minimalist, fully-offline browser remake of a Quoridor-style tactical race game. *Don't be mad.*

Two pawns start on opposite rows of a 9×9 board. Each turn you either **move** one step or **place a wall** to lengthen your opponent's route. First pawn to reach the far side wins. Walls can slow an opponent but can never fully trap them — every placement must leave both players a path home.

## Run it

No build, no server, no dependencies. Open `index.html` in a browser (double-click works, `file://` is supported).

## Modes

- **vs Bot** — pick a difficulty:
  - *Easy* — moves at random.
  - *Medium* — races forward, walls when it slips behind.
  - *Hard* — tracks both shortest paths and walls for tempo.
- **Freeplay** — two players, one device (hotseat).
- **Tournament** (local) — round-robin: add named players, everyone plays everyone in pass-and-play, with a leaderboard between matches (win 3 pts, draw 1).
- **Play with a Friend** — online 1v1 over a room code (needs internet).
- **Tournament** (online) — host a room, friends join by code; everyone plays everyone and whoever isn't in the current match watches it live (needs internet).

The bot, freeplay, and local-tournament modes are fully offline. LAN play, LAN tournaments, random matchmaking, and ranked are placeholders (*Soon*).

### Your name

The menu has a name field. It defaults to `Player-XXXX` (a random suffix, persisted in `localStorage`) so two people rarely collide, and is the name shown in online tournaments. Edit it any time.

### Online tournament (host-as-hub)

No game server: the **host's browser is the hub**. Other players connect to it over WebRTC (PeerJS signaling), the host owns the bracket and the authoritative board, and it relays each match as a state snapshot to both players and all spectators. Two play, everyone else watches live; the host advances between matches from the standings screen.

- **The host must stay connected** — if the host leaves, the tournament ends for everyone (no host migration).
- A player who **forfeits** concedes the current match but stays in; a player who **disconnects** is auto-forfeited from their remaining matches so the bracket keeps moving.
- Needs internet (the PeerJS broker) and a non-strict NAT, same caveats as friend play. A truly offline LAN tournament still needs a local hub server.

## Online play

"Play with a Friend" connects two browsers peer-to-peer over WebRTC. One player **creates a room** and shares the 4-character code; the other **joins** with it. There is no game server: both browsers run the same rules and exchange only the action taken each turn (deterministic lockstep), so they stay in sync.

- Signaling uses the free public **PeerJS** broker, lazy-loaded from a CDN only when you open the online screen — the offline modes never touch the network.
- Each player sees themselves as **blue at the bottom** and the opponent as **orange at the top**; the board is rotated 180° for the guest so both play "upward." The host still moves first.
- Online games show a **Forfeit** flag (turns red on hover) instead of Restart — forfeiting hands the win to your opponent.
- A small fraction of networks (strict NAT) may fail to connect without a TURN relay, which this build doesn't include. Fall back to local/bot if a connection won't establish.

## Menu

Cards are grouped into **Solo** (vs Bot, Freeplay), **Local network** (LAN Lobby, Tournament — both *Soon*), and **Online** (Play with a Friend, plus Random Match and Ranked — *Soon*). The *Soon* cards are disabled placeholders for planned features.

## Controls

- **Move**: legal destinations highlight; click one to move.
- **Walls**: your remaining walls sit in the tray under the board (the opponent's count is shown above it). Pick orientation with **Rotate**, then **drag a wall onto a board junction**. A preview shows it in your colour if legal, red if not. Illegal placements (overlaps, crosses, or fully trapping a player) are rejected.
- Jump a face-to-face opponent in a straight line; if a wall is behind them, side-step around instead.

Each player has 10 walls, drawn down from the tray as you place them.

The game header has **Restart** (offline) or **Forfeit** (online), plus **Draw** (½). Offline, Draw asks the players to agree; online, it sends an offer the opponent accepts or declines.

## Look & feel

Type is **Space Grotesk** (loaded from Google Fonts, with a system-font fallback if offline). The palette is a single cool-gray surface family with one teal accent; the two players are a teal/amber duel, and **you are always teal at the bottom**. Winning rows are tinted in the owner's colour with a bright edge.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: menu, game screen, overlays |
| `styles.css` | All styling; colors live in CSS custom properties on `:root` |
| `rules.js` | Pure game logic — state, moves, jumps, wall legality, path validation (`window.Rules`) |
| `bot.js` | Easy (random) / medium / hard AI (`window.Bot`) |
| `net.js` | WebRTC transport via the PeerJS broker — 1v1 and host-as-hub (`window.Net`) |
| `app.js` | UI rendering, input, turn flow, online flow, persistence |
| `favicon.svg` | Game icon — a pawn detouring around a wall |

## Persistence

- `detour_stats` — win/loss records keyed by bot difficulty (`easy` / `medium` / `hard`), shown in the difficulty picker.
- `detour_name` — your display name (auto-generated default), used in online tournaments.
