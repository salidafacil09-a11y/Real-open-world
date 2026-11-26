// Los árboles del mundo grande (2026-11): pocos y repartidos como en Limgrave (sueltos por la llanura, arboledas,
// un bosque cerrado al este, pinos en las colinas del norte) y, por la guerra, muchos muertos en la tierra quemada.
//   Por celdas de 64 m que se generan cuando entran en lo que se ve (lo que queda detrás de la niebla ni se
//   genera), unas pocas por fotograma (carga progresiva: lo de cerca primero). Se dibujan con 8 mallas instanciadas
//   (4 tipos x 2 niveles de detalle): 8 llamadas de dibujo, haya los árboles que haya.
//   Los troncos chocan (MAPS.mundo.blockAt → hit).
(function () {
  'use strict';
  const G = window.Game = window.Game || {};
  const T = () => G.Terra;
  const CELL = 64, NEAR = 230, CAP_NEAR = 700, CAP_FAR = 3200, BUDGET_MS = 2.5;
  const KINDS = ['oro', 'verde', 'pino', 'muerto'];
  const TRUNK = [0.36, 0.36, 0.3, 0.26];          // radio del tronco (a escala 1)
  let scene = null, mat = null, meshes = null, cells = new Map(), last = { x: NaN, z: NaN, R: 0 }, dirty = false;
  let stats = { cells: 0, near: 0, far: 0, tris: 0 };

  // ---------- las formas (con G.Mesher: colores ya en lineal) ----------
  function shapes() {
    const g = [[], []];
    const mk = (fn) => { const M = new G.Mesher(); fn(M); return M.build(); };
    // (las copas: icosaedros de 20 triángulos; la esfera de Mesher tiene 80)
    const ICO = new THREE.IcosahedronGeometry(1, 0), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const blob = (M, x, y, z, sx, sy, sz, c, ry) => { q.setFromAxisAngle(v.set(0, 1, 0), ry || 0); mtx.compose(v.set(x, y, z), q, sc.set(sx, sy, sz)); M.add(ICO, mtx, c); };
    // dorado (los árboles de Limgrave) y verde oliva: tronco y copa de tres bolas
    for (const [i, c1, c2] of [[0, 0xb39548, 0x9c7f3c], [1, 0x6f7a45, 0x5d6a3c]]) {
      g[0][i] = mk((M) => {
        M.cyl(0, 1.7, 0, 0.2, 0.34, 3.4, 0x4a3b2d, 5);
        M.box(0.35, 3.1, 0, 0.12, 1.4, 0.12, 0x4a3b2d, 0, null, 0, -0.7);
        blob(M, 0, 4.7, 0, 2.4, 2.0, 2.4, c1, 0.3); blob(M, 1.15, 4.1, 0.6, 1.7, 1.4, 1.7, c2, 1.1); blob(M, -0.95, 4.2, -0.7, 1.6, 1.35, 1.6, c1, 2.0);
      });
      g[1][i] = mk((M) => { M.cone(0, 1.6, 0, 0.3, 3.2, 0x4a3b2d, 3); blob(M, 0, 4.6, 0, 2.7, 2.2, 2.7, c1, 0); });
    }
    // pino: tronco y tres conos
    g[0][2] = mk((M) => {
      M.cyl(0, 1.5, 0, 0.16, 0.28, 3.0, 0x3e3226, 5);
      M.cone(0, 3.6, 0, 2.3, 3.2, 0x3c4936, 6); M.cone(0, 5.4, 0, 1.75, 2.8, 0x445240, 6); M.cone(0, 7.0, 0, 1.15, 2.4, 0x3a4634, 6);
    });
    g[1][2] = mk((M) => { M.cone(0, 4.4, 0, 2.2, 8.0, 0x3e4b37, 5); });
    // muerto: tronco pelado y ramas secas
    g[0][3] = mk((M) => {
      M.cyl(0, 2.4, 0, 0.13, 0.3, 4.8, 0x4a433c, 5);
      M.box(0.55, 3.6, 0, 0.1, 1.9, 0.1, 0x4a433c, 0, null, 0, -0.75); M.box(-0.5, 4.2, 0.2, 0.09, 1.6, 0.09, 0x433d37, 0.4, null, 0, 0.8);
      M.box(0.1, 4.6, -0.5, 0.08, 1.4, 0.08, 0x433d37, 0, null, 0.7, 0); M.box(0.35, 5.0, 0.35, 0.06, 1.0, 0.06, 0x4a433c, 0.8, null, -0.5, -0.4);
    });
    g[1][3] = mk((M) => { M.cone(0, 2.6, 0, 0.3, 5.2, 0x4a433c, 3); M.cone(0.5, 4.2, 0, 0.1, 1.8, 0x4a433c, 3, 0, 0, -0.75); });
    return g;
  }

  // ---------- dónde hay árboles ----------
  const hash = (a, b, s) => { let h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const gauss = (dx, dz) => Math.exp(-(dx * dx + dz * dz));
  function at(arr, x, z) {
    const t = T(), i = Math.max(0, Math.min(t.NX - 1, Math.round((x - t.X0) / t.STEP))), j = Math.max(0, Math.min(t.NZ - 1, Math.round((z - t.Z0) / t.STEP)));
    return arr ? arr[j * t.NX + i] : 0;
  }
  // cuántos árboles (0..1 por cada hueco de 10,7 m) y de qué tipo
  function density(x, z) {
    const t = T();
    if (!t.inMap(x, z)) return 0;
    const h = t.ground(x, z);
    if (h < t.water(x, z) + 0.5 || h > 170) return 0;
    if (at(t.sand, x, z) > 60) return 0;                              // (la playa)
    if (t.slope(x, z) > 0.55) return 0;                               // (la roca)
    if (t.RIVER.at(x, z).d < 18) return 0;                            // (el cauce)
    let d = 0.012;
    d += sm(0.15, 0.45, t.fbm(x / 210 + 11, z / 210 - 4, 2)) * 0.13;                  // arboledas
    d += gauss((x - 1980) / 330, (z - 640) / 280) * 0.45;                            // el bosque de la niebla (este)
    d += gauss((x - 640) / 340, (z - 430) / 270) * 0.08;                             // las colinas de la tormenta
    d += gauss((x - 940) / 300, (z - 1680) / 230) * 0.07;                             // la península
    if (z < 380 && h > 40) d += 0.05;                                                // las faldas del norte
    return d;
  }
  function kindAt(x, z, h, r) {
    const t = T(), burn = at(t.burn, x, z) / 200;
    if (burn > 0.35) return r < 0.85 ? 3 : 1;
    if (r < 0.12) return 3;                                                          // (la guerra: alguno muerto en cualquier sitio)
    if (h > 55 || z < 360 || gauss((x - 640) / 340, (z - 430) / 270) > 0.35) return r < 0.75 ? 2 : 0;
    return t.fbm(x / 420 - 3, z / 420 + 8, 2) > -0.08 ? 0 : 1;
  }
  function genCell(cx, cz) {
    const key = cx * 1000 + cz;
    let c = cells.get(key);
    if (c) return c;
    const t = T(), list = [], N = 6, st = CELL / N;
    for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
      const x = cx * CELL + (gx + 0.15 + hash(cx * N + gx, cz * N + gz, 1) * 0.7) * st, z = cz * CELL + (gz + 0.15 + hash(cx * N + gx, cz * N + gz, 2) * 0.7) * st;
      const dn = density(x, z);
      if (dn <= 0 || hash(cx * N + gx, cz * N + gz, 3) > dn) continue;
      const h = t.ground(x, z), k = kindAt(x, z, h, hash(cx * N + gx, cz * N + gz, 4));
      const s = (k === 2 ? 1.05 : (k === 3 ? 0.85 : 1)) * (0.8 + hash(cx * N + gx, cz * N + gz, 5) * 0.55);
      list.push({ x, y: h - 0.15, z, k, s, r: hash(cx * N + gx, cz * N + gz, 6) * Math.PI * 2, b: 0.86 + hash(cx * N + gx, cz * N + gz, 7) * 0.26 });
    }
    c = { cx, cz, list };
    cells.set(key, c);
    stats.cells = cells.size;
    return c;
  }

  // ---------- dibujar ----------
  function build() {
    const g = shapes();
    mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    meshes = [[], []];
    for (let L = 0; L < 2; L++) for (let k = 0; k < 4; k++) {
      const m = new THREE.InstancedMesh(g[L][k], mat, L ? CAP_FAR : CAP_NEAR);
      m.count = 0; m.frustumCulled = false; m.castShadow = L === 0; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.userData.tris = g[L][k].index ? g[L][k].index.count / 3 : g[L][k].attributes.position.count / 3;
      scene.add(m);
      meshes[L][k] = m;
    }
  }
  const col = new THREE.Color();
  function fill(px, pz, R) {
    const cnt = [[0, 0, 0, 0], [0, 0, 0, 0]], R2 = R * R, N2 = NEAR * NEAR;
    const c0 = Math.floor((px - R) / CELL), c1 = Math.floor((px + R) / CELL), r0 = Math.floor((pz - R) / CELL), r1 = Math.floor((pz + R) / CELL);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const c = cells.get(cx * 1000 + cz);
      if (!c) continue;
      for (const tr of c.list) {
        const dx = tr.x - px, dz = tr.z - pz, d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        const L = d2 < N2 ? 0 : 1, m = meshes[L][tr.k], n = cnt[L][tr.k];
        if (n >= (L ? CAP_FAR : CAP_NEAR)) continue;
        const e = m.instanceMatrix.array, o = n * 16, cs = Math.cos(tr.r) * tr.s, sn = Math.sin(tr.r) * tr.s;
        e[o] = cs; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0;
        e[o + 4] = 0; e[o + 5] = tr.s; e[o + 6] = 0; e[o + 7] = 0;
        e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = cs; e[o + 11] = 0;
        e[o + 12] = tr.x; e[o + 13] = tr.y; e[o + 14] = tr.z; e[o + 15] = 1;
        col.setRGB(tr.b, tr.b, tr.b); m.setColorAt(n, col);
        cnt[L][tr.k] = n + 1;
      }
    }
    stats.near = 0; stats.far = 0; stats.tris = 0;
    for (let L = 0; L < 2; L++) for (let k = 0; k < 4; k++) {
      const m = meshes[L][k];
      m.count = cnt[L][k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (L) stats.far += m.count; else stats.near += m.count;
      stats.tris += m.count * m.userData.tris;
    }
    if (G.ShadowCache && G.ShadowCache.dirty) G.ShadowCache.dirty();
  }

  const Trees = {
    get active() { return !!meshes; },
    get stats() { return stats; },
    init(sc) {
      Trees.dispose();
      scene = sc; cells = new Map(); last = { x: NaN, z: NaN, R: 0 };
      build();
    },
    // cada fotograma: hasta dónde se ve (por la niebla), qué celdas faltan (unas pocas: lo de cerca primero) y,
    // si cambió algo, qué árboles se dibujan y con qué detalle
    update(p, fogNear, fogFar, force) {
      if (!meshes) return;
      const t = T(), R = Math.min(2400, fogNear + (fogFar - fogNear) * 0.5);
      const moved = Math.hypot(p.x - last.x, p.z - last.z) > 16 || Math.abs(R - last.R) > 60 || !(last.x === last.x);
      // celdas por generar dentro de R (de la más cercana a la más lejana)
      const t0 = performance.now(), budget = force ? Infinity : BUDGET_MS;
      let made = 0;
      if (moved || Trees._pending) {
        const want = [];
        const c0 = Math.max(0, Math.floor((p.x - R) / CELL)), c1 = Math.min(Math.floor(t.MAP.w / CELL), Math.floor((p.x + R) / CELL));
        const r0 = Math.max(0, Math.floor((p.z - R) / CELL)), r1 = Math.min(Math.floor(t.MAP.h / CELL), Math.floor((p.z + R) / CELL));
        for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
          if (cells.has(cx * 1000 + cz)) continue;
          const dx = Math.max(cx * CELL - p.x, 0, p.x - (cx + 1) * CELL), dz = Math.max(cz * CELL - p.z, 0, p.z - (cz + 1) * CELL);
          const d = Math.hypot(dx, dz);
          if (d < R) want.push([d, cx, cz]);
        }
        want.sort((a, b) => a[0] - b[0]);
        for (const w of want) { if (performance.now() - t0 > budget) break; genCell(w[1], w[2]); made++; }
        Trees._pending = made < want.length;
      }
      if (moved || made) { fill(p.x, p.z, R); last = { x: p.x, z: p.z, R }; }
    },
    // ¿choca un círculo de radio r en (x, z) con algún tronco?
    hit(x, z, r) {
      if (!meshes) return false;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const ccx = cx + dx, ccz = cz + dz;
        if (ccx < 0 || ccz < 0) continue;
        // (solo las vecinas si el círculo llega a ellas)
        if (dx && Math.abs(x - (dx > 0 ? (cx + 1) * CELL : cx * CELL)) > 2) continue;
        if (dz && Math.abs(z - (dz > 0 ? (cz + 1) * CELL : cz * CELL)) > 2) continue;
        const c = genCell(ccx, ccz);
        for (const tr of c.list) {
          const rr = TRUNK[tr.k] * tr.s + (r || 0.3);
          if (Math.abs(tr.x - x) < rr && Math.abs(tr.z - z) < rr && (tr.x - x) ** 2 + (tr.z - z) ** 2 < rr * rr) return true;
        }
      }
      return false;
    },
    dispose() {
      if (!meshes) return;
      for (const L of meshes) for (const m of L) { scene.remove(m); m.geometry.dispose(); m.dispose && m.dispose(); }
      if (mat) mat.dispose();
      meshes = null; mat = null; cells = new Map();
    }
  };
  G.TerraTrees = Trees;
})();
