// Slides 05 to 08 (broadside set, see slides-a.mjs for the format).
import { ln, vrule, frame, lockupLetters } from './kit.mjs';

/* ---------- 05 audit and verify: the ledger chain, drawn ---------- */
export const audit = {
  name: '05-audit-and-verify',
  T: 5,
  poster: 3.9,
  html: `
${frame({ lot: '05' })}
${ln('Do not trust. <span class="or">Verify.</span>', { x: 60, y: 112, size: 104, a: 0.1, d: 0.85 })}
<div id="led"></div>
${vrule({ x: 596, y: 250, h: 368, a: 0.5, d: 1.8, color: '#ff6a1f', w: 3 })}
${ln('Chain verified', { x: 60, y: 636, size: 76, a: 3.0, d: 0.8, color: 'var(--orange)' })}
${ln('Anyone can re-check the public export.', { x: 600, y: 664, size: 24, fam: 'b', a: 3.2, d: 0.7, w: 540 })}
${ln('Illustration: shortened example hashes', { x: 64, y: 712, size: 14, fam: 'm', color: 'var(--mute)', a: 3.3, d: 0.6, w: 500 })}
`,
  js: `
var EV = [['Hold','a41f90c2','start'],['Bid','7be3d518','a41f'],['Bid','55e0c1aa','7be3'],['Hammer','1d6fa8b3','55e0']];
var Y0 = 250, RH = 92;
function setup(h){
  var html = '';
  EV.forEach(function(e,i){
    var y = Y0 + i*RH;
    html += '<div class="rl rr" style="left:64px;top:' + y + 'px;width:1072px"></div>';
    html += '<div class="a m ix" style="left:64px;top:' + (y+34) + 'px;font-size:16px;color:#6f6250">0' + (i+1) + '</div>';
    html += '<div class="ln" style="left:112px;top:' + (y+12) + 'px;width:470px;height:70px"><span class="d ev" style="font-size:80px;line-height:70px">' + e[0] + '</span></div>';
    html += '<div class="rl tk" style="left:596px;top:' + (y+46) + 'px;width:36px;background:#ff6a1f;height:3px"></div>';
    html += '<div class="ln" style="left:648px;top:' + (y+24) + 'px;width:300px;height:44px"><span class="m hs" style="font-size:34px;line-height:44px;letter-spacing:.02em;text-transform:none">' + e[1] + '</span></div>';
    html += '<div class="ln" style="left:960px;top:' + (y+36) + 'px;width:176px;height:24px"><span class="m pv" style="font-size:15px;line-height:24px;color:#6f6250;text-align:right">' + (i === 0 ? 'first entry' : 'prev ' + e[2]) + '</span></div>';
    html += '<div class="rl ul" style="left:648px;top:' + (y+68) + 'px;width:178px;background:#ff6a1f;height:3px"></div>';
  });
  html += '<div class="rl rr" style="left:64px;top:' + (Y0 + 4*RH) + 'px;width:1072px"></div>';
  h.$('#led').innerHTML = html;
}
function update(t,h){
  h.$$('.rr').forEach(function(r,i){ h.draw(r, t, 0.2 + i*0.1, 0.8, 'x'); });
  h.$$('.ev').forEach(function(e,i){ h.mask(e, t, 0.4 + i*0.38, 0.7); });
  h.$$('.ix').forEach(function(e,i){ h.fade(e, t, 0.4 + i*0.38, 0.4); });
  h.$$('.hs').forEach(function(e,i){ h.mask(e, t, 0.55 + i*0.38, 0.7); });
  h.$$('.pv').forEach(function(e,i){ h.mask(e, t, 0.65 + i*0.38, 0.6); });
  h.$$('.tk').forEach(function(e,i){ h.draw(e, t, 0.6 + i*0.38, 0.3, 'x'); });
  h.$$('.ul').forEach(function(e,i){ h.draw(e, t, 2.2 + i*0.18, 0.4, 'x'); });
}
`,
};

