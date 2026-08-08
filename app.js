/**
 * app.js — Glasswave v3
 * Three.js WebGL: REAL liquid glass via two-pass rendering
 * Pass 1 → render animated neon orbs to a RenderTarget
 * Pass 2 → glass panels sample that texture with GLSL Simplex Noise UV distortion
 *           + Chromatic Aberration (RGB channel separation = real glass optics)
 * CSS backdrop-filter on .glass-host elements blurs the WebGL output = frosted liquid glass
 */
'use strict';

/* ══════════════════════════════════════════════════════════════
   GLSL SHADERS
   ══════════════════════════════════════════════════════════════ */

// Glass vertex shader — passes UV + world-space position
const GLASS_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Ashima Arts 2D Simplex Noise (MIT License)
const SIMPLEX_GLSL = `
vec3 _m289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 _m289v(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 _perm(vec3 x){return _m289(((x*34.)+10.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
  i=_m289v(i);
  vec3 p=_perm(_perm(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;
  vec3 ox=floor(x+.5);
  vec3 a=x-ox;
  m*=1.79284291400159-0.85373472095314*(a*a+h*h);
  vec3 g; g.x=a.x*x0.x+h.x*x0.y; g.yz=a.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
`;

// Glass fragment shader:
// Samples bgRT (orbs render) with animated noise UV distortion + chromatic aberration
const GLASS_FRAG = `
${SIMPLEX_GLSL}
precision highp float;
uniform sampler2D uBg;       // Background render target (orbs)
uniform float     uTime;     // Animation time
uniform vec2      uRes;      // Viewport resolution (px)
varying vec2 vUv;

void main() {
  // Screen-space UV — maps exactly to the background texture
  vec2 sc = gl_FragCoord.xy / uRes;

  // Multi-octave animated liquid noise (3 octaves)
  float t = uTime * 0.38;

  // Octave 1 — large slow waves
  float n1 = snoise(sc * 3.8 + vec2(t * 0.6,  t * 0.4));
  float m1 = snoise(sc * 3.8 + vec2(-t* 0.5,  t * 0.7) + vec2(17.3, 31.7));
  // Octave 2 — medium ripples
  float n2 = snoise(sc * 8.5 + vec2(-t* 0.9,  t * 0.55)+ vec2(53.1, 17.9));
  float m2 = snoise(sc * 8.5 + vec2( t * 0.7, -t* 0.8) + vec2(97.3, 53.7));
  // Octave 3 — fine surface detail
  float n3 = snoise(sc *17.0 + vec2( t * 0.35,-t* 0.5) + vec2(71.0, 83.0));
  float m3 = snoise(sc *17.0 + vec2(-t* 0.55, t * 0.32)+ vec2(137., 97.0));

  // FBM combination (weights: 0.58 / 0.28 / 0.14)
  float nx = n1*0.58 + n2*0.28 + n3*0.14;
  float ny = m1*0.58 + m2*0.28 + m3*0.14;

  // Distortion strength — like IOR-driven refraction (tweak this)
  float str = 0.028;
  vec2 d = vec2(nx, ny) * str;

  // ── CHROMATIC ABERRATION ──
  // R, G, B channels sampled at slightly different displacements
  // = REAL optical glass prism effect
  float rCh = texture2D(uBg, sc + d * 1.7).r;
  float gCh = texture2D(uBg, sc + d      ).g;
  float bCh = texture2D(uBg, sc + d * 0.45).b;
  vec3 refracted = vec3(rCh, gCh, bCh);

  // ── FRESNEL EDGE GLOW ──
  // Simulates thick-glass edge light bending (bright ring at perimeter)
  float ex = smoothstep(0.0, 0.09, vUv.x) * smoothstep(1.0, 0.91, vUv.x);
  float ey = smoothstep(0.0, 0.09, vUv.y) * smoothstep(1.0, 0.91, vUv.y);
  float interior = ex * ey;
  float fresnel   = (1.0 - interior) * 0.5;

  // ── GLASS TINT ── (faint cool blue-white)
  vec3 tint = vec3(0.65, 0.8, 1.0) * 0.045;

  // ── CAUSTIC FLICKER ── (subtle bright spot that pulses)
  float caustic = snoise(sc * 6.0 + vec2(t * 1.1, -t * 0.8));
  caustic = max(caustic * 0.5 + 0.5 - 0.65, 0.0) * 0.25;

  // Final color
  vec3 col = refracted + tint + vec3(fresnel * 0.7, fresnel * 0.78, fresnel) + caustic;

  // Alpha: more opaque at edges (thick glass rim), semi-transparent centre
  float alpha = 0.72 + fresnel * 0.2;

  gl_FragColor = vec4(col, alpha);
}
`;

