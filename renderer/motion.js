'use strict';
// Whole-image motion, using the two existing transparent sprites. No fabricated limb rigging.
window.MikoMotion = (() => {
  const frames = {
    idle: ['translateY(0) rotate(-1.2deg)', 'translateY(-5px) rotate(1.2deg)', 'translateY(0) rotate(-1.2deg)'],
    touch: ['translateY(0) scale(1)', 'translateY(2px) rotate(-2deg) scale(1.03,.96)', 'translateY(-16px) rotate(-5deg) scale(.99,1.02)', 'translateY(-2px) rotate(4deg)', 'translateY(0) scale(1)'],
    cuddle: ['translateX(0) rotate(0)', 'translateX(-17px) rotate(-7deg) scale(1.02)', 'translateX(-14px) rotate(-5deg) scale(1.02)', 'translateX(5px) rotate(2deg)', 'translateX(0) rotate(0)'],
    sleepy: ['translateY(0) rotate(0)', 'translateY(9px) rotate(5deg)', 'translateY(2px) rotate(1deg)', 'translateY(11px) rotate(6deg)', 'translateY(3px) rotate(2deg)', 'translateY(0) rotate(0)'],
    peek: ['translateX(35%) rotate(-9deg)', 'translateX(15%) rotate(-5deg)', 'translateX(0) rotate(2deg)', 'translateX(0) rotate(0)'],
    party: ['translateY(0)', 'translateY(3px) rotate(-3deg) scale(1.03,.96)', 'translateY(-21px) rotate(-7deg)', 'translateY(0) rotate(2deg)', 'translateY(-28px) rotate(7deg)', 'translateY(0) rotate(-3deg)', 'translateY(0)'],
  };
  const duration = { idle: 6000, touch: 1000, cuddle: 2000, sleepy: 6000, peek: 1800, party: 2200 };
  let animations = [], current = '', reduced = false, scale = 1, hidden = false, pending = 'idle';
  function stop() { for (const animation of animations) animation.cancel(); animations = []; document.getElementById('effects').replaceChildren(); }
  function play(name, force = false) {
    pending = name;
    if (current === name && !force) return;
    current = name; stop(); document.body.dataset.motion = name;
    if (reduced || hidden || !frames[name]) {
      if (frames[name] && !['idle', 'sleepy'].includes(name)) window.mori.motionEnded();
      return;
    }
    const image = document.querySelector('#character img'), loop = ['idle', 'sleepy'].includes(name);
    const keys = frames[name].map(transform => ({ transform: transform.replace(/(-?[\d.]+)px/g, (_, n) => `${Number(n) * scale}px`) }));
    if (name === 'peek') { keys[0].opacity = 0; keys[1].opacity = .7; keys[2].opacity = 1; keys[3].opacity = 1; }
    const animation = image.animate(keys, { duration: duration[name], iterations: loop ? Infinity : 1, easing: 'ease-in-out' });
    animations.push(animation);
    if (!loop) animation.finished.then(() => { if (current === name) window.mori.motionEnded(); }).catch(() => {});
    if (['touch', 'cuddle', 'sleepy', 'party'].includes(name)) {
      const count = name === 'party' ? 5 : 2;
      for (let i = 0; i < count; i++) {
        const effect = document.createElement('span'); effect.textContent = name === 'cuddle' ? '♡' : name === 'sleepy' ? 'z' : '✦';
        effect.style.left = `${22 + i * (55 / count)}%`; effect.style.top = `${12 + i % 2 * 12}%`;
        document.getElementById('effects').append(effect);
        animations.push(effect.animate([{ opacity: 0, transform: 'translateY(8px) scale(.4)' }, { opacity: .85, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: `translateY(${-25 * scale}px) scale(.5)` }], { duration: duration[name], delay: i * 90, iterations: loop ? Infinity : 1 }));
      }
    }
  }
  return {
    play,
    settings(settings) {
      const next = settings.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
      const changed = reduced !== next || scale !== settings.scale;
      reduced = next; scale = settings.scale; if (changed) play(pending, true);
    },
    hide() { hidden = true; stop(); current = ''; },
    show() { if (hidden) { hidden = false; play(pending, true); } },
  };
})();
