// El modo supervivencia, segunda vuelta (2026-11): el mundo grande (G.Terra / G.TerraView, 2,5 x 2 km con forma de
// Limgrave). Por ahora solo el terreno: sin árboles, de día y despejado. El supervivencia de antes (G.Surv) sigue
// en el código, dormido: Mundo.ON = false lo devuelve tal cual (y hay copia de seguridad del proyecto).
// G.Fly: volar en el modo desarrollador (Opciones > Volar): quieta, sin animación, hacia donde mira la cámara.
(function () {
  'use strict';
  const G = window.Game = window.Game || {};
  const KEY = 'ceniza.mundo';
  // dónde se empieza (como el primer paso de Limgrave: al oeste, en una loma mirando a la llanura)
  const SPAWN = { x: 540, z: 830, face: Math.PI * 0.5 };
  let host = null, saveT = 0;
  const FOG = [300, 2800, 5200];          // (la de MAPS.mundo.farView: niebla cerca, lejos y el plano lejano)

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save() {
    const p = host && host.player;
    if (!p || !Mundo.active) return;
    try { localStorage.setItem(KEY, JSON.stringify({ x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), face: +p.facing.toFixed(2) })); } catch (e) { /* nada */ }
  }
  // un sitio donde se pueda estar de pie (tierra, sin agua y sin pared de roca), cerca de (x, z)
  function standable(x, z) {
    const T = G.Terra;
    const ok = (a, b) => T.inMap(a, b) && T.ground(a, b) > T.water(a, b) + 0.6 && T.slope(a, b) < 0.5;
    if (ok(x, z)) return { x, z };
    for (let r = 4; r < 400; r += 4) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  const Mundo = {
    ON: true,                      // (false: el modo supervivencia de antes)
    active: false,
    init(h) { host = h; },
    get saved() { return !!load(); },
    // empezar (detrás de la pantalla de carga): generar, montar, poner a la protagonista
    start(cont) {
      const T = G.Terra, t0 = performance.now();
      T.generateSync();
      const tGen = performance.now() - t0;
      host.map('mundo');
      G.TerraView.init(host.scene);
      if (G.TerraTrees) G.TerraTrees.init(host.scene);
      const sv = cont ? load() : null;
      if (!cont) { try { localStorage.removeItem(KEY); } catch (e) { /* nada */ } }
      const at = standable(sv ? sv.x : SPAWN.x, sv ? sv.z : SPAWN.z);
      Mundo.active = true;
      host.place(at.x, at.z, sv ? sv.face : SPAWN.face);
      if (G.Sky) { G.Sky.set(13.5, 'despejado'); G.Sky.fixHour(true); }
      // lo de alrededor, ya armado (la pantalla de carga sigue delante)
      const p = host.player;
      G.TerraView.update({ position: { x: p.pos.x, y: p.y + 2, z: p.pos.z } }, true);
      if (G.TerraTrees) G.TerraTrees.update({ x: p.pos.x, y: p.y, z: p.pos.z }, FOG[0], FOG[1], true);
      Mundo.tGen = tGen; Mundo.tAll = performance.now() - t0;
      saveT = 0;
      setTimeout(() => { if (Mundo.active && host.toast) host.toast('El mundo · 2,5 x 2 km' + (G.DEV ? ' · Opciones > Volar para verlo desde arriba' : ''), 'good'); }, 1200);
    },
    // cada fotograma (después de la cámara): el terreno al nivel que toca, y la posición guardada de vez en cuando
    update(dt, camera) {
      if (!Mundo.active) return;
      // desde arriba se ve más lejos: la niebla (y el plano lejano) se alejan con la altura sobre el suelo
      const T = G.Terra, cp = camera.position, alt = Math.max(0, cp.y - Math.max(T.SEA, T.ground(cp.x, cp.z)));
      const near = FOG[0] + alt * 1.2, far = FOG[1] + alt * 2.2;
      if (G.Sky) G.Sky.setFogBase(near, far);
      const cf = Math.min(14000, Math.max(FOG[2], far + 900));
      if (Math.abs(camera.far - cf) > 50) { camera.far = cf; camera.updateProjectionMatrix(); }
      G.TerraView.update(camera);
      if (G.TerraTrees) G.TerraTrees.update(cp, near, far);
      if ((saveT += dt) > 5) { saveT = 0; save(); }
    },
    stop() {
      if (!Mundo.active) return;
      save();
      Mundo.active = false;
      G.TerraView.dispose();
      if (G.TerraTrees) G.TerraTrees.dispose();
    },
    quit() { Mundo.stop(); }
  };

  // ---------------- Volar (modo desarrollador) ----------------
  const FLY_KEY = 'ceniza.volar';
  let flyPref = (() => { try { return localStorage.getItem(FLY_KEY) === '1'; } catch (e) { return false; } })();
  const vel = { x: 0, y: 0, z: 0 };
  const Fly = {
    get pref() { return flyPref; },
    set(on) { flyPref = !!on; try { localStorage.setItem(FLY_KEY, flyPref ? '1' : '0'); } catch (e) { /* nada */ } },
    // ¿se vuela ahora? (solo en el modo desarrollador)
    get on() { return flyPref && !!G.DEV; },
    speed: 0,
    // mover: el joystick, hacia donde mira la cámara (también hacia arriba o abajo); Correr, mucho más rápido
    update(dt, p, input, cam) {
      const d = cam.dir || { x: Math.sin(cam.yaw), y: 0, z: Math.cos(cam.yaw) };
      const hl = Math.hypot(d.x, d.z) || 1;
      const fx = d.x / hl, fz = d.z / hl, rx = -fz, rz = fx;
      const mx = input.move ? input.move.x : 0, my = input.move ? -input.move.y : 0;
      // (la cámara mira un poco hacia abajo siempre: un margen para que avanzar recto no baje)
      let dy = d.y; if (Math.abs(dy) < 0.12) dy = 0; else dy -= Math.sign(dy) * 0.12;
      const sp = input.run ? 190 : 45;
      const tx = (fx * my + rx * mx) * sp, tz = (fz * my + rz * mx) * sp, ty = dy * my * sp * 1.4;
      const k = Math.min(1, dt * 4);
      vel.x += (tx - vel.x) * k; vel.y += (ty - vel.y) * k; vel.z += (tz - vel.z) * k;
      p.pos.x += vel.x * dt; p.pos.z += vel.z * dt; p.y += vel.y * dt;
      // (dentro del mundo dibujado, y nunca bajo el suelo)
      const T = G.Terra;
      if (T && T.hm) {
        p.pos.x = Math.max(T.X0 + 40, Math.min(T.X0 + T.DW - 40, p.pos.x));
        p.pos.z = Math.max(T.Z0 + 40, Math.min(T.Z0 + T.DH - 40, p.pos.z));
        p.y = Math.max(T.ground(p.pos.x, p.pos.z) + 0.5, Math.min(1600, p.y));
      } else p.y = Math.max(0, p.y);
      if (Math.abs(mx) + Math.abs(my) > 0.1) p.facing = Math.atan2(fx, fz);
      if (p.vel) { p.vel.x = 0; p.vel.z = 0; }
      Fly.speed = Math.hypot(vel.x, vel.y, vel.z);
    },
    // la pose, quieta: solo se mueve el cuerpo entero
    pose(p) {
      const m = p.model;
      if (!m) return;
      m.root.position.set(p.pos.x, p.y, p.pos.z);
      m.root.rotation.y = p.facing;
    },
    // la lectura de arriba: dónde estás (en km) y a qué altura
    readout(p) {
      const T = G.Terra, g = T && T.hm ? T.ground(p.pos.x, p.pos.z) : 0;
      return 'Volando · x ' + (p.pos.x / 1000).toFixed(2) + ' km · z ' + (p.pos.z / 1000).toFixed(2) + ' km · altura ' + Math.round(p.y) + ' m (' + Math.round(p.y - g) + ' sobre el suelo) · ' + Math.round(Fly.speed * 3.6) + ' km/h';
    }
  };

  G.Mundo = Mundo;
  G.Fly = Fly;
})();
