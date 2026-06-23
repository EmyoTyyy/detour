// bg.js — atmospheric generative background for Detour.
// A faint board-grid with teal/amber "wall" segments drifting across it, echoing
// the game's core mechanic. Deliberately low-contrast so it reads as texture, not
// decoration. Pure canvas, no deps; pauses when the tab is hidden; honours
// prefers-reduced-motion (draws a single static frame instead of animating).

(function () {
  const canvas = document.getElementById('bg');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ME = '#57cfc0', OPP = '#f0a64e';      // the two player colours
  let W = 0, H = 0, cell = 64, raf = 0, last = 0;
  let walls = [];

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.max(46, Math.min(82, Math.round(Math.min(W, H) / 11)));
    seed();
  }

  function seed() {
    const count = Math.max(6, Math.round((W * H) / 145000));
    walls = [];
    for (let i = 0; i < count; i++) walls.push(spawnWall());
  }
  function spawnWall() {
    const speed = 4 + Math.random() * 11;          // px/sec — slow drift
    return {
      x: Math.random() * (W + 2 * cell) - cell,
      y: Math.random() * (H + 2 * cell) - cell,
      horiz: Math.random() < 0.5,
      mine: Math.random() < 0.5,
      vx: speed * 0.55,
      vy: speed,
      len: cell * (1.15 + Math.random() * 0.85),
      phase: Math.random() * 6.283,
      pulse: 0.25 + Math.random() * 0.5,
    };
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    ctx.clearRect(0, 0, W, H);

    // static grid points — the board's cross-points
    ctx.fillStyle = 'rgba(122,138,154,0.05)';
    for (let y = cell; y < H; y += cell)
      for (let x = cell; x < W; x += cell) ctx.fillRect(x - 1, y - 1, 2, 2);

    // drifting wall segments
    const tsec = now / 1000;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (const w of walls) {
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.x > W + cell) { w.x = -cell; w.y = Math.random() * H; }
      if (w.y > H + cell) { w.y = -cell; w.x = Math.random() * W; }
      const a = 0.045 + 0.04 * (0.5 + 0.5 * Math.sin(tsec * w.pulse + w.phase));
      ctx.globalAlpha = a;
      ctx.strokeStyle = w.mine ? ME : OPP;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      if (w.horiz) ctx.lineTo(w.x + w.len, w.y);
      else ctx.lineTo(w.x, w.y + w.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  function start() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  resize();
  if (reduce) { last = performance.now(); frame(performance.now()); stop(); }  // one static frame
  else start();
})();
