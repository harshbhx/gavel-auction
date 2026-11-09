// Slides 01 to 04 (broadside set). Each slide: html, js (setup + update(t, h)), T (loop seconds), poster (second).
import { ln, rule, frame, asset } from './kit.mjs';

/* ---------- 01 hero ---------- */
export const hero = {
  name: '01-hero',
  T: 5,
  poster: 3.3,
  html: `
<div class="a" style="left:990px;top:450px;width:0;height:0">
  <div class="wave" style="position:absolute;left:0;top:0;width:300px;height:300px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:300px;height:300px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:300px;height:300px;border-radius:50%;border:1px solid #ff6a1f;opacity:0"></div>
</div>
${frame({ lot: '01' })}
<div class="a" id="g" data-a="0" data-d=".2" style="left:840px;top:300px;width:300px;height:300px"></div>
${ln('Every bid', { x: 58, y: 140, size: 226, a: 0.15, d: 0.9 })}
${ln('is a <span class="or">hold.</span>', { x: 58, y: 336, size: 226, a: 0.3, d: 0.9 })}
${rule({ x: 64, y: 604, w: 1072, a: 0.9, d: 0.9 })}
${ln('The hammer is the charge.', { x: 64, y: 626, size: 40, fam: 'b', a: 1.15, d: 0.7 })}
`,
  js: `
var mk, waves;
function setup(h){
  mk = h.Mark(h.$('#g'), {size:300, swingStart:.3, swingDur:.85, echoes:[2.8]});
  waves = h.Waves(h.$$('.wave'), [mk.strike, 2.8], {min:.45, max:4.4, dur:1.5, alpha:.8});
}
function update(t,h){ mk.update(t); waves(t); }
`,
};

/* ---------- 02 how it works: a four line ledger ---------- */
export const how = {
  name: '02-how-it-works',
  T: 5,
  poster: 3.9,
  html: `
${frame({ lot: '02' })}
<div id="rows"></div>
${ln('Only the winning hold is captured.', { x: 64, y: 672, size: 30, fam: 'b', a: 3.1, d: 0.7 })}
`,
  js: `
var ROWS = [
  {w:'Hold', lab:'Held, not charged'},
  {w:'Bid', lab:'Prices only go up'},
  {w:'Hammer', lab:'The winner is named'},
  {w:'Receipt', lab:'Share link and QR'}
];
var Y0 = 112, RH = 136, act = [0.75, 1.5, 2.25, 3.0];
var rowEl = [], marks = [];
function setup(h){
  var html = '';
  ROWS.forEach(function(r,i){
    var y = Y0 + i*RH;
    html += '<div class="rl rr" style="left:64px;top:' + y + 'px;width:1072px"></div>';
    html += '<div class="a m ix" style="left:64px;top:' + (y+26) + 'px;font-size:18px;color:#cbbfa6">0' + (i+1) + '</div>';
    html += '<div class="ln" style="left:112px;top:' + (y+14) + 'px;width:520px;height:' + Math.round(120*.86) + 'px"><span class="d wd" style="font-size:120px;line-height:' + Math.round(120*.86) + 'px;color:#cbbfa6">' + r.w + '</span></div>';
    html += '<div class="ln" style="left:690px;top:' + (y+22) + 'px;width:440px;height:26px"><span class="m lb" style="font-size:16px;line-height:26px;color:#6f6250">' + r.lab + '</span></div>';
  });
  // visuals per row
  var y1 = Y0, y2 = Y0 + RH, y3 = Y0 + 2*RH, y4 = Y0 + 3*RH;
  html += '<div class="a hb" style="left:690px;top:' + (y1+66) + 'px;width:446px;height:30px;border:1.5px solid #1d1712;overflow:hidden"><div class="hf" style="height:100%;width:100%;background:repeating-linear-gradient(135deg,#ff6a1f 0 2px,transparent 2px 11px);transform-origin:0 50%"></div></div>';
  html += '<div class="ln" style="left:690px;top:' + (y2+46) + 'px;width:440px;height:92px"><span class="d pr" style="font-size:110px;line-height:92px;color:#1d1712">$10</span></div>';
  html += '<div class="a hm" style="left:1030px;top:' + (y3+30) + 'px"></div>';
  html += '<div class="ln" style="left:690px;top:' + (y3+46) + 'px;width:330px;height:92px"><span class="d sd" style="font-size:110px;line-height:92px;color:#ff6a1f">Sold</span></div>';
  html += '<svg class="a ck" viewBox="0 0 120 90" width="120" height="90" style="left:690px;top:' + (y4+48) + 'px;overflow:visible"><path class="ckp" pathLength="1" d="M8 48 L42 80 L112 8" fill="none" stroke="#ff6a1f" stroke-width="9" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="1"/></svg>';
  html += '<div class="rl rr" style="left:64px;top:' + (Y0 + 4*RH) + 'px;width:1072px"></div>';
  h.$('#rows').innerHTML = html;
  marks[2] = h.Mark(h.$('.hm'), {size:100, ringDone:true, swingStart:act[2]+.05, swingDur:.7});
}
function update(t,h){
  var rr = h.$$('.rr');
  rr.forEach(function(r,i){ h.draw(r, t, 0.05 + i*0.09, 0.8, 'x'); });
  h.$$('.wd').forEach(function(w,i){
    h.mask(w, t, 0.12 + i*0.1, 0.8);
    var on = t >= act[i] ? 1 : 0;
    w.style.color = on ? '#1d1712' : '#cbbfa6';
  });
  h.$$('.ix').forEach(function(x,i){ h.fade(x, t, 0.2 + i*0.1, 0.4); x.style.color = t >= act[i] ? '#ff6a1f' : '#cbbfa6'; });
  h.$$('.lb').forEach(function(l,i){ h.mask(l, t, act[i]-0.05, 0.6); });
  var hb = h.$('.hb'); h.fade(hb, t, act[0], 0.3);
  h.$('.hf').style.transform = 'scaleX(' + h.pr(t, act[0]+.05, .7, h.E.o4) + ')';
  var pe = h.$('.pr'); h.mask(pe, t, act[1], 0.6);
  var v = Math.round(10 + 10*h.pr(t, act[1]+.2, 1.0, h.E.io)); pe.textContent = '$' + v;
  pe.style.color = v >= 20 ? '#ff6a1f' : '#1d1712';
  marks[2].update(t);
  h.fade(h.$('.hm'), t, act[2], 0.2);
  h.mask(h.$('.sd'), t, act[2] + 0.62, 0.45);
  h.$('.ckp').setAttribute('stroke-dashoffset', 1 - h.pr(t, act[3]+.1, .55, h.E.io));
  h.fade(h.$('.ck'), t, act[3], 0.1);
}
`,
};