/* ---------- 06 partners: names set in type ---------- */
export const partners = {
  name: '06-partners',
  T: 5,
  poster: 3.7,
  html: `
${frame({ lot: '06' })}
${ln('Built with the <span class="or">best.</span>', { x: 62, y: 108, size: 60, a: 0.1, d: 0.8 })}
<div id="names"></div>
`,
  js: `
var P = [['PayPal','Payments'],['Cloudflare','Web and docs'],['Render','API hosting'],['AG Grid','Data tables'],['Hugging Face','Open datasets']];
var Y0 = 200, RH = 100;
function lerp3(a,b,p){ return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*p) + ',' + Math.round(a[1]+(b[1]-a[1])*p) + ',' + Math.round(a[2]+(b[2]-a[2])*p) + ')'; }
function setup(h){
  var html = '';
  P.forEach(function(p,i){
    var y = Y0 + i*RH;
    html += '<div class="rl rr" style="left:64px;top:' + y + 'px;width:1072px"></div>';
    html += '<div class="ln" style="left:60px;top:' + (y+8) + 'px;width:760px;height:84px"><span class="d nm" style="font-size:98px;line-height:84px">' + p[0] + '</span></div>';
    html += '<div class="ln" style="left:836px;top:' + (y+36) + 'px;width:300px;height:26px"><span class="m ro" style="font-size:16px;line-height:26px;color:#6f6250;text-align:right">' + p[1] + '</span></div>';
  });
  html += '<div class="rl rr" style="left:64px;top:' + (Y0 + 5*RH) + 'px;width:1072px"></div>';
  h.$('#names').innerHTML = html;
}
function update(t,h){
  h.$$('.rr').forEach(function(r,i){ h.draw(r, t, 0.15 + i*0.08, 0.8, 'x'); });
  h.$$('.nm').forEach(function(e,i){
    h.mask(e, t, 0.3 + i*0.1, 0.8);
    var on = h.pr(t, 1.7 + i*0.38, 0.2, h.E.o3) * (1 - h.pr(t, 1.7 + i*0.38 + 0.45, 0.25, h.E.io));
    e.style.color = lerp3([29,23,18],[255,106,31],on);
  });
  h.$$('.ro').forEach(function(e,i){ h.mask(e, t, 0.5 + i*0.1, 0.6); });
}
`,
};

/* ---------- 07 open data and honest gates ---------- */
export const data = {
  name: '07-open-data-and-gates',
  T: 5,
  poster: 3.7,
  html: `
${frame({ lot: '07' })}
${ln('The', { x: 58, y: 118, size: 150, a: 0.1, d: 0.85 })}
${ln('evidence', { x: 58, y: 246, size: 150, a: 0.2, d: 0.85 })}
${ln('is <span class="or">open.</span>', { x: 58, y: 374, size: 150, a: 0.3, d: 0.85 })}
${ln('Real or simulated,', { x: 64, y: 568, size: 30, fam: 'b', a: 1.0, d: 0.7, w: 480 })}
${ln('every file says which.', { x: 64, y: 608, size: 30, fam: 'b', a: 1.08, d: 0.7, w: 480 })}
<div id="led"></div>
`,
  js: `
var D = [['gavel-gates','Real sandbox'],['gavel-latency','Real sandbox'],['gavel-sim-30d','Simulated'],['gavel-stt-bids','Synthetic audio'],['gavel-audit-demo','Simulated']];
var X0 = 640, Y0 = 164, RH = 96, NW = [250,290,300,310,360];
function setup(h){
  var html = '';
  html += '<div class="ln" style="left:' + X0 + 'px;top:112px;width:496px;height:30px"><span class="m cnt" style="font-size:18px;line-height:30px;color:#1d1712">00 datasets</span></div>';
  D.forEach(function(d,i){
    var y = Y0 + i*RH;
    html += '<div class="rl rr" style="left:' + X0 + 'px;top:' + y + 'px;width:496px"></div>';
    html += '<div class="ln" style="left:' + X0 + 'px;top:' + (y+22) + 'px;width:340px;height:44px"><span class="m dn" style="font-size:30px;line-height:44px;letter-spacing:0;text-transform:none">' + d[0] + '</span></div>';
    html += '<div class="ln" style="left:' + (X0+330) + 'px;top:' + (y+36) + 'px;width:166px;height:24px"><span class="m dl" style="font-size:13px;line-height:24px;color:#6f6250;text-align:right">' + d[1] + '</span></div>';
    html += '<div class="rl ul" style="left:' + X0 + 'px;top:' + (y+72) + 'px;width:' + NW[i]*0.78 + 'px;background:#ff6a1f;height:3px"></div>';
  });
  html += '<div class="rl rr" style="left:' + X0 + 'px;top:' + (Y0 + 5*RH) + 'px;width:496px"></div>';
  html += '<div class="ln" style="left:' + X0 + 'px;top:' + (Y0 + 5*RH + 14) + 'px;width:496px;height:26px"><span class="m sm" style="font-size:14px;line-height:26px;color:#6f6250">sha256 manifest on every file</span></div>';
  h.$('#led').innerHTML = html;
}
function update(t,h){
  h.$$('.rr').forEach(function(r,i){ h.draw(r, t, 0.2 + i*0.1, 0.8, 'x'); });
  h.$$('.dn').forEach(function(e,i){ h.mask(e, t, 0.45 + i*0.14, 0.7); });
  h.$$('.dl').forEach(function(e,i){ h.mask(e, t, 0.6 + i*0.14, 0.6); });
  h.$$('.ul').forEach(function(e,i){ h.draw(e, t, 2.0 + i*0.22, 0.45, 'x'); });
  var c = h.$('.cnt'); h.mask(c, t, 0.3, 0.6);
  var n = Math.round(5*h.pr(t, 0.5, 1.0, h.E.io)); c.textContent = '0' + n + ' datasets';
  h.mask(h.$('.sm'), t, 2.9, 0.6);
}
`,
};