/* ══════════════════════════════════════════════════════════════
   THREE.JS ENGINE
   ══════════════════════════════════════════════════════════════ */
let renderer, camera, bgScene, glassScene, bgRT;
let W, H, dpr;
let orbMeshes = [];
let glassMeshes = []; // { mesh, element }
let glTime = 0;
let animId = null;

/** Initialize Three.js renderer, scenes, camera, render target */
function initGL() {
  W   = window.innerWidth;
  H   = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio, 2);

  const canvas = document.getElementById('glCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x050508, 1);
  renderer.autoClear = false;

  // Orthographic camera — 1 world unit = 1 CSS pixel
  camera = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, 0.1, 200);
  camera.position.z = 100;

  // Background scene: dark bg + animated neon orbs
  bgScene = new THREE.Scene();
  bgScene.background = new THREE.Color(0x050508);

  // Glass scene: glass panels that sample bgRT
  glassScene = new THREE.Scene();

  // Render target for the background (sampled by glass shader)
  bgRT = new THREE.WebGLRenderTarget(Math.floor(W * dpr), Math.floor(H * dpr), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  createOrbs();
}

/** Create canvas-texture gradient orbs and add to bgScene */
function createOrbs() {
  const configs = [
    // { rgb, x, y, size }  — x/y relative to center (0,0)
    { r:0,   g:90,  b:255, x:-W*0.32, y: H*0.28, sz: H*0.88, speed:0.22, phase:0 },
    { r:155, g:0,   b:255, x: W*0.38, y:-H*0.08, sz: H*0.74, speed:0.18, phase:2.1 },
    { r:0,   g:220, b:160, x:-W*0.08, y:-H*0.38, sz: H*0.62, speed:0.25, phase:4.2 },
    { r:255, g:100, b:0,   x: W*0.28, y: H*0.35, sz: H*0.52, speed:0.15, phase:1.0 },
  ];

  configs.forEach(cfg => {
    const tex  = makeGradientTex(cfg.r, cfg.g, cfg.b);
    const geo  = new THREE.PlaneGeometry(cfg.sz, cfg.sz);
    const mat  = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cfg.x, cfg.y, -10);
    bgScene.add(mesh);
    orbMeshes.push({ mesh, ox: cfg.x, oy: cfg.y, speed: cfg.speed, phase: cfg.phase });
  });
}

/** Radial gradient canvas texture for orbs */
function makeGradientTex(r, g, b) {
  const sz = 256;
  const c  = document.createElement('canvas');
  c.width  = c.height = sz;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0.0, `rgba(${r},${g},${b},0.9)`);
  grd.addColorStop(0.35,`rgba(${r},${g},${b},0.55)`);
  grd.addColorStop(0.65,`rgba(${r},${g},${b},0.2)`);
  grd.addColorStop(1.0, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}

/** Create a glass mesh for the given HTML element and add to glassScene */
function addGlassMesh(element, radiusPx = 28) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return;

  // Rounded rectangle shape
  const shape = roundedRectShape(rect.width, rect.height, radiusPx);
  const geo   = new THREE.ShapeGeometry(shape, 6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBg:   { value: bgRT.texture },
      uTime: { value: 0 },
      uRes:  { value: new THREE.Vector2(W * dpr, H * dpr) },
    },
    vertexShader:   GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent:    true,
    depthTest:      false,
    depthWrite:     false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  positionMesh(mesh, element);
  glassScene.add(mesh);
  glassMeshes.push({ mesh, element, mat, radiusPx });
  return mesh;
}