/* ---------- 03 architecture: thin line art ---------- */
export const arch = {
  name: '03-architecture',
  T: 5,
  poster: 3.7,
  html: `
${frame({ lot: '03' })}
<svg class="a" id="svg" width="1200" height="800" viewBox="0 0 1200 800" style="left:0;top:0;overflow:visible"></svg>
<div id="nodes"></div>
${ln('One bid.', { x: 60, y: 408, size: 124, a: 0.2, d: 0.85 })}
${ln('Four <span class="or">stops.</span>', { x: 60, y: 520, size: 124, a: 0.32, d: 0.85 })}
`,
  js: `
var N = [['Browser','Bidders and screen'],['Cloudflare','Web and docs'],['Render','Auction engine'],['PayPal','Holds and capture']];
var FS = 84, GAPX = 250, GAPY = 100, X0 = 64, Y0 = 128;
var pos = [], wid = [], words = [], under = [];
var t0 = [0.55, 1.15, 1.75, 2.35];
function setup(h){
  var html = '';
  N.forEach(function(n,i){
    var x = X0 + i*GAPX, y = Y0 + i*GAPY;
    html += '<div class="ln" style="left:' + x + 'px;top:' + y + 'px;width:460px;height:' + Math.round(FS*.86) + 'px"><span class="d nw" style="font-size:' + FS + 'px;line-height:' + Math.round(FS*.86) + 'px;display:inline-block">' + n[0] + '</span></div>';
    html += '<div class="ln" style="left:' + x + 'px;top:' + (y+88) + 'px;width:340px;height:22px"><span class="m nr" style="font-size:14px;line-height:22px;color:#6f6250">' + n[1] + '</span></div>';
  });
  h.$('#nodes').innerHTML = html;
  words = h.$$('.nw');
  words.forEach(function(w,i){ wid[i] = w.getBoundingClientRect().width; pos[i] = [X0 + i*GAPX, Y0 + i*GAPY]; });
  var s = '';
  N.forEach(function(n,i){
    var x = pos[i][0], y = pos[i][1] + 78;
    s += '<line class="ul" x1="' + x + '" y1="' + y + '" x2="' + (x+wid[i]) + '" y2="' + y + '" stroke="#ff6a1f" stroke-width="3"/>';
    if(i<3){
      var ex = x + wid[i], nx = pos[i+1][0] + 12, ny = pos[i+1][1] - 12;
      s += '<path class="cn" pathLength="1" d="M' + ex + ' ' + y + ' H' + nx + ' V' + ny + '" fill="none" stroke="#1d1712" stroke-width="1.5" stroke-dasharray="1"/>';
      s += '<path class="ar" d="M' + (nx-5) + ' ' + (ny-8) + ' L' + nx + ' ' + ny + ' L' + (nx+5) + ' ' + (ny-8) + '" fill="none" stroke="#1d1712" stroke-width="1.5"/>';
    }
  });
  var ey = pos[3][1] + 128, sx = pos[3][0] + wid[3]/2;
  s += '<path id="ret" pathLength="1" d="M' + sx + ' ' + (pos[3][1]+116) + ' V' + 692 + ' H64" fill="none" stroke="#1d1712" stroke-width="1.5" stroke-dasharray="1"/>';
  s += '<path id="rar" d="M72 685 L64 692 L72 699" fill="none" stroke="#1d1712" stroke-width="1.5"/>';
  s += '<circle id="dot" r="6" fill="#ff6a1f"/>';
  h.$('#svg').innerHTML = s;
  h.$('#svg').insertAdjacentHTML('afterend', '<div class="ln" style="left:64px;top:704px;width:600px;height:26px"><span class="m rl2" style="font-size:15px;line-height:26px;color:#1d1712">Receipt, written to the ledger</span></div>');
}
function update(t,h){
  var ex = h.exitp(t), E = h.E;
  words.forEach(function(w,i){ h.mask(w, t, 0.1 + i*0.12, 0.8); });
  h.$$('.nr').forEach(function(r,i){ h.mask(r, t, 0.3 + i*0.12, 0.6); });
  var uls = h.$$('.ul'), cns = h.$$('.cn'), ars = h.$$('.ar');
  var dx = -50, dy = -50, dop = 0;
  N.forEach(function(n,i){
    var x = pos[i][0], y = pos[i][1] + 78;
    var pu = h.pr(t, t0[i], 0.32, E.io);
    uls[i].setAttribute('x2', x + wid[i]*pu); uls[i].setAttribute('opacity', 1 - ex);
    if(i<3){
      var pc = h.pr(t, t0[i]+.32, 0.26, E.io);
      cns[i].setAttribute('stroke-dashoffset', 1 - pc); cns[i].setAttribute('opacity', 1 - ex);
      ars[i].setAttribute('opacity', (pc > .98 ? 1 : 0) * (1 - ex));
      var nx = pos[i+1][0] + 12, ny = pos[i+1][1] - 12, exx = x + wid[i];
      var L1 = nx - exx, L2 = ny - y, tot = L1 + L2;
      if(t >= t0[i] && t < t0[i]+.58){
        if(t < t0[i]+.32){ dx = x + wid[i]*pu; dy = y; }
        else { var d2 = pc*tot; if(d2 < L1){ dx = exx + d2; dy = y; } else { dx = nx; dy = y + (d2-L1); } }
        dop = 1;
      }
    }
  });
  // last node underline then return line
  var uP = h.pr(t, t0[3], 0.32, E.io);
  if(t >= t0[3] && t < t0[3]+.32){ dx = pos[3][0] + wid[3]*uP; dy = pos[3][1] + 78; dop = 1; }
  var rp = h.pr(t, 2.8, 0.9, E.io), sx = pos[3][0] + wid[3]/2, top = pos[3][1] + 116;
  var Lr1 = 692 - top, Lr2 = sx - 64;
  h.$('#ret').setAttribute('stroke-dashoffset', 1 - rp); h.$('#ret').setAttribute('opacity', 1 - ex);
  h.$('#rar').setAttribute('opacity', (rp > .98 ? 1 : 0) * (1 - ex));
  if(t >= 2.8 && t < 3.7){ var d3 = rp*(Lr1+Lr2); if(d3 < Lr1){ dx = sx; dy = top + d3; } else { dx = sx - (d3-Lr1); dy = 692; } dop = 1; }
  var dot = h.$('#dot'); dot.setAttribute('cx', dx); dot.setAttribute('cy', dy); dot.setAttribute('opacity', dop * (1 - ex));
  h.mask(h.$('.rl2'), t, 3.4, 0.6);
}
`,
};

