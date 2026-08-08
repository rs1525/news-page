/* ═══════════════════════════════════════════════════════════════
   app.js — Glasswave News
   Carousel + Particles + Liquid Glass interactions
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── Particle System ─────────────────────────────────────────── */
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [], raf;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function Particle() {
    this.reset();
  }
  Particle.prototype.reset = function () {
    this.x  = Math.random() * W;
    this.y  = Math.random() * H;
    this.r  = Math.random() * 1.5 + 0.3;
    this.vx = (Math.random() - 0.5) * 0.25;
    this.vy = (Math.random() - 0.5) * 0.25 - 0.1;
    this.alpha = Math.random() * 0.5 + 0.1;
    this.hue = Math.random() * 60 + 200; // 200–260 (blue-purple)
  };
  Particle.prototype.update = function () {
    this.x += this.vx;
    this.y += this.vy;
    if (this.y < -10 || this.x < -10 || this.x > W + 10) this.reset();
  };
  Particle.prototype.draw = function () {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = `hsl(${this.hue}, 90%, 75%)`;
    ctx.shadowColor = `hsl(${this.hue}, 100%, 70%)`;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  function init() {
    resize();
    const count = Math.min(80, Math.floor((W * H) / 12000));
    particles = Array.from({ length: count }, () => new Particle());
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    raf = requestAnimationFrame(loop);
  }

  const ro = new ResizeObserver(() => { resize(); });
  ro.observe(document.body);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  init();
  loop();
})();


/* ── Carousel ────────────────────────────────────────────────── */
(function initCarousel() {
  const track    = document.getElementById('carouselTrack');
  const dots     = Array.from(document.querySelectorAll('.dot'));
  const prevBtn  = document.getElementById('prevBtn');
  const nextBtn  = document.getElementById('nextBtn');
  const progress = document.getElementById('progressBar');
  const slides   = Array.from(track.querySelectorAll('.carousel-slide'));
  const total    = slides.length;

  let current   = 0;
  let timer     = null;
  let startX    = 0;
  let startY    = 0;
  let isDragging= false;
  let dragDelta = 0;
  let autoInterval = 5000;
  let progressStart= null;
  let progressRaf  = null;

  // Mark active slide
  function activate(idx) {
    slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
  }

  function goTo(idx, animate = true) {
    if (idx < 0) idx = total - 1;
    if (idx >= total) idx = 0;
    current = idx;
    if (!animate) track.style.transition = 'none';
    track.style.transform = `translateX(-${current * 100}%)`;
    if (!animate) requestAnimationFrame(() => { track.style.transition = ''; });
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === current);
      d.setAttribute('aria-selected', i === current);
    });
    activate(current);
    restartAuto();
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  // Autoplay with progress bar
  function startProgress() {
    cancelAnimationFrame(progressRaf);
    if (progress) {
      progressStart = performance.now();
      function updateBar(ts) {
        const pct = Math.min(((ts - progressStart) / autoInterval) * 100, 100);
        progress.style.width = pct + '%';
        if (pct < 100) progressRaf = requestAnimationFrame(updateBar);
      }
      progressRaf = requestAnimationFrame(updateBar);
    }
  }

  function restartAuto() {
    clearInterval(timer);
    startProgress();
    timer = setInterval(next, autoInterval);
  }

  // Pause on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else restartAuto();
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft')  prev();
  });

  // Dots
  dots.forEach(d => {
    d.addEventListener('click', () => goTo(+d.dataset.idx));
  });

  // Buttons
  prevBtn.addEventListener('click', () => { addRipple(prevBtn); prev(); });
  nextBtn.addEventListener('click', () => { addRipple(nextBtn); next(); });

  // Touch / pointer swipe
  const container = track.parentElement;

  function onPointerDown(e) {
    isDragging = true;
    dragDelta = 0;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    track.style.transition = 'none';
    clearInterval(timer);
    cancelAnimationFrame(progressRaf);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = cx - startX;
    const dy = cy - startY;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      isDragging = false;
      track.style.transition = '';
      track.style.transform = `translateX(-${current * 100}%)`;
      return;
    }
    dragDelta = dx;
    const base = current * 100;
    const off  = (dragDelta / container.offsetWidth) * 100;
    track.style.transform = `translateX(calc(-${base}% + ${dragDelta}px))`;
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    track.style.transition = '';
    const threshold = container.offsetWidth * 0.18;
    if (dragDelta < -threshold) next();
    else if (dragDelta > threshold) prev();
    else goTo(current);
  }

  container.addEventListener('touchstart', onPointerDown, { passive: true });
  container.addEventListener('touchmove',  onPointerMove, { passive: true });
  container.addEventListener('touchend',   onPointerUp);
  container.addEventListener('mousedown',  onPointerDown);
  window.addEventListener('mousemove',     onPointerMove);
  window.addEventListener('mouseup',       onPointerUp);

  // Pause on hover (desktop)
  container.addEventListener('mouseenter', () => { clearInterval(timer); cancelAnimationFrame(progressRaf); });
  container.addEventListener('mouseleave', () => restartAuto());

  // Init
  activate(0);
  goTo(0, false);
  restartAuto();
})();


