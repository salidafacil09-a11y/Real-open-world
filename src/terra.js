// El mundo grande (modo supervivencia, 2026-11): un terreno de 2,5 x 2 km con forma de Limgrave (Elden Ring),
// postapocalíptico. No usa el mundo de baldosas de 1 m (5 millones de baldosas no caben en un teléfono): es un
// mapa de alturas cada 4 m, dibujado por bloques con nivel de detalle (cerca, más triángulos; lejos, menos) y
// faldones para tapar las grietas entre niveles.
//   x: este (0 → 2500), z: sur (0 → 2000), y: altura en metros (el mar, a 0)
//   El dominio de alturas sobresale MARGIN m por cada lado (más montaña al norte y al este, mar al oeste y al
//   sur) para que desde el aire no se vea el borde del mundo.
(function () {
  'use strict';
  const G = window.Game = window.Game || {};

  const MAP = { w: 2500, h: 2000 };
  const MARGIN = 512;
  const STEP = 4;                                   // la rejilla de alturas, en metros
  const X0 = -MARGIN, Z0 = -MARGIN;
  // (el dominio: 7 x 6 bloques grandes de 512 m)
  const DW = 3584, DH = 3072, BIG = 512, TILE = 128;
  const NX = DW / STEP + 1, NZ = DH / STEP + 1;
  const SEA = 0, LAKE = { x: 1300, z: 620, y: 6.0, r: 240 };

  // ---------------- ruido (Perlin 2D, con semilla) ----------------
  function makeNoise(seed) {
    const p = new Uint8Array(512), g = new Float32Array(512);
    let s = seed >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const perm = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) { p[i] = perm[i & 255]; g[i] = rnd() * Math.PI * 2; }
    const gx = new Float32Array(256), gz = new Float32Array(256);
    for (let i = 0; i < 256; i++) { gx[i] = Math.cos(g[i]); gz[i] = Math.sin(g[i]); }
    return function (x, z) {
      const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
      const X = xi & 255, Z = zi & 255;
      const a = p[p[X] + Z], b = p[p[X + 1] + Z], c = p[p[X] + Z + 1], d = p[p[X + 1] + Z + 1];
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
      const n00 = gx[a] * xf + gz[a] * zf, n10 = gx[b] * (xf - 1) + gz[b] * zf;
      const n01 = gx[c] * xf + gz[c] * (zf - 1), n11 = gx[d] * (xf - 1) + gz[d] * (zf - 1);
      const x0 = n00 + u * (n10 - n00), x1 = n01 + u * (n11 - n01);
      return (x0 + v * (x1 - x0)) * 1.42;            // ~[-1, 1]
    };
  }
  const N1 = makeNoise(9137), N2 = makeNoise(4421), N3 = makeNoise(7717), N4 = makeNoise(2311);
  function fbm(n, x, z, oct) { let a = 0, f = 1, amp = 1, sum = 0; for (let i = 0; i < oct; i++) { a += n(x * f, z * f) * amp; sum += amp; f *= 2.03; amp *= 0.5; } return a / sum; }
  function ridged(n, x, z, oct) { let a = 0, f = 1, amp = 1, sum = 0; for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(n(x * f, z * f)); a += r * r * amp; sum += amp; f *= 2.1; amp *= 0.5; } return a / sum; }
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const gauss = (dx, dz) => Math.exp(-(dx * dx + dz * dz));

  // ---------------- la silueta (como Limgrave): la tierra grande, la península del sur y su istmo ----------------
  // Al norte y al este la tierra sigue (montañas, el borde del mapa); al oeste y al sur, el mar.
  // (la isla entera: al norte, detrás de la cordillera, y al este, detrás de la sierra, también hay costa; así
  // desde el aire no se ve un rectángulo)
  const MAIN = [[60, 40], [160, -120], [330, -260], [560, -330], [800, -250], [1000, -350], [1250, -300], [1520, -380], [1780, -290],
    [2040, -340], [2280, -240], [2520, -170], [2700, -10], [2800, 220], [2690, 430], [2800, 660], [2700, 880], [2560, 1060],
    // la costa del sur: el saliente del bosque del este, la gran bahía y el arranque del puente
    [2420, 1160], [2250, 1250], [2080, 1330], [1900, 1380], [1740, 1340], [1620, 1240], [1480, 1170], [1330, 1150], [1180, 1190],
    [1040, 1250], [900, 1270], [780, 1230], [640, 1200], [500, 1130], [380, 1030], [300, 930],
    // la costa del oeste, con el bulto de las colinas de la tormenta al norte
    [240, 820], [300, 720], [210, 620], [130, 560], [160, 450], [90, 360], [140, 250], [60, 140]];
  // la península del sur (la del llanto), grande, hacia el suroeste
  const PEN = [[620, 1390], [800, 1350], [980, 1370], [1150, 1400], [1320, 1470], [1430, 1580], [1460, 1720], [1390, 1850], [1250, 1930],
    [1070, 1970], [880, 1960], [700, 1900], [560, 1800], [480, 1660], [500, 1520]];
  const NECK = [850, 1245, 862, 1385, 40];            // el istmo (el puente del sacrificio, por ahora de tierra)
  function sdPoly(P, x, z) {
    let d = Infinity, inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j][0], az = P[j][1], bx = P[i][0], bz = P[i][1];
      const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
      const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
      const dx = wx - ex * t, dz = wz - ez * t, dd = dx * dx + dz * dz;
      if (dd < d) d = dd;
      if ((az > z) !== (bz > z) && x < ax + (z - az) * ex / ez) inside = !inside;
    }
    return inside ? Math.sqrt(d) : -Math.sqrt(d);       // positivo: dentro (tierra)
  }
  function sdCapsule(x, z, c) {
    const ex = c[2] - c[0], ez = c[3] - c[1], wx = x - c[0], wz = z - c[1];
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    return c[4] - Math.hypot(wx - ex * t, wz - ez * t);
  }
  const landDistRaw = (x, z) => Math.max(sdPoly(MAIN, x, z), sdPoly(PEN, x, z));
  // (la distancia a la costa, precalculada cada 16 m: 44 segmentos por punto son muchos)
  const LDS = 16, LNX = DW / LDS + 1, LNZ = DH / LDS + 1;
  let LD = null;
  function landDist(x, z) {
    if (!LD) return landDistRaw(x, z);
    let fx = (x - X0) / LDS, fz = (z - Z0) / LDS;
    fx = Math.max(0, Math.min(LNX - 1.001, fx)); fz = Math.max(0, Math.min(LNZ - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * LNX + i;
    return (LD[k] * (1 - u) + LD[k + 1] * u) * (1 - v) + (LD[k + LNX] * (1 - u) + LD[k + LNX + 1] * u) * v;
  }
  function prepLand() {
    if (LD) return;
    const a = new Float32Array(LNX * LNZ);
    for (let j = 0; j < LNZ; j++) for (let i = 0; i < LNX; i++) a[j * LNX + i] = landDistRaw(X0 + i * LDS, Z0 + j * LDS);
    LD = a;
  }

  // El relieve de dentro (Limgrave es la región más baja: llanura, lomas y algún monte de roca)
  //   montes con nombre: el macizo del oeste, el cerro del noreste, la meseta del sureste (con borde de acantilado),
  //   la loma del sur y la del suroeste; más montículos sueltos repartidos al azar (siempre los mismos)
  const MOUNTS = [
    { x: 900, z: 700, r: 175, h: 88, rock: 1 }, { x: 1760, z: 470, r: 145, h: 72, rock: 1 }, { x: 2060, z: 1010, r: 190, h: 46, plat: 1 },
    { x: 1540, z: 1010, r: 125, h: 34 }, { x: 560, z: 1010, r: 115, h: 28 }, { x: 1120, z: 1720, r: 150, h: 52, rock: 1 }];
  let srand = 515;
  const rnd = () => { srand = (srand * 16807) % 2147483647; return srand / 2147483647; };
  // el río (el Murkwater): sale del lago hacia el norte y corta la cordillera en un cañón hasta el mar
  const RIVER = { pts: [[1300, 440], [1265, 320], [1215, 190], [1185, 60], [1160, -110], [1150, -300], [1145, -420]], y0: LAKE.y - 0.9, y1: -1.0 };
  (function () {
    let L = 0; RIVER.acc = [0];
    for (let i = 1; i < RIVER.pts.length; i++) { L += Math.hypot(RIVER.pts[i][0] - RIVER.pts[i - 1][0], RIVER.pts[i][1] - RIVER.pts[i - 1][1]); RIVER.acc.push(L); }
    RIVER.len = L;
  })();
  // distancia al río y el fondo del cauce en ese punto
  const RBOX = [1100 - 260, -460, 1310 + 260, 440 + 260];
  const FAR_RIVER = { d: 1e9, floor: 0 };
  function riverAt(x, z) {
    if (x < RBOX[0] || x > RBOX[2] || z < RBOX[1] || z > RBOX[3]) return FAR_RIVER;          // (lejos del río: ni se mide)
    let best = Infinity, s = 0;
    const P = RIVER.pts;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], az = P[i - 1][1], ex = P[i][0] - ax, ez = P[i][1] - az, wx = x - ax, wz = z - az;
      const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
      const d = Math.hypot(wx - ex * t, wz - ez * t);
      if (d < best) { best = d; s = RIVER.acc[i - 1] + t * Math.hypot(ex, ez); }
    }
    const u = s / RIVER.len;
    return { d: best + N2(x / 40, z / 40) * 6, floor: RIVER.y0 + (RIVER.y1 - RIVER.y0) * u };
  }
  RIVER.at = riverAt;
  // los montículos sueltos
  const MOUNDS = [];
  for (let i = 0; i < 300 && MOUNDS.length < 22; i++) {
    const x = 250 + rnd() * 2050, z = 200 + rnd() * 1700, r = 40 + rnd() * 75, h = 7 + rnd() * 18;
    if (landDist(x, z) < r + 180) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + r + 30) continue;
    if (MOUNTS.some((m) => Math.hypot(m.x - x, m.z - z) < m.r + r)) continue;
    if (MOUNDS.some((m) => Math.hypot(m.x - x, m.z - z) < m.r + r + 30)) continue;
    MOUNDS.push({ x, z, r, h });
  }
  // cráteres (la guerra): sitios fijos, con borde levantado y el fondo quemado
  const CRATERS = [];
  for (let i = 0; i < 500 && CRATERS.length < 34; i++) {
    const x = 260 + rnd() * 2000, z = 250 + rnd() * 1650, r = 14 + rnd() * rnd() * 55;
    if (landDist(x, z) < r + 140) continue;
    if (CRATERS.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 40)) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + r + 20) continue;
    if (MOUNTS.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 0.8)) continue;
    CRATERS.push({ x, z, r, d: r * (0.18 + rnd() * 0.12) });
  }

  // ---------------- la altura (y el «quemado» y la arena, para el color) en un punto ----------------
  function heightAt(x, z, out) {
    // la costa, irregular (calas, cabos)
    let d = landDist(x, z) + fbm(N4, x / 900, z / 900, 2) * 150 + fbm(N1, x / 430, z / 430, 3) * 90 + fbm(N2, x / 125, z / 125, 2) * 24 + N3(x / 42, z / 42) * 5;
    // (el istmo, con su propio ruido: si no, el de la costa lo corta)
    d = Math.max(d, sdCapsule(x, z, NECK) + N3(x / 30, z / 30) * 6);
    // (en los bordes del dominio, todo baja al mar: desde el aire se ve una isla, no un corte)
    const edge = Math.min(x - X0, X0 + DW - x, z - Z0, Z0 + DH - z);
    d = Math.min(d, (edge - 90) * 1.5);
    const sand = smooth(120, 45, d);
    if (d < 0) {
      // el mar: poco hondo cerca de la orilla (como en las playas de Oceanside) y más hondo mar adentro
      if (out) { out.burn = 0; out.land = d; out.sand = 1; }
      return Math.max(-16, -0.25 + d * 0.035 + Math.min(0, d + 200) * 0.03);
    }
    // la playa: arena que sube despacio (unos 2 m en los primeros 80) y, detrás, la tierra
    const beach = -0.25 + d * 0.03;
    const inland = smooth(70, 300, d);
    // la llanura dorada: lomas largas y suaves (lo más bajo de las Tierras Intermedias)
    let base = 13 + fbm(N1, x / 760, z / 760, 4) * 34 + fbm(N2, x / 300, z / 300, 3) * 7 + ridged(N4, x / 380, z / 380, 2) * 7;
    base = Math.max(3, base);
    let h = beach + (base - beach) * smooth(50, 280, d);
    // la cordillera del norte (los acantilados de Stormveil y más allá), con su playa delante
    const north = smooth(300, 20, z);
    if (north > 0) h += north * north * (110 + ridged(N3, x / 320, z / 320, 4) * 130) * inland;
    // las colinas de la tormenta (noroeste): ventosas, rocosas
    const storm = gauss((x - 640) / 340, (z - 430) / 270);
    if (storm > 0.01) h += storm * (34 + ridged(N1, x / 150, z / 150, 3) * 26) * inland;
    // la sierra del este (la frontera con lo rojo)
    const east = smooth(2120, 2460, x) * smooth(1260, 880, z);
    if (east > 0) h += east * (90 + ridged(N2, x / 220, z / 220, 4) * 100) * inland;
    // los montes y montículos de dentro
    for (let i = 0; i < MOUNTS.length; i++) {
      const m = MOUNTS[i], dx = x - m.x, dz = z - m.z;
      if (Math.abs(dx) > m.r * 1.3 || Math.abs(dz) > m.r * 1.3) continue;
      const q = Math.hypot(dx, dz) / (m.r * (1 + N3(x / 90 + i, z / 90) * 0.18));
      if (q >= 1) continue;
      if (m.plat) h += m.h * smooth(1, 0.72, q) * (0.92 + N1(x / 60, z / 60) * 0.08);
      else { const b = (1 - q * q) * (1 - q * q); h += m.h * b * (m.rock ? 0.7 + ridged(N4, x / 70, z / 70, 3) * 0.6 : 1); }
    }
    for (let i = 0; i < MOUNDS.length; i++) {
      const m = MOUNDS[i], dx = x - m.x, dz = z - m.z;
      if (Math.abs(dx) > m.r || Math.abs(dz) > m.r) continue;
      const q = (dx * dx + dz * dz) / (m.r * m.r);
      if (q < 1) h += m.h * (1 - q) * (1 - q);
    }
    // el lago (el Agheel, en el centro): una cubeta
    const lk = gauss((x - LAKE.x) / (LAKE.r * 0.9), (z - LAKE.z) / (LAKE.r * 0.68)) + fbm(N2, x / 110 + 3.3, z / 110, 2) * 0.32;
    if (lk > 0.05) h += (LAKE.y - 5.5 - h) * smooth(0.12, 0.55, lk);
    // el río: un cauce de fondo plano y, en la cordillera, un cañón
    const rv = riverAt(x, z);
    if (rv.d < 240) { const t = rv.floor + Math.pow(Math.max(0, rv.d - 11), 1.6) * 0.08; if (t < h) h = t; }
    // los cráteres (la guerra), con la tierra quemada alrededor
    let burn = Math.max(0, fbm(N3, x / 160 + 9.1, z / 160 - 3.7, 3) * 1.6 - 0.35);
    for (let i = 0; i < CRATERS.length; i++) {
      const c = CRATERS[i], dx = x - c.x, dz = z - c.z;
      if (dx > c.r * 2 || dx < -c.r * 2 || dz > c.r * 2 || dz < -c.r * 2) continue;
      const q = (dx * dx + dz * dz) / (c.r * c.r);
      if (q > 4) continue;
      const r = Math.sqrt(q);
      h += r < 1 ? -c.d * (1 - r * r) + c.d * 0.25 * r * r * r : c.d * 0.25 * Math.max(0, 1 - (r - 1) * 1.1) ** 2;
      burn = Math.max(burn, 1.15 - r * 0.45);
    }
    if (out) { out.burn = burn * (1 - sand); out.land = d; out.sand = sand; }
    return h;
  }

  // ---------------- la rejilla (cada 4 m) y lo que se calcula de ella ----------------
  const T = {
    MAP, MARGIN, STEP, X0, Z0, NX, NZ, DW, DH, BIG, TILE, SEA, LAKE, CRATERS,
    hm: null, burn: null, sand: null, ready: false, ms: 0, MOUNTS, MOUNDS, RIVER,
    heightAt,
    // generar la rejilla por tandas (para no congelar el teléfono): onProgress(0..1), onDone()
    generate(onProgress, onDone) {
      const t0 = performance.now();
      prepLand();
      const hm = new Float32Array(NX * NZ), bn = new Uint8Array(NX * NZ), sd = new Uint8Array(NX * NZ), o = {};
      let row = 0;
      const step = () => {
        const tEnd = performance.now() + 30;
        while (row < NZ && performance.now() < tEnd) {
          const z = Z0 + row * STEP, k0 = row * NX;
          for (let i = 0; i < NX; i++) { hm[k0 + i] = heightAt(X0 + i * STEP, z, o); bn[k0 + i] = Math.min(255, o.burn * 200); sd[k0 + i] = o.sand * 255; }
          row++;
        }
        if (onProgress) onProgress(row / NZ);
        if (row < NZ) { setTimeout(step, 0); return; }
        T.hm = hm; T.burn = bn; T.sand = sd; T.ready = true; T.ms = performance.now() - t0;
        if (onDone) onDone();
      };
      step();
    },
    generateSync() {
      if (T.hm) return;
      const t0 = performance.now();
      prepLand();
      const hm = new Float32Array(NX * NZ), bn = new Uint8Array(NX * NZ), sd = new Uint8Array(NX * NZ), o = {};
      for (let row = 0; row < NZ; row++) { const z = Z0 + row * STEP, k0 = row * NX; for (let i = 0; i < NX; i++) { hm[k0 + i] = heightAt(X0 + i * STEP, z, o); bn[k0 + i] = Math.min(255, o.burn * 200); sd[k0 + i] = o.sand * 255; } }
      T.hm = hm; T.burn = bn; T.sand = sd; T.ready = true; T.ms = performance.now() - t0;
    },
    // la altura del suelo, igual que la malla de cerca (los mismos triángulos)
    ground(x, z) {
      if (!T.hm) return 0;
      let fx = (x - X0) / STEP, fz = (z - Z0) / STEP;
      fx = Math.max(0, Math.min(NX - 1.001, fx)); fz = Math.max(0, Math.min(NZ - 1.001, fz));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * NX + i, hm = T.hm;
      const a = hm[k], b = hm[k + 1], c = hm[k + NX], d = hm[k + NX + 1];
      // (la diagonal de la malla: de (i+1, j) a (i, j+1))
      return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    },
    // la pendiente (m de subida por m) en un punto
    slope(x, z) {
      const e = STEP;
      const dx = (T.ground(x + e, z) - T.ground(x - e, z)) / (2 * e), dz = (T.ground(x, z + e) - T.ground(x, z - e)) / (2 * e);
      return Math.hypot(dx, dz);
    },
    water(x, z) {
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r && T.ground(x, z) < LAKE.y) return LAKE.y;
      return SEA;
    },
    inMap: (x, z) => x >= 0 && x <= MAP.w && z >= 0 && z <= MAP.h,
    // (el ruido, para quien lo quiera: el color del suelo)
    noise: (x, z) => N2(x, z), fbm: (x, z, o) => fbm(N1, x, z, o || 2)
  };
  G.Terra = T;
})();