/* ---------- 08 ending ---------- */
const L = lockupLetters();
export const ending = {
  name: '08-ending',
  T: 5,
  poster: 3.6,
  html: `
<div class="a" style="left:174px;top:222px;width:0;height:0">
  <div class="wave" style="position:absolute;left:0;top:0;width:240px;height:240px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:240px;height:240px;border-radius:50%;border:1px solid #ff6a1f;opacity:0"></div>
</div>
${frame({ lot: '08', foot: 'PayPal sandbox only. Bids are held, not charged.', mast: false })}
<div class="a" id="lk" data-a="0" data-d=".2" style="left:64px;top:112px;width:688px;height:220px"></div>
<div id="lnk"></div>
`,
  js: `
var LETTERS = ${JSON.stringify(L)};
var mk, waves, lets = [];
var LINKS = [['Web app','gavel.dualmindlab.tech'],['Docs','docs.gavel.dualmindlab.tech'],['Source','github.com/harshbhx/gavel-auction']];
function setup(h){
  var host = h.$('#lk');
  host.innerHTML = '<div id="lkm" style="position:absolute;left:0;top:0;width:220px;height:220px"></div><svg viewBox="-22 -22 450.24 144" style="position:absolute;left:0;top:0;width:688px;height:220px;overflow:visible"><g transform="translate(126 19) scale(0.62)">' + LETTERS.map(function(l){ return '<g class="lt">' + l + '</g>'; }).join('') + '</g></svg>';
  mk = h.Mark(h.$('#lkm'), {size:220, swingStart:.25, swingDur:.85});
  lets = h.$$('.lt');
  waves = h.Waves(h.$$('.wave'), [mk.strike], {min:.45, max:5.2, dur:1.5, alpha:.8});
  var html = '';
  LINKS.forEach(function(l,i){
    var y = 404 + i*100;
    html += '<div class="rl rr" style="left:64px;top:' + y + 'px;width:1072px"></div>';
    html += '<div class="ln" style="left:64px;top:' + (y+40) + 'px;width:200px;height:24px"><span class="m lb" style="font-size:16px;line-height:24px;color:#6f6250">' + l[0] + '</span></div>';
    html += '<div class="ln" style="left:300px;top:' + (y+18) + 'px;width:830px;height:62px"><span class="d ur" style="font-size:70px;line-height:62px;text-transform:lowercase">' + l[1] + '</span></div>';
  });
  html += '<div class="rl rr" style="left:64px;top:704px;width:1072px"></div>';
  h.$('#lnk').innerHTML = html;
}
function update(t,h){
  mk.update(t); waves(t);
  lets.forEach(function(g,i){
    var p = h.pr(t, 0.95 + i*0.07, 0.6, h.E.o5);
    g.setAttribute('transform', 'translate(' + h.lerp(i === 0 ? 0 : -60, 0, p).toFixed(2) + ' 0)');
    g.setAttribute('opacity', Math.min(1, p*2.5) * (1 - h.exitp(t)));
  });
  h.$$('.rr').forEach(function(r,i){ h.draw(r, t, 1.4 + i*0.14, 0.7, 'x'); });
  h.$$('.lb').forEach(function(e,i){ h.mask(e, t, 1.6 + i*0.14, 0.6); });
  h.$$('.ur').forEach(function(e,i){ h.mask(e, t, 1.55 + i*0.14, 0.8); });
}
`,
};
