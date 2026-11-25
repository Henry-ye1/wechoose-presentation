(() => {
  const stages = Array.from(document.querySelectorAll('.stage'));
  const links = Array.from(document.querySelectorAll('.slide-nav a'));
  const navigation = document.querySelector('.slide-nav');
  const previous = document.querySelector('#previous');
  const next = document.querySelector('#next');
  const counter = document.querySelector('#counter');
  const fullscreen = document.querySelector('#fullscreen');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 760px)');
  const screen = matchMedia('screen');
  const demos = Array.from(document.querySelectorAll('[data-demo]'), element => ({
    element,
    stage: element.closest('.stage'),
    button: element.querySelector('.demo-toggle'),
    frame: element.querySelector('.phone-media'),
    videos: Array.from(element.querySelectorAll('video')),
    state: 'ready',
    visible: false,
    manual: false,
    pausedByUser: false,
    autoplayBlocked: false,
    request: 0,
  }));
  const clipLoads = new WeakMap();
  let index = -1;
  let pendingFrame = 0;

  function cardTransform(source, destination) {
    const first = source.getBoundingClientRect();
    const last = destination.getBoundingClientRect();
    return `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width}, ${first.height / last.height})`;
  }

  function animateDetailCard(overview, card, detail, opening, animations) {
    const direction = opening ? 'normal' : 'reverse';
    const move = {
      duration: opening ? 490 : 340,
      delay: opening ? 0 : 95,
      easing: 'cubic-bezier(.4,0,.2,1)',
    };
    const play = (element, frames, timing) => {
      animations.push(element.animate(frames, { direction, fill: 'both', ...timing }));
    };
    const matches = [
      [card, detail.querySelector('.system-surface')],
      [card.querySelector('img'), detail.querySelector('.system-identity img')],
      [card.querySelector('h3'), detail.querySelector('.system-identity p')],
    ];

    for (const [source, destination] of matches) {
      if (source && destination) {
        play(destination, [{ transform: cardTransform(source, destination) }, { transform: 'none' }], move);
      }
    }
    play(overview, [{ opacity: 1 }, { opacity: 0 }], { ...move, duration: opening ? 430 : move.duration });

    for (const element of detail.querySelectorAll('[data-system-reveal]')) {
      play(element, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
        duration: opening ? 220 : 110,
        delay: opening ? 370 + Number(element.dataset.systemReveal) * 70 : 0,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
    }
  }

  function setupDetailViews(overview) {
    const stage = overview.closest('.stage');
    let currentView = overview;
    let activeTrigger = null;
    let moving = false;

    async function showView(nextView, trigger = activeTrigger) {
      if (!nextView || nextView === currentView || moving) return;
      const previousView = currentView;
      const opening = nextView !== overview;
      const detail = opening ? nextView : previousView;
      const card = trigger?.parentElement;
      const animations = [];
      moving = true;
      activeTrigger = trigger;

      try {
        if (card && screen.matches && !motion.matches && typeof detail.animate === 'function') {
          previousView.inert = true;
          nextView.inert = true;
          nextView.hidden = false;
          card.classList.add('system-card-moving');
          animateDetailCard(overview, card, detail, opening, animations);
          await Promise.allSettled(animations.map(animation => animation.finished));
        }
      } finally {
        const bounds = stage.getBoundingClientRect();
        const scroller = previousView.querySelector('[data-detail-scroll]');
        if (scroller) scroller.scrollTop = 0;
        previousView.hidden = true;
        previousView.inert = false;
        nextView.hidden = false;
        nextView.inert = false;
        card?.classList.remove('system-card-moving');
        animations.forEach(animation => animation.cancel());
        trigger?.setAttribute('aria-expanded', String(opening));
        currentView = nextView;
        moving = false;
        if (bounds.top < innerHeight && bounds.bottom > 0) {
          stage.scrollIntoView({ block: 'start', behavior: 'instant' });
          const target = opening ? detail.querySelector('.system-back') : trigger;
          target?.focus({ preventScroll: true });
        }
      }
    }

    stage.classList.add('system-interactive');
    for (const button of overview.querySelectorAll('[data-system-open]')) {
      button.hidden = false;
      button.addEventListener('click', () => {
        showView(document.getElementById(button.getAttribute('aria-controls')), button);
      });
    }
    for (const button of stage.querySelectorAll('.system-back')) {
      button.addEventListener('click', () => showView(overview));
    }
    return () => {
      if (currentView === overview || stage !== stages[index]) return false;
      showView(overview);
      return true;
    };
  }

  const closeDetailViews = Array.from(document.querySelectorAll('[data-slide-overview]'), setupDetailViews);
  for (const scroller of document.querySelectorAll('[data-detail-scroll]')) {
    for (const button of scroller.querySelectorAll('[data-detail-jump]')) {
      button.addEventListener('click', () => {
        const section = document.getElementById(button.getAttribute('aria-controls'));
        const behavior = motion.matches ? 'instant' : 'smooth';
        if (getComputedStyle(scroller).overflowY === 'auto' && scroller.scrollHeight > scroller.clientHeight) {
          scroller.scrollTo({ top: section.offsetTop, behavior });
        } else {
          section.scrollIntoView({ block: compact.matches ? 'start' : 'nearest', behavior });
        }
        section.querySelector('h2, h3').focus({ preventScroll: true });
      });
    }
  }

  function setDemoState(demo, state) {
    const label = { ready: 'Play', playing: 'Pause', paused: 'Resume' }[state];
    demo.state = state;
    demo.button.textContent = label + ' demo';
    demo.button.setAttribute('aria-label', `${label} ${demo.element.dataset.demo} demo`);
  }

  function pauseDemo(demo) {
    if (demo.state !== 'playing') return;
    demo.request++;
    demo.videos.forEach(video => video.pause());
    setDemoState(demo, 'paused');
  }

  function loadClip(video) {
    if (!/^https?:$/.test(location.protocol)) return;
    if (!clipLoads.has(video)) {
      // A Blob supports seeking on previews served without HTTP byte ranges.
      const load = fetch(video.src).then(async response => {
        if (response.ok) video.src = URL.createObjectURL(await response.blob());
      }).catch(() => {});
      clipLoads.set(video, load);
    }
    return clipLoads.get(video);
  }

  async function playDemo(demo) {
    if (demo.state === 'playing') return;
    const request = ++demo.request;
    setDemoState(demo, 'playing');
    try {
      await Promise.all(demo.videos.map(loadClip));
      if (request !== demo.request) return;
      demo.element.classList.add('demo-visible');
      await Promise.all(demo.videos.map(video => video.play()));
    } catch {
      if (request === demo.request) {
        demo.autoplayBlocked = true;
        pauseDemo(demo);
        demo.element.classList.remove('demo-visible');
        setDemoState(demo, 'ready');
      }
    }
  }

  function updateDemos() {
    for (const demo of demos) {
      const onScreen = screen.matches && !document.hidden && demo.stage === stages[index] && demo.visible;
      if (!onScreen || (motion.matches && !demo.manual)) {
        pauseDemo(demo);
      } else if (!demo.pausedByUser && !demo.autoplayBlocked) {
        playDemo(demo);
      }
    }
  }

  const demosByFrame = new Map(demos.map(demo => [demo.frame, demo]));
  const frameObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      demosByFrame.get(entry.target).visible = entry.intersectionRatio >= .2;
    }
    updateDemos();
  }, { threshold: .2 });

  for (const demo of demos) {
    setDemoState(demo, 'ready');
    demo.button.hidden = false;
    demo.button.addEventListener('click', () => {
      demo.manual = true;
      demo.pausedByUser = demo.state === 'playing';
      if (demo.pausedByUser) pauseDemo(demo);
      else {
        demo.autoplayBlocked = false;
        playDemo(demo);
      }
    });
    frameObserver.observe(demo.frame);
  }

  function update() {
    pendingFrame = 0;
    const center = innerHeight * .47;
    let winner = 0;
    let distance = Infinity;
    stages.forEach((stage, i) => {
      const rect = stage.getBoundingClientRect();
      const gap = Math.max(rect.top - center, center - rect.bottom, 0);
      if (gap < distance) {
        distance = gap;
        winner = i;
      }
    });
    if (winner === index) return;
    index = winner;
    stages.forEach((stage, i) => stage.classList.toggle('is-active', i === index));
    links.forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (navigation.scrollWidth > navigation.clientWidth) {
      links[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    counter.value = `${index + 1} / ${stages.length}`;
    previous.disabled = index === 0;
    next.disabled = index === stages.length - 1;
    updateDemos();
  }

  function scheduleUpdate() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(update);
  }

  function go(i) {
    if (i < 0 || i >= stages.length) return;
    stages[i].scrollIntoView({ behavior: motion.matches ? 'instant' : 'smooth', block: 'start' });
  }

  previous.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  links.forEach((link, i) => link.addEventListener('click', event => {
    event.preventDefault();
    go(i);
  }));
  document.querySelector('#print').addEventListener('click', () => window.print());
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreen.title = 'Full screen is unavailable in this viewer';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreen.setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && closeDetailViews.some(close => close())) {
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest?.('button, a, input, textarea, select, [contenteditable], .journey-scroll, [data-detail-scroll]')) return;
    let target;
    switch (event.key) {
      case 'ArrowRight': case 'PageDown': target = index + 1; break;
      case 'ArrowLeft': case 'PageUp': target = index - 1; break;
      case 'ArrowDown': if (compact.matches) return; target = index + 1; break;
      case 'ArrowUp': if (compact.matches) return; target = index - 1; break;
      case ' ': target = index + (event.shiftKey ? -1 : 1); break;
      case 'Home': target = 0; break;
      case 'End': target = stages.length - 1; break;
      default: return;
    }
    event.preventDefault();
    go(target);
  });
  addEventListener('scroll', scheduleUpdate, { passive: true });
  addEventListener('resize', scheduleUpdate);
  document.addEventListener('visibilitychange', updateDemos);
  screen.addEventListener('change', updateDemos);
  motion.addEventListener('change', updateDemos);
  update();
})();
