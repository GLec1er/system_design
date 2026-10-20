// Окто в 3D: робот-осьминог из керамики с тёмными суставами и янтарными огнями.
// Модель собирается из примитивов three.js, щупальца анимируются цепочкой суставов.
// Пока модуль грузится (или если WebGL нет), видна статичная картинка img/octo.png, снятая с этой же модели.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const C = { shell: 0xf0e2c6, dark: 0x262c2f, visor: 0x15191b, amber: 0xffad42, iris: 0xf3a640 };

function build() {
  const ceramic = new THREE.MeshPhysicalMaterial({ color: C.shell, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: C.dark, roughness: 0.55, metalness: 0.25 });
  const glass = new THREE.MeshPhysicalMaterial({ color: C.visor, roughness: 0.15, metalness: 0.4, clearcoat: 1 });
  const glow = new THREE.MeshStandardMaterial({ color: C.amber, emissive: C.amber, emissiveIntensity: 1.6, roughness: 0.4 });
  const root = new THREE.Group();

  // ---------- голова ----------
  const head = new THREE.Group();
  head.position.y = 1.15;
  root.add(head);
  const skull = new THREE.Group();
  skull.scale.set(1, 1.08, 0.95);
  head.add(skull);
  skull.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), ceramic));
  // тёмная полоса через макушку, как у Py на голове
  const stripe = (phi, from, len) => new THREE.Mesh(new THREE.SphereGeometry(1.012, 32, 24, phi - 0.2, 0.4, from, len), dark);
  skull.add(stripe(Math.PI / 2, 0, 0.95), stripe(-Math.PI / 2, 0, 0.9));
  // визор вокруг лица
  skull.add(new THREE.Mesh(new THREE.SphereGeometry(1.022, 64, 16, Math.PI / 2 - 1.05, 2.1, 1.42, 0.42), glass));
  // воротник, к которому крепятся щупальца
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.11, 16, 48), dark);
  collar.rotation.x = Math.PI / 2; collar.position.y = -0.74;
  head.add(collar);
  // шов панелей и боковые огни
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.012, 8, 64), dark);
  seam.rotation.x = Math.PI / 2; seam.position.y = 0.38;
  head.add(seam);
  [-1, 1].forEach((s) => {
    const led = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), glow);
    led.position.set(s * 0.86, 0.5, 0.36); led.rotation.z = s * 0.7; led.rotation.y = s * 0.5;
    head.add(led);
  });
  // глаза за визором
  const eyes = new THREE.Group();
  head.add(eyes);
  const iris = new THREE.MeshStandardMaterial({ color: 0xf39a2a, emissive: 0xc8620a, emissiveIntensity: 0.6, roughness: 0.2 });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.3 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [-1, 1].forEach((s) => {
    const e = new THREE.Group();
    e.position.set(s * 0.34, -0.09, 0.86);
    e.lookAt(s * 0.9, -0.2, 4);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), iris));
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), pupilM); p.position.z = 0.11; p.scale.set(0.8, 1.05, 0.6); e.add(p);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), shine); h.position.set(-0.05, 0.06, 0.155); e.add(h);
    eyes.add(e);
  });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 8, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5b4a33 }));
  smile.position.set(0, -0.5, 0.86); smile.rotation.z = Math.PI; smile.rotation.x = -0.35;
  head.add(smile);

  // ---------- щупальца ----------
  const N = 8, L = 0.26;
  const arms = [];
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const base = new THREE.Group();
    base.position.set(Math.sin(yaw) * 0.62, 0.42, Math.cos(yaw) * 0.62 * 0.95);
    base.rotation.order = 'YXZ'; base.rotation.y = yaw;
    root.add(base);
    const joints = [];
    let parent = base;
    for (let i = 0; i < N; i++) {
      const j = new THREE.Group();
      if (i) j.position.y = L;
      parent.add(j);
      const r0 = 0.2 - i * 0.014, r1 = r0 - 0.013;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L * 0.78, 20), ceramic);
      seg.position.y = L / 2;
      j.add(seg);
      j.add(new THREE.Mesh(new THREE.SphereGeometry(r0 * 0.98, 20, 12), dark));
      if (i % 2) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r0 * 0.99, 0.012, 6, 24), glow); ring.rotation.x = Math.PI / 2; j.add(ring); }
      joints.push(j);
      parent = j;
    }
    // наконечник: узел сети
    const tip = new THREE.Group(); tip.position.y = L; parent.add(tip);
    tip.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), dark));
    const tr = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 10, 28), glow); tr.rotation.x = Math.PI / 2; tip.add(tr);
    arms.push({ base, joints, yaw, k, lift: 0 });
  }

  // мягкая тень на полу
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,.32)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.05;
  root.add(shadow);

  return { root, head, eyes, arms };
}

