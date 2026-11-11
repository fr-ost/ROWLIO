// Rowlio website interactions. No dependencies, no network requests, no tracking.
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // ---- Sound effects: synthesised in the browser, toggleable, remembered locally -------
  const SOUNDS = {
    tap: [[880, 660, 0, 0.05, 0.3, 'triangle']],
    hover: [[1200, 1500, 0, 0.03, 0.08, 'sine']],
    tab: [[520, 0, 0, 0.05, 0.28, 'triangle'], [780, 0, 0.05, 0.07, 0.28, 'triangle']],
    open: [[440, 880, 0, 0.09, 0.3, 'sine']],
    success: [[523.25, 0, 0, 0.11, 0.35, 'sine'], [659.25, 0, 0.1, 0.11, 0.35, 'sine'], [783.99, 0, 0.2, 0.11, 0.35, 'sine'], [1046.5, 0, 0.3, 0.3, 0.4, 'sine']],
    on: [[660, 990, 0, 0.12, 0.35, 'sine']],
  };
  let soundOn = true;
  try {
    soundOn = localStorage.getItem('rowlio-sound') !== 'off';
  } catch {
    /* storage unavailable: keep the default */
  }
  let context = null;
  let master = null;
  let last = 0;
  function play(name) {
    if (!soundOn || !SOUNDS[name]) return;
    const now = performance.now();
    if (name === 'hover' && now - last < 90) return;
    last = now;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      if (!context) {
        context = new Ctor();
        master = context.createGain();
        master.gain.value = 0.14;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume();
      const t0 = context.currentTime + 0.005;
      for (const [f, to, at, d, g, type] of SOUNDS[name]) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f, t0 + at);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + at + d);
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(g, t0 + at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + d + 0.03);
      }
    } catch {
      /* audio not available */
    }
  }
  const toggle = $('#sound-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(soundOn));
    toggle.addEventListener('click', () => {
      soundOn = !soundOn;
      toggle.setAttribute('aria-pressed', String(soundOn));
      try {
        localStorage.setItem('rowlio-sound', soundOn ? 'on' : 'off');
      } catch {
        /* ignore */
      }
      if (soundOn) play('on');
    });
  }
  document.addEventListener('click', (event) => {
    const control = event.target.closest('a, button, summary');
    if (!control || control === toggle) return;
    play(control.dataset.sfx || (control.matches('[role="tab"]') ? 'tab' : control.matches('summary') ? 'open' : 'tap'));
  });
  // Browsers only allow audio after the first interaction, so hover sounds start then.
  let interacted = false;
  window.addEventListener('pointerdown', () => (interacted = true), { once: true });
  $$('.btn, .card, .tabs button').forEach((el) => el.addEventListener('mouseenter', () => interacted && play('hover')));

  // ---- Nav shadow, cursor glow --------------------------------------------------------
  const nav = $('.nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  const glow = $('.cursor-glow');
  if (glow && !reduced) {
    window.addEventListener('pointermove', (event) => {
      glow.style.setProperty('--x', `${event.clientX}px`);
      glow.style.setProperty('--y', `${event.clientY}px`);
    }, { passive: true });
  }

  // ---- Scroll reveal with a light stagger ---------------------------------------------
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      visible.forEach((entry, index) => {
        entry.target.style.setProperty('--d', `${Math.min(index, 6) * 70}ms`);
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach((el) => observer.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  // ---- Counting numbers -----------------------------------------------------------------
  const counters = $$('[data-count]');
  const run = (el) => {
    const target = Number(el.dataset.count) || 0;
    const suffix = el.dataset.suffix || '';
    if (reduced || target === 0) {
      el.textContent = `${target}${suffix}`;
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 1400);
      el.textContent = `${Math.round(target * (1 - Math.pow(1 - p, 4)))}${p === 1 ? suffix : ''}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        counterObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => counterObserver.observe(el));
  } else {
    counters.forEach(run);
  }

  // ---- 3D tilt on the hero window, spotlight on cards -----------------------------------
  const stage = $('#stage');
  const tilt = $('#tilt');
  if (stage && tilt && !reduced) {
    stage.addEventListener('pointermove', (event) => {
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      tilt.style.setProperty('--ry', `${x * 7}deg`);
      tilt.style.setProperty('--rx', `${4 - y * 7}deg`);
      tilt.style.setProperty('--sx', `${(x + 0.5) * 100}%`);
      tilt.style.setProperty('--sy', `${(y + 0.5) * 100}%`);
    });
    stage.addEventListener('pointerleave', () => {
      tilt.style.setProperty('--ry', '0deg');
      tilt.style.setProperty('--rx', '6deg');
    });
  }
  $$('.card').forEach((card) => card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    card.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }));

  // ---- Magnetic buttons -------------------------------------------------------------------
  if (!reduced) {
    $$('.magnetic').forEach((button) => {
      button.addEventListener('pointermove', (event) => {
        const rect = button.getBoundingClientRect();
        const x = (event.clientX - rect.left - rect.width / 2) * 0.18;
        const y = (event.clientY - rect.top - rect.height / 2) * 0.3;
        button.style.transform = `translate(${x}px, ${y - 2}px)`;
      });
      button.addEventListener('pointerleave', () => (button.style.transform = ''));
    });
  }

  // ---- "How it works" tabs ------------------------------------------------------------------
  const tabs = $$('.tabs [role="tab"]');
  const shot = $('#shot');
  const shotImage = shot && $('img', shot);
  const select = (tab) => {
    tabs.forEach((other) => other.setAttribute('aria-selected', String(other === tab)));
    if (!shot || !shotImage) return;
    shot.setAttribute('aria-labelledby', tab.id);
    shotImage.classList.add('swap');
    window.setTimeout(() => {
      shotImage.src = tab.dataset.shot;
      shotImage.alt = tab.dataset.alt || '';
      shotImage.classList.remove('swap');
    }, reduced ? 0 : 220);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      select(next);
    });
  });

  // ---- Live demo: click a card, rows appear -------------------------------------------------
  const demo = $('#demo-box');
  if (demo) {
    const cards = $$('.demo-card', demo);
    const rows = $$('tbody tr', demo);
    const cursor = $('.demo-cursor', demo);
    const page = $('.demo-page', demo);
    if (reduced) {
      rows.forEach((row) => row.classList.add('on'));
    } else {
      const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const moveTo = (card) => {
        const a = card.getBoundingClientRect();
        const b = page.getBoundingClientRect();
        cursor.style.setProperty('--cx', `${a.left - b.left + a.width * 0.55}px`);
        cursor.style.setProperty('--cy', `${a.top - b.top + a.height * 0.5}px`);
      };
      let running = false;
      const loop = async () => {
        if (running) return;
        running = true;
        for (;;) {
          cards.forEach((card) => card.classList.remove('on'));
          rows.forEach((row) => row.classList.remove('on', 'flash'));
          await wait(700);
          moveTo(cards[0]);
          await wait(800);
          cards[0].classList.add('on');
          await wait(450);
          // The similar cards light up, then become rows.
          for (let i = 1; i < cards.length; i++) {
            cards[i].classList.add('on');
            await wait(140);
          }
          await wait(350);
          for (let i = 0; i < rows.length; i++) {
            rows[i].classList.add('on', 'flash');
            await wait(230);
            rows[i].classList.remove('flash');
          }
          await wait(3200);
        }
      };
      if ('IntersectionObserver' in window) {
        const demoObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            loop();
            demoObserver.disconnect();
          }
        }, { threshold: 0.35 });
        demoObserver.observe(demo);
      } else {
        loop();
      }
    }
  }
})();