// ---------------- El dibujo del terreno grande: bloques con nivel de detalle ----------------
// Bloques grandes de 512 m (de lejos: un punto cada 32 m) que de cerca se parten en 16 de 128 m (un punto cada
// 4, 8 o 16 m según la distancia). Faldones en los bordes de cada bloque: tapan las rendijas entre niveles.
// Una sola malla por bloque visible y un solo material (colores por vértice): pocas llamadas de dibujo.
(function () {
  'use strict';
  const G = window.Game = window.Game || {};
  const T = G.Terra;
  const BUDGET_MS = 6;                              // lo que se arma por fotograma (lo demás espera su turno)
  let scene = null, mat = null, group = null, sea = null, lake = null;
  let built = 0, tris = 0, calls = 0;
  const idxCache = {};

  // los colores: hierba seca dorada, ceniza, tierra, roca, arena
  const C = {
    grass: [0.44, 0.45, 0.32], gold: [0.57, 0.52, 0.36], dry: [0.52, 0.46, 0.36], dead: [0.40, 0.37, 0.31], ash: [0.31, 0.30, 0.28], burnt: [0.21, 0.20, 0.19],
    dirt: [0.43, 0.37, 0.30], rock: [0.46, 0.44, 0.41], rock2: [0.35, 0.34, 0.32], peak: [0.60, 0.59, 0.57], sand: [0.63, 0.59, 0.50], wet: [0.40, 0.38, 0.33]
  };
  // (el motor trabaja en lineal: los colores de arriba están en sRGB, como se eligen a ojo)
  for (const k in C) C[k] = C[k].map((v) => Math.pow(v, 2.2));
  const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  // índices (los mismos para todos los bloques de n x n tramos, con faldones)
  function indexFor(n) {
    if (idxCache[n]) return idxCache[n];
    const V = n + 1, idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);                      // (la diagonal de b a c: la misma que T.ground)
    }
    // faldones: cada borde, hacia abajo, mirando hacia fuera (norte y este en un sentido; sur y oeste, al revés)
    const base = V * V, edges = [];
    for (let i = 0; i <= n; i++) edges.push(i);                        // norte
    for (let i = 0; i <= n; i++) edges.push(n * V + i);                // sur
    for (let j = 0; j <= n; j++) edges.push(j * V);                    // oeste
    for (let j = 0; j <= n; j++) edges.push(j * V + n);                // este
    for (let e = 0; e < 4; e++) for (let i = 0; i < n; i++) {
      const k = e * (n + 1) + i, a = edges[k], b = edges[k + 1], a2 = base + k, b2 = base + k + 1;
      if (e === 0 || e === 3) idx.push(a, b, a2, b, b2, a2);
      else idx.push(a, a2, b, b, a2, b2);
    }
    const arr = new Uint16Array(idx);
    idxCache[n] = new THREE.BufferAttribute(arr, 1);
    return idxCache[n];
  }
  // una malla: origen (ox, oz) en metros, lado S, paso st
  function buildGeo(ox, oz, S, st) {
    const n = S / st, V = n + 1, hm = T.hm, bn = T.burn, NX = T.NX, NZ = T.NZ, k = st / T.STEP;
    const nv = V * V + 4 * V;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Uint8Array(nv * 3);
    const i0 = Math.round((ox - T.X0) / T.STEP), j0 = Math.round((oz - T.Z0) / T.STEP);
    const H = (i, j) => hm[Math.max(0, Math.min(NZ - 1, j)) * NX + Math.max(0, Math.min(NX - 1, i))];
    const c = [0, 0, 0], tmp = [0, 0, 0];
    let ymin = Infinity, ymax = -Infinity;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const gi = i0 + i * k, gj = j0 + j * k, v = j * V + i, h = H(gi, gj);
      pos[v * 3] = ox + i * st; pos[v * 3 + 1] = h; pos[v * 3 + 2] = oz + j * st;
      if (h < ymin) ymin = h; if (h > ymax) ymax = h;
      // la normal (con el paso de este nivel: de lejos, más suave)
      const dx = (H(gi + k, gj) - H(gi - k, gj)) / (2 * st), dz = (H(gi, gj + k) - H(gi, gj - k)) / (2 * st);
      const il = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      nor[v * 3] = -dx * il; nor[v * 3 + 1] = il; nor[v * 3 + 2] = -dz * il;
      // el color
      const slope = Math.sqrt(dx * dx + dz * dz), x = ox + i * st, z = oz + j * st;
      const burn = bn[Math.max(0, Math.min(NZ - 1, gj)) * NX + Math.max(0, Math.min(NX - 1, gi))] / 200;
      // manchas grandes (campos dorados, hierba muerta, verde que resiste) y finas
      const big = T.fbm(x / 260, z / 260, 3), mid = T.noise(x / 70 + 7.7, z / 70 - 2.2), nz2 = hash(Math.floor(x / 6) + 91, Math.floor(z / 6) - 37);
      mix3(c, C.grass, C.gold, sm(-0.15, 0.3, big));
      mix3(c, c, C.dead, sm(0.1, 0.55, mid) * 0.7);
      mix3(c, c, C.dry, sm(0.6, 1.0, nz2) * 0.35);
      if (burn > 0) mix3(c, c, burn > 0.75 ? C.burnt : C.ash, Math.min(1, burn) * 0.85);
      mix3(c, c, C.dirt, sm(0.25, 0.55, slope) * 0.6);
      mix3(c, c, nz2 > 0.5 ? C.rock : C.rock2, sm(0.55, 0.95, slope));
      if (h > 150) mix3(c, c, C.peak, sm(150, 300, h) * 0.7);
      // la arena de la playa (y mojada junto al agua, y bajo ella)
      const sandK = T.sand ? T.sand[Math.max(0, Math.min(NZ - 1, gj)) * NX + Math.max(0, Math.min(NX - 1, gi))] / 255 : 0;
      if (sandK > 0) { mix3(c, c, C.sand, sandK * (1 - sm(0.5, 0.9, slope))); mix3(c, c, C.wet, sm(1.4, -0.4, h) * sandK * 0.8); }
      // (variación fina para que no quede plano)
      const f = 0.9 + nz2 * 0.14 + mid * 0.06;
      col[v * 3] = Math.min(255, c[0] * f * 255); col[v * 3 + 1] = Math.min(255, c[1] * f * 255); col[v * 3 + 2] = Math.min(255, c[2] * f * 255);
    }
    // los faldones: los vértices del borde, más abajo
    const drop = Math.max(6, st * 1.5);
    const edgeV = [];
    for (let i = 0; i <= n; i++) edgeV.push(i);
    for (let i = 0; i <= n; i++) edgeV.push(n * V + i);
    for (let j = 0; j <= n; j++) edgeV.push(j * V);
    for (let j = 0; j <= n; j++) edgeV.push(j * V + n);
    for (let e = 0; e < edgeV.length; e++) {
      const s0 = edgeV[e], d0 = V * V + e;
      pos[d0 * 3] = pos[s0 * 3]; pos[d0 * 3 + 1] = pos[s0 * 3 + 1] - drop; pos[d0 * 3 + 2] = pos[s0 * 3 + 2];
      nor[d0 * 3] = nor[s0 * 3]; nor[d0 * 3 + 1] = nor[s0 * 3 + 1]; nor[d0 * 3 + 2] = nor[s0 * 3 + 2];
      col[d0 * 3] = col[s0 * 3]; col[d0 * 3 + 1] = col[s0 * 3 + 1]; col[d0 * 3 + 2] = col[s0 * 3 + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setIndex(indexFor(n));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(ox, ymin - drop, oz), new THREE.Vector3(ox + S, ymax, oz + S));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(ox + S / 2, (ymin + ymax) / 2, oz + S / 2), Math.hypot(S / 2, S / 2, (ymax - ymin) / 2 + drop));
    g.userData = { tris: n * n * 2 + 4 * n * 2, ymin, ymax };
    return g;
  }
  // distancia de la cámara a una caja (en 3D)
  function boxDist(p, x0, z0, S, y0, y1) {
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + S)), dz = Math.max(z0 - p.z, 0, p.z - (z0 + S)), dy = Math.max(y0 - p.y, 0, p.y - y1);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function mkMesh(g) {
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.terra = true;
    return m;
  }

  // El árbol de bloques: cada bloque tiene siempre 16 x 16 tramos (512 triángulos); el de 512 m va a 32 m por
  // punto, el de 256 a 16, el de 128 a 8 y el de 64 (la hoja) a 4. Un bloque se parte en sus cuatro hijos cuando la
  // cámara está a menos de SPLIT veces su lado (y los hijos ya están armados; si no, se dibuja él mientras tanto)
  const N = 16, SPLIT = 1.25, LEAF = 64;
  let roots = [], drawn = [], nodes = 0, queue = 0, splitK = SPLIT;
  // (con la calidad gráfica: en «baja» los bloques finos llegan menos lejos)
  const qualK = () => { const q = G.Quality && G.Quality.cur; return q && q.far ? Math.max(0.8, Math.min(1.15, q.far / 95)) : 1; };
  function mkNode(ox, oz, S, parent) {
    return { ox, oz, S, geo: null, mesh: null, kids: null, y0: parent ? parent.y0 : -40, y1: parent ? parent.y1 : 500, used: 0 };
  }
  function ensure(n) {
    n.geo = buildGeo(n.ox, n.oz, n.S, n.S / N); built++; nodes++;
    n.y0 = n.geo.userData.ymin; n.y1 = n.geo.userData.ymax;
  }
  // recorrer: dibuja este bloque o sus hijos
  function visit(n, p, t0, budget, now) {
    n.used = now;
    if (n.S > LEAF && boxDist(p, n.ox, n.oz, n.S, n.y0, n.y1) < n.S * splitK) {
      if (!n.kids) { const h = n.S / 2; n.kids = [mkNode(n.ox, n.oz, h, n), mkNode(n.ox + h, n.oz, h, n), mkNode(n.ox, n.oz + h, h, n), mkNode(n.ox + h, n.oz + h, h, n)]; }
      let ready = true;
      for (const k of n.kids) if (!k.geo) { if (performance.now() - t0 < budget) ensure(k); else { ready = false; queue++; } }
      if (ready) { for (const k of n.kids) visit(k, p, t0, budget, now); return; }
    }
    if (!n.mesh) { n.mesh = mkMesh(n.geo); group.add(n.mesh); }
    n.mesh.visible = true; drawn.push(n);
    tris += n.geo.userData.tris; calls++;
  }
  // lo que lleva tiempo sin usarse (bloques finos que quedaron lejos), fuera: la memoria del teléfono
  function prune(n, now) {
    if (!n.kids) return;
    for (const k of n.kids) prune(k, now);
    if (n.kids.every((k) => !k.kids && now - k.used > 20000)) {
      for (const k of n.kids) { if (k.mesh) group.remove(k.mesh); if (k.geo) { k.geo.dispose(); nodes--; } }
      n.kids = null;
    }
  }


  // ---------------- El agua: la de las playas de Oceanside ----------------
  // El mismo color y transparencia; cerca de la cámara, un trozo con oleaje suave, destellos del sol y la espuma
  // que sube por la arena (tres franjas, a lo largo de la orilla de verdad). Lejos, un plano quieto. El río y el lago
  const WCOL = 0x46524f, PATCH = 360, PSEG = 60, SNAP = 30, FOAM_R = 130, FOAM_MAX = 900;
  let W = null;
  function addWater() {
    const wm = new THREE.MeshLambertMaterial({ color: WCOL, transparent: true, opacity: 0.95 });
    const wFar = new THREE.MeshLambertMaterial({ color: WCOL });
    W = { mats: [wm, wFar], cx: NaN, cz: NaN, fx: NaN, fz: NaN, t: 0 };
    sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 1, 1), wFar);
    sea.rotation.x = -Math.PI / 2; sea.position.set(T.MAP.w / 2, T.SEA + 0.06, T.MAP.h / 2); sea.receiveShadow = true;
    sea.updateMatrix(); sea.matrixAutoUpdate = false;
    group.add(sea);
    // el trozo de cerca, con oleaje
    const pg = new THREE.PlaneGeometry(PATCH, PATCH, PSEG, PSEG); pg.rotateX(-Math.PI / 2);
    W.patch = new THREE.Mesh(pg, wm); W.patch.receiveShadow = true; W.patch.frustumCulled = false; W.patch.renderOrder = 1;
    W.pbase = Float32Array.from(pg.attributes.position.array);
    group.add(W.patch);
    // el lago
    lake = new THREE.Mesh(new THREE.CircleGeometry(T.LAKE.r, 56), wm);
    lake.rotation.x = -Math.PI / 2; lake.position.set(T.LAKE.x, T.LAKE.y, T.LAKE.z); lake.receiveShadow = true;
    lake.updateMatrix(); lake.matrixAutoUpdate = false;
    group.add(lake);
    // el río: una cinta por el fondo del cauce, del lago al mar
    const R = T.RIVER, pos = [], idx = [];
    let k = 0;
    for (let s0 = 0; s0 <= R.len; s0 += 8) {
      let i = 1; while (i < R.acc.length - 1 && R.acc[i] < s0) i++;
      const a = R.pts[i - 1], b = R.pts[i], t = Math.min(1, (s0 - R.acc[i - 1]) / (R.acc[i] - R.acc[i - 1]));
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, dl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / dl, nz = (b[0] - a[0]) / dl, y = R.y0 + (R.y1 - R.y0) * (s0 / R.len) + 0.55;
      pos.push(x + nx * 12, y, z + nz * 12, x - nx * 12, y, z - nz * 12);
      if (k) idx.push((k - 1) * 2, k * 2, (k - 1) * 2 + 1, (k - 1) * 2 + 1, k * 2, k * 2 + 1);
      k++;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
    // (la normal, hacia arriba aunque el orden de los vértices diga otra cosa)
    const rn = rg.attributes.normal; for (let i = 0; i < rn.count; i++) rn.setXYZ(i, 0, 1, 0);
    W.river = new THREE.Mesh(rg, wm); W.river.receiveShadow = true;
    group.add(W.river);
    // la espuma (tres franjas) y los destellos
    const fm = new THREE.MeshBasicMaterial({ color: 0xece4d4, transparent: true, opacity: 0.5, depthWrite: false });
    W.foam = [];
    for (let b = 0; b < 3; b++) {
      const g = new THREE.BufferGeometry(), arr = new Float32Array(FOAM_MAX * 4 * 3), ii = new Uint16Array(FOAM_MAX * 6);
      for (let q = 0; q < FOAM_MAX; q++) ii.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.setIndex(new THREE.BufferAttribute(ii, 1)); g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, b ? fm.clone() : fm); m.frustumCulled = false; m.renderOrder = 2;
      W.mats.push(m.material);
      group.add(m);
      W.foam.push({ m, g, ph: b / 3 });
    }
    W.seg = [];       // los tramos de orilla de cerca: [x0, z0, x1, z1, ux0, uz0, ux1, uz1] (u: hacia tierra)
    const gm = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, depthWrite: false }); gm.toneMapped = false;
    W.mats.push(gm);
    W.glints = [];
    for (let i = 0; i < 40; i++) {
      const gg = new THREE.Mesh(new THREE.PlaneGeometry(0.8 + Math.random() * 2.6, 0.08), gm.clone());
      gg.rotation.x = -Math.PI / 2; gg.visible = false; gg.renderOrder = 2;
      W.mats.push(gg.material);
      group.add(gg); W.glints.push({ m: gg, ph: Math.random() * 9, sp: 0.6 + Math.random() * 1.5 });
    }
  }
  // la orilla cerca de (cx, cz): dónde la altura cruza el nivel del mar (cuadrados que marchan, en la rejilla de 4 m)
  function shoreNear(cx, cz) {
    const st = T.STEP, hm = T.hm, NX = T.NX, out = [];
    const i0 = Math.max(1, Math.floor((cx - FOAM_R - T.X0) / st)), i1 = Math.min(T.NX - 2, Math.ceil((cx + FOAM_R - T.X0) / st));
    const j0 = Math.max(1, Math.floor((cz - FOAM_R - T.Z0) / st)), j1 = Math.min(T.NZ - 2, Math.ceil((cz + FOAM_R - T.Z0) / st));
    const L = 0.12;           // (el nivel de la orilla: el del agua de cerca)
    const up = (x, z) => { const e = 3, gx = T.ground(x + e, z) - T.ground(x - e, z), gz = T.ground(x, z + e) - T.ground(x, z - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
    for (let j = j0; j < j1 && out.length < FOAM_MAX; j++) for (let i = i0; i < i1 && out.length < FOAM_MAX; i++) {
      const a = hm[j * NX + i] - L, b = hm[j * NX + i + 1] - L, c = hm[(j + 1) * NX + i] - L, d = hm[(j + 1) * NX + i + 1] - L;
      const pts = [];
      const x0 = T.X0 + i * st, z0 = T.Z0 + j * st;
      if ((a > 0) !== (b > 0)) pts.push([x0 + st * a / (a - b), z0]);
      if ((c > 0) !== (d > 0)) pts.push([x0 + st * c / (c - d), z0 + st]);
      if ((a > 0) !== (c > 0)) pts.push([x0, z0 + st * a / (a - c)]);
      if ((b > 0) !== (d > 0)) pts.push([x0 + st, z0 + st * b / (b - d)]);
      if (pts.length < 2) continue;
      const p = pts[0], q = pts[1], u0 = up(p[0], p[1]), u1 = up(q[0], q[1]);
      out.push([p[0], p[1], q[0], q[1], u0[0], u0[1], u1[0], u1[1]]);
    }
    return out;
  }
  function updateWater(p, t) {
    if (!W) return;
    const nearSea = p.y < 400;
    W.patch.visible = nearSea;
    // el trozo con oleaje sigue a la cámara (a saltos: las olas no se mueven con ella)
    const cx = Math.round(p.x / SNAP) * SNAP, cz = Math.round(p.z / SNAP) * SNAP;
    if (nearSea) {
      if (cx !== W.cx || cz !== W.cz) {
        W.cx = cx; W.cz = cz; W.patch.position.set(cx, T.SEA, cz);
        // destellos: sobre agua de verdad, cerca
        for (const gq of W.glints) {
          let ok = false;
          for (let k = 0; k < 6 && !ok; k++) { const x = cx + (Math.random() - 0.5) * 160, z = cz + (Math.random() - 0.5) * 160; if (T.ground(x, z) < -0.5) { gq.m.position.set(x, T.SEA + 0.22, z); ok = true; } }
          gq.m.visible = ok;
        }
      }
      const P = W.patch.geometry.attributes.position, B = W.pbase;
      for (let i = 0; i < P.count; i++) {
        const x = B[i * 3] + cx, z = B[i * 3 + 2] + cz;
        P.array[i * 3 + 1] = 0.12 + Math.sin(x * 0.21 + t * 1.1) * 0.06 + Math.sin(z * 0.17 - t * 0.8) * 0.07;
      }
      P.needsUpdate = true;
      for (const gq of W.glints) if (gq.m.visible) gq.m.material.opacity = 0.55 * Math.max(0, Math.sin(t * gq.sp + gq.ph)) ** 3;
    } else for (const gq of W.glints) gq.m.visible = false;
    // la espuma: la orilla de cerca se recalcula al moverse; las franjas suben por la arena y se apagan
    const fx = Math.round(p.x / 24) * 24, fz = Math.round(p.z / 24) * 24;
    if (fx !== W.fx || fz !== W.fz) { W.fx = fx; W.fz = fz; W.seg = p.y - T.ground(p.x, p.z) < 160 ? shoreNear(p.x, p.z) : []; }
    for (const f of W.foam) {
      const n = W.seg.length;
      f.g.setDrawRange(0, n * 6);
      if (!n) continue;
      const u = (t * 0.09 + f.ph) % 1, off = -1.2 + u * 6.5, A = f.g.attributes.position.array;
      for (let q = 0; q < n; q++) {
        const sg = W.seg[q];
        for (let e = 0; e < 2; e++) {
          const x = sg[e * 2], z = sg[e * 2 + 1], ux = sg[4 + e * 2], uz = sg[5 + e * 2];
          for (let w = 0; w < 2; w++) {
            const o = off + w * 1.1, px = x + ux * o, pz = z + uz * o, k = (q * 4 + e * 2 + w) * 3;
            A[k] = px; A[k + 1] = Math.max(0.2, T.ground(px, pz) + 0.05); A[k + 2] = pz;
          }
        }
      }
      f.g.attributes.position.needsUpdate = true;
      f.m.material.opacity = 0.55 * Math.sin(Math.PI * u);
    }
  }

  // ---------------- Lo lejano: cordilleras en el horizonte (para que se sienta inmenso) ----------------
  // Un anillo que sigue a la cámara (está «en el infinito»): al norte y al este, montes enormes y nevados (lo que
  // queda de las Tierras Intermedias); al sur y al oeste, islas bajas. Sin niebla propia: ya viene teñido de bruma
  let HZ = null;
  function addHorizon() {
    const R1 = 4400, R2 = 3900, SEG = 200, pos = [], meta = [], idx = [];
    const ridge = (a, layer) => {
      // dónde hay montes (ángulo 0: hacia +z, el sur; PI: el norte; PI/2: el este)
      const north = Math.max(0, -Math.cos(a)), east = Math.max(0, Math.sin(a)) * Math.max(0, -Math.cos(a) + 0.6);
      const amp = layer ? 160 + north * 520 + east * 360 : 260 + north * 1150 + east * 650;
      const n = T.fbm(a * 3.1 + layer * 7, layer * 3, 3) * 0.5 + 0.5, nn = T.noise(a * 11 + layer, 2.5) * 0.5 + 0.5;
      return Math.max(20, amp * (0.3 + n * 0.55 + nn * 0.15));
    };
    // tres filas por capa: el pie (bruma), la ladera (roca) y la cumbre (roca o nieve)
    let v = 0;
    for (const [L, R] of [[0, R1], [1, R2]]) {
      for (let i = 0; i <= SEG; i++) {
        const a = i / SEG * Math.PI * 2, h = ridge(a, L), sx = Math.sin(a) * R, sz = Math.cos(a) * R;
        pos.push(sx, -260, sz, sx, h * 0.62, sz, sx, h, sz);
        meta.push([L, 0, h], [L, 1, h], [L, 2, h]);
        if (i) for (const r of [0, 1]) {
          const a0 = v + (i - 1) * 3 + r, b0 = v + i * 3 + r;
          idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
        }
      }
      v += (SEG + 1) * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = -10; m.frustumCulled = false;
    HZ = { mesh: m, meta, fog: null };
    group.add(m);
  }
  function updateHorizon(p) {
    if (!HZ) return;
    HZ.mesh.position.set(p.x, p.y * 0.92, p.z);          // (a la altura de la mirada: está «en el infinito»)
    // el color: el de la niebla del momento, con la roca y la nieve desvaídas encima (más en la capa de lejos)
    const fc = scene.fog ? scene.fog.color : null;
    if (!fc || (HZ.fog && HZ.fog.equals(fc))) return;
    HZ.fog = fc.clone();
    const C2 = HZ.mesh.geometry.attributes.color;
    const rock = new THREE.Color(0x46505e).convertSRGBToLinear(), snow = new THREE.Color(0xd8dde2).convertSRGBToLinear(), t = new THREE.Color();
    for (let i = 0; i < C2.count; i++) {
      const [L, row, h] = HZ.meta[i];
      if (row === 0) { C2.setXYZ(i, fc.r, fc.g, fc.b); continue; }
      const thr = L ? 420 : 820, sn = row === 2 ? Math.max(0, Math.min(1, (h - thr) / (thr * 0.5))) : 0;
      t.copy(rock).lerp(snow, sn).lerp(fc, (L ? 0.42 : 0.6) + (row === 1 ? 0.12 : 0));
      C2.setXYZ(i, t.r, t.g, t.b);
    }
    C2.needsUpdate = true;
  }

  const View = {
    get active() { return !!group; },
    get stats() { return { built, tris, calls, nodes, queue }; },
    // montar (con el terreno ya generado)
    init(sc) {
      View.dispose();
      scene = sc;
      mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      group = new THREE.Group(); group.name = 'terra';
      scene.add(group);
      addWater();
      addHorizon();
      // las raíces: 7 x 6 bloques de 512 m (siempre armados)
      roots = []; nodes = 0; built = 0;
      for (let bz = 0; bz < T.DH / T.BIG; bz++) for (let bx = 0; bx < T.DW / T.BIG; bx++) {
        const n = mkNode(T.X0 + bx * T.BIG, T.Z0 + bz * T.BIG, T.BIG, null);
        ensure(n); roots.push(n);
      }
    },
    // cada fotograma: qué bloques se dibujan (lo que no esté armado, se arma por turnos)
    update(cam, force) {
      if (!group) return;
      const p = cam.position, t0 = performance.now(), now = t0;
      updateWater(p, now / 1000);
      updateHorizon(p);
      for (const n of drawn) if (n.mesh) n.mesh.visible = false;
      drawn = []; tris = 0; calls = 2; queue = 0; splitK = SPLIT * qualK();
      const budget = force ? Infinity : BUDGET_MS;
      for (const r of roots) visit(r, p, t0, budget, now);
      if (!force && (View._gc = (View._gc || 0) + 1) % 180 === 0) for (const r of roots) prune(r, now);
    },
    dispose() {
      if (!group) return;
      scene.remove(group);
      group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      const free = (n) => { if (n.geo) n.geo.dispose(); if (n.kids) n.kids.forEach(free); };
      roots.forEach(free);
      if (mat) mat.dispose();
      if (W) { for (const m of W.mats) m.dispose(); W = null; }
      if (HZ) { HZ.mesh.material.dispose(); HZ = null; }
      roots = []; drawn = []; group = null; sea = null; lake = null; mat = null;
    }
  };
  G.TerraView = View;
})();