// Поза в момент t. wave > 0 поднимает правое боковое щупальце и машет им; cheer > 0 поднимает оба боковых.
function pose(m, t, s) {
  m.root.position.y = Math.sin(t * 1.3) * 0.05;
  m.head.rotation.y = s.lookX * 0.45 + Math.sin(t * 0.5) * 0.06;
  m.head.rotation.x = -s.lookY * 0.25 + Math.sin(t * 0.9) * 0.025;
  m.head.rotation.z = Math.sin(t * 0.7) * 0.03;
  const blink = (t % 4.3) < 0.13 ? 0.15 : 1;
  m.eyes.children.forEach((e) => (e.scale.y = blink));
  m.arms.forEach((a) => {
    const front = a.k === 1 ? 1 : a.k === 6 ? -1 : 0; // 1 и 6 торчат вбок
    const up = front === 1 ? Math.max(s.wave, s.cheer) : front === -1 ? s.cheer : 0;
    a.lift += (up - a.lift) * 0.12;
    const ph = a.k * 0.8;
    // корень щупальца: наружу и вниз, поднятое смотрит вверх
    a.base.rotation.x = THREE.MathUtils.lerp(2.45 + Math.sin(t * 1.1 + ph) * 0.06, 0.8, a.lift);
    a.joints.forEach((j, i) => {
      const q = i / a.joints.length;
      const rest = 0.04 - q * 0.5; // кончики закручиваются наружу
      const swim = Math.sin(t * 1.6 - i * 0.55 + ph) * (0.07 + q * 0.12);
      const hello = Math.sin(t * 7 - i * 0.7) * 0.22 * q;
      if (i) j.rotation.x = THREE.MathUtils.lerp(rest + swim, -0.12 + hello, a.lift);
      j.rotation.z = Math.sin(t * 1.2 + ph + i * 0.3) * 0.03 * (1 - a.lift);
    });
  });
}

function setup(canvas, w, h) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: !!canvas.dataset.still });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a332c, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd29a, 1.8); rim.position.set(-4, 3, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6); fill.position.set(-3, 0, 4); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 50);
  camera.position.set(0, 2.8, 11.2);
  camera.lookAt(0, 0.55, 0);
  const m = build();
  m.root.rotation.y = -0.18;
  scene.add(m.root);
  return { renderer, scene, camera, m };
}

// Статичный кадр для img/octo.png (без анимации и чтобы было что показать до загрузки).
export function still(canvas, w, h, s = { lookX: 0, lookY: 0, wave: 0, cheer: 0 }) {
  canvas.dataset.still = '1';
  const v = setup(canvas, w, h);
  v.renderer.setPixelRatio(1);
  for (let i = 0; i < 60; i++) pose(v.m, 1.2, s); // поднятые щупальца доезжают до позы
  v.renderer.render(v.scene, v.camera);
  return canvas.toDataURL('image/png');
}

// Живой Окто: дышит, плавает щупальцами, следит за мышью и машет при смене шага.
export function mount(host) {
  const canvas = host.querySelector('canvas'), r = host.getBoundingClientRect();
  const v = setup(canvas, Math.round(r.width) || 240, Math.round(r.height) || 224);
  const s = { lookX: 0, lookY: 0, tx: 0, ty: 0, wave: 0, cheer: 0 };
  let t = 0, last = performance.now(), raf = 0, visible = true, waveUntil = 2.5, nextWave = 9;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!visible) return;
    t += dt;
    if (t > nextWave) { waveUntil = t + 2.4; nextWave = t + 10 + Math.random() * 8; }
    s.wave = t < waveUntil ? 1 : 0;
    s.cheer = Math.max(0, s.cheer - dt * 0.6);
    s.lookX += (s.tx - s.lookX) * 0.08; s.lookY += (s.ty - s.lookY) * 0.08;
    pose(v.m, t, s);
    v.renderer.render(v.scene, v.camera);
  };
  raf = requestAnimationFrame(loop);
  new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(host);
  new ResizeObserver(() => {
    const b = host.getBoundingClientRect(); if (!b.width) return;
    v.renderer.setSize(b.width, b.height, false); v.camera.aspect = b.width / b.height; v.camera.updateProjectionMatrix();
  }).observe(host);
  addEventListener('pointermove', (e) => {
    const b = host.getBoundingClientRect();
    s.tx = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (innerWidth / 2)));
    s.ty = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (innerHeight / 2)));
  });
  host.classList.add('live');
  return {
    cheer: () => (s.cheer = 1.6), // поднять оба боковых щупальца
    stop: () => { cancelAnimationFrame(raf); v.renderer.dispose(); host.classList.remove('live'); },
  };
}