/* ---------- 04 judge flow: real frames, hard-cropped ---------- */
const shots = [
  ['readme/see-it-run-1-start-room.png', 'Room', 500],
  ['readme/see-it-run-3-bids.png', 'Bid', 700],
  ['readme/see-it-run-4-hammer.png', 'Hammer', 480],
  ['readme/see-it-run-6-receipt.png', 'Receipt', 300],
];
export const judge = {
  name: '04-judge-flow',
  T: 5,
  poster: 3.7,
  html: `
<div class="a" id="pics" style="left:452px;top:0;width:748px;height:800px;overflow:hidden"></div>
${frame({ lot: '04', ruleW: 356, side: true })}
${ln('Try it', { x: 58, y: 132, size: 112, a: 0.15, d: 0.85 })}
${ln('in two', { x: 58, y: 232, size: 112, a: 0.27, d: 0.85 })}
${ln('<span class="or">minutes.</span>', { x: 58, y: 332, size: 112, a: 0.39, d: 0.85 })}
<div id="list"></div>
${ln('gavel.dualmindlab.tech/try', { x: 64, y: 708, size: 18, fam: 'm', a: 1.0, d: 0.6, w: 360, color: 'var(--ink);text-transform:none' })}
`,
  js: `
var SH = ${JSON.stringify(shots.map(([f, l, fx]) => [asset('docs/assets/' + f), l, fx]))};
var SC = 1.4, VW = 748, VH = 800;
var pics = [], lis = [], nums = [];
function setup(h){
  var html = '';
  SH.forEach(function(s,i){
    var left = -Math.max(0, Math.min(960*SC - VW, s[2]*SC - VW/2));
    html += '<div class="a pc" style="left:0;top:0;width:' + VW + 'px;height:' + VH + 'px;overflow:hidden"><img src="' + s[0] + '" style="position:absolute;left:' + left + 'px;top:0;width:' + (960*SC) + 'px;height:' + (600*SC) + 'px"></div>';
  });
  h.$('#pics').innerHTML = html;
  pics = h.$$('.pc');
  var l = '';
  SH.forEach(function(s,i){
    var y = 548 + i*38;
    l += '<div class="a m ni" style="left:64px;top:' + (y+8) + 'px;font-size:15px;color:#cbbfa6">0' + (i+1) + '</div><div class="ln" style="left:112px;top:' + y + 'px;width:300px;height:36px"><span class="d li" style="font-size:36px;line-height:36px;color:#cbbfa6">' + s[1] + '</span></div>';
  });
  h.$('#list').innerHTML = l;
  lis = h.$$('.li'); nums = h.$$('.ni');
}
var STEP = [1.05, 1.9, 2.75], TD = 0.5;
function update(t,h){
  var ex = h.exitp(t), E = h.E;
  var cur = 0; for(var i=0;i<3;i++) if(t >= STEP[i]) cur = i+1;
  pics.forEach(function(p,k){
    var show = 0, clip = 100;
    if(k === 0){ var en = h.pr(t, 0.1, 0.7, E.io); clip = (1-en)*100; }
    else { var pk = h.pr(t, STEP[k-1], TD, E.io); clip = (1-pk)*100; }
    // later pictures cover earlier ones: wipe in from the right edge of the crop
    p.style.clipPath = 'inset(0 0 0 ' + clip + '%)';
    p.style.zIndex = k;
    if(ex > 0) p.style.clipPath = 'inset(0 0 0 ' + (ex*100) + '%)';
  });
  lis.forEach(function(el,k){
    h.mask(el, t, 0.5 + k*0.08, 0.6);
    el.style.color = k === cur ? '#1d1712' : '#cbbfa6';
  });
  nums.forEach(function(el,k){ h.fade(el, t, 0.55 + k*0.08, 0.4); el.style.color = k === cur ? '#ff6a1f' : '#cbbfa6'; });
}
`,
};