/* ── Ripple effect ───────────────────────────────────────────── */
function addRipple(el, evt) {
  const ripple = document.createElement('span');
  ripple.classList.add('ripple');
  const size = Math.max(el.offsetWidth, el.offsetHeight);
  ripple.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    left: ${(el.offsetWidth - size) / 2}px;
    top: ${(el.offsetHeight - size) / 2}px;
  `;
  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

// Attach ripple to CTA buttons
['cta-glass', 'cta-update', 'readFullBtn', 'shareBtn'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => addRipple(el));
});


/* ── Parallax tilt on news card (pointer) ───────────────────── */
(function initTilt() {
  const card = document.getElementById('newsCard');
  if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Only on non-touch devices
  if (window.matchMedia('(hover: none)').matches) return;

  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    const tiltX = dy * 8;
    const tiltY = -dx * 8;
    card.style.transform =
      `translateY(-4px) scale(1.005) perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

    // Move glow highlight
    const glow = card.querySelector('.news-card-glow');
    if (glow) {
      glow.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    }
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    const glow = card.querySelector('.news-card-glow');
    if (glow) glow.style.transform = '';
  });
})();


/* ── Logo pulse on click ────────────────────────────────────── */
(function initLogo() {
  const logo = document.getElementById('logo-btn');
  if (!logo) return;
  logo.addEventListener('click', () => {
    logo.style.transition = 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)';
    logo.style.transform = 'scale(0.85) rotate(-10deg)';
    setTimeout(() => {
      logo.style.transform = '';
    }, 150);
  });
  logo.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logo.click(); }
  });
})();


/* ── Intersection observer — entrance animation ─────────────── */
(function initEntrance() {
  if (!('IntersectionObserver' in window)) return;
  const items = document.querySelectorAll('.carousel-section, .news-card-section');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  items.forEach(el => obs.observe(el));
})();


/* ── Share button ───────────────────────────────────────────── */
(function initShare() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const data = {
      title: 'Update Glasswave',
      text:  'La plataforma Glasswave ha lanzado una nueva actualización con refracción de luz en tiempo real.',
      url:   window.location.href,
    };
    if (navigator.share) {
      try { await navigator.share(data); } catch (_) {}
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        btn.style.color = '#00e5a0';
        setTimeout(() => { btn.style.color = ''; }, 1500);
      } catch (_) {}
    }
  });
})();


/* ── Liquid glass shimmer on touch ─────────────────────────── */
document.querySelectorAll('.liquid-glass-title').forEach(el => {
  ['touchstart', 'mouseenter'].forEach(evt => {
    el.addEventListener(evt, () => {
      const shimmer = el.querySelector('.title-shimmer');
      if (shimmer) {
        shimmer.style.animation = 'none';
        shimmer.style.transform = 'translateX(-100%)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            shimmer.style.animation = 'shimmerSlide 0.7s ease forwards';
          });
        });
      }
    });
  });
});