/** THREE.Shape for rounded rectangle (centered at origin) */
function roundedRectShape(w, h, r) {
  r = Math.min(r, w/2, h/2);
  const x = -w/2, y = -h/2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** Position a glass mesh to match its HTML element's current viewport rect */
function positionMesh(mesh, element) {
  const rect = element.getBoundingClientRect();
  // CSS → Three.js Orthographic world
  const cx =  rect.left + rect.width  / 2 - W / 2;
  const cy = -(rect.top  + rect.height / 2 - H / 2);
  mesh.position.set(cx, cy, 0);
}

/** Build/rebuild all glass meshes after HTML is fully laid out */
function createAllGlassMeshes() {
  // Clear any existing
  glassMeshes.forEach(({ mesh }) => {
    glassScene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  glassMeshes = [];

  addGlassMesh(document.getElementById('hdrLogo'), 100); // full circle → large r
  addGlassMesh(document.getElementById('hdrPill'), 100); // pill → very large r
  addGlassMesh(document.getElementById('hdrWave'), 100);
  addGlassMesh(document.getElementById('carousel'), 28);
  addGlassMesh(document.getElementById('newsCard'), 28);
}

/* ── Render loop ─────────────────────────────────────────────── */
function animate() {
  animId = requestAnimationFrame(animate);
  glTime += 0.012;

  // Animate orbs (slow drift)
  orbMeshes.forEach(({ mesh, ox, oy, speed, phase }) => {
    mesh.position.x = ox + Math.sin(glTime * speed + phase) * 40;
    mesh.position.y = oy + Math.cos(glTime * speed * 0.7 + phase) * 32;
  });

  // Sync glass mesh positions to HTML elements (accounts for scroll)
  glassMeshes.forEach(({ mesh, element, mat }) => {
    positionMesh(mesh, element);
    mat.uniforms.uTime.value = glTime;
    mat.uniforms.uRes.value.set(W * dpr, H * dpr);
  });

  // ── Pass 1: Render background (orbs) → bgRT ──
  renderer.setRenderTarget(bgRT);
  renderer.clear();
  renderer.render(bgScene, camera);

  // ── Pass 2: Render to screen ──
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(bgScene, camera);   // draw background
  renderer.render(glassScene, camera); // draw glass panels on top
}

/* ── Resize ─────────────────────────────────────────────────── */
function handleResize() {
  W   = window.innerWidth;
  H   = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio, 2);

  renderer.setSize(W, H);
  renderer.setPixelRatio(dpr);

  camera.left   = -W/2; camera.right  = W/2;
  camera.top    =  H/2; camera.bottom = -H/2;
  camera.updateProjectionMatrix();

  bgRT.setSize(Math.floor(W * dpr), Math.floor(H * dpr));

  // Reposition orbs
  orbMeshes.forEach(({ mesh, ox, oy }, i) => {
    // Recalculate relative positions
  });

  createAllGlassMeshes();
}

/* ══════════════════════════════════════════════════════════════
   CONTENT: JSON → HTML
   ══════════════════════════════════════════════════════════════ */
async function loadContent() {
  const res = await fetch('./content.json');
  if (!res.ok) throw new Error('content.json not found');
  return res.json();
}

function renderHeader(data) {
  const el = document.getElementById('hdrTitle');
  if (el && data.header?.title) el.textContent = data.header.title;
}

function renderCarousel(slides) {
  const track = document.getElementById('carouselTrack');
  const dots  = document.getElementById('carouselDots');
  if (!track) return;
  track.innerHTML = '';
  dots.innerHTML  = '';

  slides.forEach((slide, i) => {
    const art = document.createElement('article');
    art.className = `slide slide--${slide.type}`;
    art.setAttribute('role', 'listitem');
    art.dataset.index  = i;
    art.dataset.accent = slide.accentColor || '#00aaff';

    art.innerHTML = slide.type === 'image'
      ? buildImageSlide(slide)
      : buildTextSlide(slide);
    track.appendChild(art);

    // Dot
    const dot = document.createElement('button');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    dot.setAttribute('aria-label', `Diapositiva ${i + 1}`);
    dot.dataset.idx = i;
    dots.appendChild(dot);
  });
}

function buildImageSlide(s) {
  return `
    <div class="slide-img"><img src="${s.image}" alt="${s.imageAlt}" loading="${s.id===1?'eager':'lazy'}"/></div>
    <div class="slide-scrim"></div>
    <div class="slide-badge"><span>${s.tagIcon} ${s.tag}</span></div>
    <div class="slide-info">
      <h2 class="slide-title">${s.title}</h2>
      <p class="slide-excerpt">${s.excerpt}</p>
      <div class="slide-meta"><span class="slide-date">${s.date}</span><span class="slide-read">${s.readTime}</span></div>
    </div>`;
}

function buildTextSlide(s) {
  const accent = s.accentColor || '#a855f7';
  const from   = s.gradientFrom || '#0d1a3a';
  const to     = s.gradientTo   || '#1a0533';
  return `
    <div class="slide-text-bg" style="background:linear-gradient(135deg,${from},${to})">
      <div class="slide-blob blob-a" style="background:radial-gradient(circle,${accent}88 0%,transparent 65%)"></div>
      <div class="slide-blob blob-b" style="background:radial-gradient(circle,${accent}55 0%,transparent 65%)"></div>
    </div>
    <div class="slide-text-content">
      <div class="slide-text-tag" style="color:${accent}">${s.tagIcon} ${s.tag}</div>
      <h2 class="slide-text-headline">${s.title}</h2>
      <p class="slide-text-body">${s.excerpt}</p>
      <button class="slide-cta" style="--cta-from:${accent};--cta-to:${shiftHue(accent,30)}">
        ${s.ctaLabel}
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
          <path d="M4 10h12M10 4l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;
}

function renderNewsCard(nc) {
  const el = document.getElementById('newsCardContent');
  if (!el || !nc) return;
  const accent = nc.accentColor || '#818cf8';
  el.innerHTML = `
    <div class="nc-top">
      <span class="nc-tag" style="color:${accent}">${nc.tagIcon} ${nc.tag}</span>
      <span class="nc-date">${nc.date}</span>
    </div>
    <h2 class="nc-title">${nc.title}</h2>
    <p class="nc-body">${nc.body}</p>
    <div class="nc-footer">
      <button class="nc-cta" id="ncCta"><span>${nc.ctaLabel}</span>
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
          <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="nc-share" id="ncShare" aria-label="${nc.shareLabel}">
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;

  document.getElementById('ncCta')?.addEventListener('click', function() { addRipple(this); });
  document.getElementById('ncShare')?.addEventListener('click', async () => {
    const d = { title: nc.title, text: nc.body.slice(0,120), url: location.href };
    try { if (navigator.share) await navigator.share(d); else await navigator.clipboard.writeText(location.href); } catch(_){}
  });
}

/* ══════════════════════════════════════════════════════════════
   CAROUSEL
   ══════════════════════════════════════════════════════════════ */
function initCarousel(total) {
  const track   = document.getElementById('carouselTrack');
  const bar     = document.getElementById('carouselBar');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const dotsEl  = document.getElementById('carouselDots');
  const carEl   = document.getElementById('carousel');
  if (!track) return;

  let current = 0, autoTimer = null, progRaf = null, progStart = null;
  const AUTO = 5500;

  const slides = () => track.querySelectorAll('.slide');
  const dots   = () => dotsEl.querySelectorAll('.dot');

  function activate(idx) {
    slides().forEach((s,i) => s.classList.toggle('is-active', i === idx));
  }

  function goTo(idx, noRestart=false) {
    if (idx < 0) idx = total - 1;
    if (idx >= total) idx = 0;
    current = idx;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots().forEach((d,i) => {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-selected', i === current ? 'true' : 'false');
    });
    activate(current);
    if (!noRestart) restartAuto();
  }

  function startProgress() {
    cancelAnimationFrame(progRaf);
    if (!bar) return;
    progStart = performance.now();
    (function tick(ts) {
      const pct = Math.min(((ts - progStart) / AUTO) * 100, 100);
      bar.style.width = pct + '%';
      if (pct < 100) progRaf = requestAnimationFrame(tick);
    })(progStart);
  }

  function restartAuto() {
    clearInterval(autoTimer);
    startProgress();
    autoTimer = setInterval(() => goTo(current + 1, true), AUTO);
  }

  function pauseAuto() { clearInterval(autoTimer); cancelAnimationFrame(progRaf); }

  prevBtn?.addEventListener('click', () => { addRipple(prevBtn); goTo(current - 1); });
  nextBtn?.addEventListener('click', () => { addRipple(nextBtn); goTo(current + 1); });
  dotsEl?.addEventListener('click', e => { const d = e.target.closest('.dot'); if(d) goTo(+d.dataset.idx); });
  document.addEventListener('keydown', e => { if(e.key==='ArrowRight') goTo(current+1); if(e.key==='ArrowLeft') goTo(current-1); });

  // Swipe
  let dx=0, dy=0, sx=0, sy=0, dragging=false;
  carEl.addEventListener('touchstart', e => { dragging=true; sx=e.touches[0].clientX; sy=e.touches[0].clientY; dx=0; track.style.transition='none'; pauseAuto(); }, {passive:true});
  carEl.addEventListener('touchmove', e => {
    if(!dragging) return;
    dx = e.touches[0].clientX - sx;
    dy = e.touches[0].clientY - sy;
    if(Math.abs(dy) > Math.abs(dx)+6){ dragging=false; return; }
    track.style.transform = `translateX(calc(-${current*100}% + ${dx}px))`;
  }, {passive:true});
  carEl.addEventListener('touchend', () => {
    if(!dragging) return; dragging=false; track.style.transition='';
    if(dx < -carEl.offsetWidth*.18) goTo(current+1);
    else if(dx > carEl.offsetWidth*.18) goTo(current-1);
    else goTo(current);
  });

  carEl.addEventListener('mouseenter', pauseAuto);
  carEl.addEventListener('mouseleave', restartAuto);
  document.addEventListener('visibilitychange', () => document.hidden ? pauseAuto() : restartAuto());

  activate(0); goTo(0, true); restartAuto();
}

/* ══════════════════════════════════════════════════════════════
   3D TILT (news card, desktop only)
   ══════════════════════════════════════════════════════════════ */
function initTilt() {
  const card = document.getElementById('newsCard');
  if (!card || window.matchMedia('(hover:none),(prefers-reduced-motion:reduce)').matches) return;
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width /2) / r.width;
    const dy = (e.clientY - r.top  - r.height/2) / r.height;
    card.style.transform = `translateY(-5px) scale(1.005) perspective(900px) rotateX(${dy*-6}deg) rotateY(${dx*6}deg)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
}

/* ══════════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════════ */
function addRipple(el) {
  const r = document.createElement('span');
  r.className = 'ripple';
  const sz = Math.max(el.offsetWidth, el.offsetHeight);
  r.style.cssText = `width:${sz}px;height:${sz}px;left:${(el.offsetWidth-sz)/2}px;top:${(el.offsetHeight-sz)/2}px;`;
  el.style.position='relative'; el.style.overflow='hidden';
  el.appendChild(r);
  r.addEventListener('animationend', () => r.remove(), {once:true});
}

function shiftHue(hex, deg) {
  const c = hex.replace('#','');
  let r=parseInt(c.slice(0,2),16)/255, g=parseInt(c.slice(2,4),16)/255, b=parseInt(c.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0, s=0, l=(max+min)/2;
  if(d){ s=d/(1-Math.abs(2*l-1)); if(max===r) h=((g-b)/d)%6; else if(max===g) h=(b-r)/d+2; else h=(r-g)/d+4; h=Math.round(h*60+360)%360; }
  h=(h+deg+360)%360;
  const cc=(1-Math.abs(2*l-1))*s, x=cc*(1-Math.abs((h/60)%2-1)), m=l-cc/2;
  let R,G,B;
  if(h<60){R=cc;G=x;B=0}else if(h<120){R=x;G=cc;B=0}else if(h<180){R=0;G=cc;B=x}
  else if(h<240){R=0;G=x;B=cc}else if(h<300){R=x;G=0;B=cc}else{R=cc;G=0;B=x}
  const toH=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${toH(R)}${toH(G)}${toH(B)}`;
}

/* ══════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════ */
async function boot() {
  // 1. Init WebGL
  initGL();
  animate(); // Start render loop immediately

  // 2. Load content
  let data;
  try { data = await loadContent(); }
  catch(e) { console.error('content.json load failed:', e); return; }

  // 3. Render HTML from JSON
  renderHeader(data);
  renderCarousel(data.carousel);
  renderNewsCard(data.newsCard);
  initCarousel(data.carousel.length);
  initTilt();

  // 4. Wait two frames for layout, then build glass panels
  requestAnimationFrame(() => requestAnimationFrame(() => {
    createAllGlassMeshes();
    // Recreate on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { handleResize(); }, 200);
    });
  }));
}

document.addEventListener('DOMContentLoaded', boot);
