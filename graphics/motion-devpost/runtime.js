/* global window, document */
/* Browser-side runtime for the Devpost slides. Every slide is a pure function of time t (seconds, looping
   at SCENE_T), so a render is deterministic and frame 0 already moves. The slide script defines
   `update(t, h)` and may define `setup(h)`. Helpers: E (easings), cl, pr (progress), exitp, Mark. */
(function () {
  var T = window.SCENE_T;
  var EXIT = 0.5;
  var E = {
    lin: function (x) {
      return x;
    },
    o2: function (x) {
      return 1 - Math.pow(1 - x, 2);
    },
    o3: function (x) {
      return 1 - Math.pow(1 - x, 3);
    },
    o4: function (x) {
      return 1 - Math.pow(1 - x, 4);
    },
    o5: function (x) {
      return 1 - Math.pow(1 - x, 5);
    },
    i2: function (x) {
      return x * x;
    },
    i3: function (x) {
      return x * x * x;
    },
    io: function (x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    },
    back: function (x) {
      var c = 1.35;
      return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
    },
  };
  var cl = function (x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  };
  var pr = function (t, a, d, e) {
    return (e || E.o3)(cl((t - a) / d));
  };
  var exitp = function (t) {
    return E.io(cl((t - (T - EXIT)) / EXIT));
  };
  var lerp = function (a, b, p) {
    return a + (b - a) * p;
  };

  /* The Mallet G, driven by time. Geometry is copied from brand/svg/mark-color.svg, never redrawn.
     o: size, ink, ringStart, ringDone, swingStart, swingDur, echoes (extra strike times, seconds). */
  function Mark(host, o) {
    o = o || {};
    var ink = o.ink || '#1d1712';
    var ringStart = o.ringStart == null ? 0 : o.ringStart;
    var swingStart = o.swingStart == null ? 0.3 : o.swingStart;
    var swingDur = o.swingDur || 0.9;
    var strike = swingStart + 0.72 * swingDur;
    var strikes = [strike].concat(o.echoes || []);
    var size = o.size || 200;
    host.innerHTML =
      '<svg viewBox="-22 -22 144 144" width="' +
      size +
      '" height="' +
      size +
      '" style="overflow:visible;display:block" role="img" aria-label="GAVEL">' +
      '<g class="jolt"><circle class="s0" cx="50" cy="50" r="46" fill="none" stroke="#ff6a1f" stroke-width="3.5" opacity="0"/>' +
      '<circle class="s1" cx="50" cy="50" r="46" fill="none" stroke="#ff6a1f" stroke-width="1.6" opacity="0"/>' +
      '<path class="ring" pathLength="1" d="M78.98 23.90A39 39 0 1 0 89.00 50.00" fill="none" stroke="' +
      ink +
      '" stroke-width="22" stroke-dasharray="1"/>' +
      '<g class="mal"><rect x="40" y="43.5" width="60" height="13" fill="' +
      ink +
      '"/><rect x="32" y="33" width="16" height="34" rx="3" fill="#ff6a1f"/></g></g></svg>';
    var jolt = host.querySelector('.jolt'),
      ring = host.querySelector('.ring'),
      mal = host.querySelector('.mal');
    var s0 = host.querySelector('.s0'),
      s1 = host.querySelector('.s1');
    function update(t) {
      ring.setAttribute('stroke-dashoffset', o.ringDone ? 0 : 1 - E.io(cl((t - ringStart) / 0.6)));
      var u = (t - swingStart) / swingDur,
        ang = 0,
        op = 1;
      if (o.ringDone && o.swingStart == null) u = 2;
      if (u < 0) {
        op = 0;
        ang = 72;
      } else if (u < 0.08) {
        op = u / 0.08;
        ang = 72;
      } else if (u < 0.58) ang = lerp(72, 94, E.io((u - 0.08) / 0.5));
      else if (u < 0.72) ang = lerp(94, 0, Math.pow((u - 0.58) / 0.14, 2.2));
      else ang = 0;
      mal.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' 100 50)');
      mal.setAttribute('opacity', op);
      var sc = 1,
        a0 = 0,
        k0 = 0,
        a1 = 0,
        k1 = 0;
      for (var i = 0; i < strikes.length; i++) {
        var x = (t - strikes[i]) / 0.38;
        if (x > 0 && x < 1) sc = Math.min(sc, 1 - 0.07 * Math.sin(Math.PI * E.o2(x)));
        var w = (t - strikes[i]) / 0.85;
        if (w > 0 && w < 1) {
          var e = E.o4(w);
          a0 = 0.9 * (1 - w);
          k0 = lerp(0.8, 1.85, e);
        }
        var w1 = (t - strikes[i] - 0.14) / 0.85;
        if (w1 > 0 && w1 < 1) {
          var e1 = E.o4(w1);
          a1 = 0.7 * (1 - w1);
          k1 = lerp(0.8, 2.2, e1);
        }
      }
      jolt.setAttribute(
        'transform',
        'translate(50 50) scale(' + sc.toFixed(4) + ') translate(-50 -50)',
      );
      s0.setAttribute('opacity', a0);
      s0.setAttribute(
        'transform',
        'translate(50 50) scale(' + k0.toFixed(3) + ') translate(-50 -50)',
      );
      s1.setAttribute('opacity', a1);
      s1.setAttribute(
        'transform',
        'translate(50 50) scale(' + k1.toFixed(3) + ') translate(-50 -50)',
      );
    }
    return { update: update, strike: strike };
  }

  /* A wide ring that leaves a point (stage level shockwave). rings: elements with class .wave */
  function Waves(els, strikes, o) {
    o = o || {};
    var dur = o.dur || 1.3,
      max = o.max || 3.2,
      min = o.min || 0.3;
    return function (t) {
      els.forEach(function (el, i) {
        var best = 0,
          sc = min;
        strikes.forEach(function (s) {
          var w = (t - s - i * 0.16) / dur;
          if (w > 0 && w < 1) {
            best = (o.alpha || 0.55) * Math.pow(1 - w, 1.4);
            sc = lerp(min, max, E.o4(w));
          }
        });
        el.style.opacity = best;
        el.style.transform = 'translate(-50%,-50%) scale(' + sc.toFixed(3) + ')';
      });
    };
  }

  /* Reveal primitives. mask: type rises out of a clipped line. draw: a hairline draws itself. fade: plain. */
  function mask(el, t, a, d) {
    var en = pr(t, a, d || 0.75, E.o5),
      ex = exitp(t);
    el.style.transform = 'translateY(' + ((1 - en) * 108 - ex * 108).toFixed(2) + '%)';
  }
  function draw(el, t, a, d, axis) {
    var en = pr(t, a, d || 0.8, E.io),
      ex = exitp(t),
      v = ex > 0 ? 1 - ex : en;
    var y = axis === 'y';
    el.style.transformOrigin = y ? (ex > 0 ? '50% 100%' : '50% 0') : ex > 0 ? '100% 50%' : '0 50%';
    el.style.transform = y ? 'scaleY(' + v.toFixed(4) + ')' : 'scaleX(' + v.toFixed(4) + ')';
  }
  function fade(el, t, a, d) {
    var ex = exitp(t);
    el.style.opacity = pr(t, a, d || 0.5, E.o2) * (1 - ex);
  }
  function reveal(el, t) {
    var a = +el.dataset.a,
      d = el.dataset.d ? +el.dataset.d : 0,
      k = el.dataset.k || 'fade';
    if (k === 'mask') mask(el, t, a, d);
    else if (k === 'draw') draw(el, t, a, d, 'x');
    else if (k === 'drawy') draw(el, t, a, d, 'y');
    else fade(el, t, a, d);
  }

  var H = {
    E: E,
    cl: cl,
    pr: pr,
    exitp: exitp,
    lerp: lerp,
    Mark: Mark,
    Waves: Waves,
    T: T,
    $: function (s) {
      return document.querySelector(s);
    },
    $$: function (s) {
      return Array.prototype.slice.call(document.querySelectorAll(s));
    },
  };
  window.__H = H;

  window.__seek = function (ms) {
    var t = (((ms / 1000 + 0.12) % T) + T) % T;
    H.$$('[data-a]').forEach(function (el) {
      reveal(el, t);
    });
    if (window.update) window.update(t, H);
  };

  window.addEventListener('DOMContentLoaded', function () {
    if (window.setup) window.setup(H);
    window.__seek(0);
  });
})();
