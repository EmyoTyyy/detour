# Detour

A minimalist, fully-offline browser remake of a Quoridor-style tactical race game. *Don't be mad.*

Two pawns start on opposite rows of a 9×9 board. Each turn you either **move** one step or **place a wall** to lengthen your opponent's route. First pawn to reach the far side wins. Walls can slow an opponent but can never fully trap them — every placement must leave both players a path home.

## Run it

No build, no server, no dependencies. Open `index.html` in a browser (double-click works, `file://` is supported).

## Modes

- **Local 1v1** — two players on one device.
- **Play vs Bot** — advancing AI that walls when it's behind.
- **Hard Mode AI** — tracks both shortest paths and places the wall that best widens the tempo gap.
- **Play with a Friend** — online 1v1 over a room code (needs internet).

The bot and local modes are fully offline. Ranked and random matchmaking are not built yet.

## Online play

"Play with a Friend" connects two browsers peer-to-peer over WebRTC. One player **creates a room** and shares the 4-character code; the other **joins** with it. There is no game server: both browsers run the same rules and exchange only the action taken each turn (deterministic lockstep), so they stay in sync.

- Signaling uses the free public **PeerJS** broker, lazy-loaded from a CDN only when you open the online screen — the offline modes never touch the network.
- Host plays the bottom (orange) pawn and moves first; the guest plays the top (blue) pawn. The board is shown in the same orientation for both — perspective flipping is a possible later polish.
- A small fraction of networks (strict NAT) may fail to connect without a TURN relay, which this build doesn't include. Fall back to local/bot if a connection won't establish.

## Controls

- **Move** mode: legal destinations highlight; click one to move.
- **Wall** mode: pick orientation (Horizontal / Vertical), then click a junction. A preview shows green if legal, red if not. Illegal placements (overlaps, crosses, or fully trapping a player) are rejected.
- Jump a face-to-face opponent in a straight line; if a wall is behind them, side-step around instead.

Each player has 10 walls. The Wall toggle disables itself when you're out.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: menu, game screen, overlays |
| `styles.css` | All styling; colors live in CSS custom properties on `:root` |
| `rules.js` | Pure game logic — state, moves, jumps, wall legality, path validation (`window.Rules`) |
| `bot.js` | Easy / hard AI (`window.Bot`) |
| `net.js` | WebRTC room-code transport via the PeerJS broker (`window.Net`) |
| `app.js` | UI rendering, input, turn flow, online flow, persistence |

## Persistence

Win/loss records against each bot are stored in `localStorage` under `detour_stats` and shown on the menu.
