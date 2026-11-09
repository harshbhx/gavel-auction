// Slides 05 to 08 (see slides-a.mjs for the format).
import { lockupLetters } from './kit.mjs';

/* ---------- 05 audit and verify ---------- */
export const audit = {
  name: '05-audit-and-verify',
  T: 5,
  poster: 3.9,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:106px;font-size:132px">Do not trust<span class="or">.</span> <span class="or">Verify.</span></div>
<div id="links"></div>
<svg class="a" id="joins" width="1200" height="400" viewBox="0 0 1200 400" style="left:0;top:0"></svg>
<div class="a" id="proof" data-a="3.2" data-d=".6" data-dy="30" data-e="back" style="left:72px;top:604px"></div>
<div class="a sub" data-a="3.4" data-d=".6" data-dy="18" style="left:424px;top:612px;font-size:30px;color:var(--ink);font-weight:600">Anyone can re-check the public export.</div>
<div class="a" data-a="3.6" data-d=".5" data-dy="14" style="left:72px;top:712px"><span class="chip"><i></i>Illustration: shortened example hashes</span></div>
`,
  js: `
var items = [['Hold','a41f90c2'],['Bid','7be3d518'],['Bid','55e0c1aa'],['Hammer','1d6fa8b3']];
var LW = 232, LG = 42, LX = 72, LY = 310, LH = 200;
var land = [0.45, 0.8, 1.15, 1.5];
var els = [];
function setup(h){
  var html = '';
  items.forEach(function(it,i){
    html += '<div class="a card lk" data-a="0" data-d="0" style="left:' + (LX + i*(LW+LG)) + 'px;top:' + LY + 'px;width:' + LW + 'px;height:' + LH + 'px;padding:26px 26px"><div style="font:800 48px/1 var(--display);text-transform:uppercase;letter-spacing:.01em">' + it[0] + '</div><div class="mono" style="font:700 24px/1 var(--mono);letter-spacing:.02em;color:var(--muted);margin-top:22px">' + it[1] + '</div><div style="font:600 13px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--rule);margin-top:14px">' + (i === 0 ? 'start' : 'prev ' + items[i-1][1].slice(0,4)) + '</div><svg class="vk" viewBox="0 0 60 60" width="44" height="44" style="position:absolute;right:20px;bottom:20px;overflow:visible"><circle cx="30" cy="30" r="27" fill="#256b3a"/><path class="vkp" pathLength="1" d="M17 31 l9 9 l17 -19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/></svg></div>';
  });
  h.$('#links').innerHTML = html;
  els = h.$$('.lk');
  var j = '';
  for(var i=0;i<3;i++){
    var x1 = LX + i*(LW+LG) + LW, x2 = x1 + LG, y = LY + LH/2;
    j += '<line class="jl" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#ff6a1f" stroke-width="5" stroke-linecap="round"/>';
  }
  h.$('#joins').innerHTML = j;
  h.$('#proof').innerHTML = '<div class="card" style="height:68px;border-radius:34px;padding:0 30px 0 14px;display:flex;align-items:center;gap:16px;width:326px"><svg viewBox="0 0 60 60" width="42" height="42" style="overflow:visible"><circle cx="30" cy="30" r="27" fill="#256b3a"/><path d="M17 31 l9 9 l17 -19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="font:800 38px/1 var(--display);text-transform:uppercase;letter-spacing:.02em;color:var(--green)">Chain verified</span></div>';
}
function update(t,h){
  var ex = h.exitp(t);
  els.forEach(function(c,k){
    var en = h.pr(t, land[k]-.55, .55, h.E.o4);
    // slides in from the right with a tiny settle at the moment of the snap
    var settle = 0, d = t - land[k]; if(d>0 && d<.3) settle = Math.sin(Math.PI*d/.3)*5;
    var vp = h.pr(t, 2.2 + k*.28, .45, h.E.o3), vtick = h.pr(t, 2.2 + k*.28, .3, h.E.lin);
    c.style.opacity = en*(1-ex);
    c.style.transform = 'translate(' + ((1-en)*260 - settle*0).toFixed(1) + 'px,' + (-ex*18 + settle*0).toFixed(1) + 'px) scale(' + (1 - .02*Math.sin(Math.PI*h.cl(d/.3))).toFixed(4) + ')';
    var g = vp;
    c.style.boxShadow = '0 0 0 ' + (1+2*g) + 'px ' + (g>.02 ? 'rgba(37,107,58,' + (.15+.85*g).toFixed(2) + ')' : 'rgba(29,23,18,.09)') + ',0 1px 0 rgba(255,255,255,.8) inset,0 30px 50px -22px rgba(29,23,18,.32),0 8px 16px -8px rgba(29,23,18,.16)';
    var vk = c.querySelector('.vk'); vk.style.transform = 'scale(' + h.pr(t, 2.2+k*.28, .4, h.E.back) + ')'; vk.style.transformOrigin = '30px 30px';
    c.querySelector('.vkp').setAttribute('stroke-dashoffset', 1 - h.pr(t, 2.3+k*.28, .3, h.E.o3));
  });
  h.$$('.jl').forEach(function(l,k){
    var p = h.pr(t, land[k+1]-.15, .3, h.E.o3);
    var x1 = +l.getAttribute('x1'), x2 = x1 + LG;
    l.setAttribute('x2', x1 + (x2-x1)*p);
    l.setAttribute('opacity', (p>0?1:0)*(1-ex));
    var v = h.pr(t, 2.2 + (k+1)*.28, .3, h.E.lin);
    l.setAttribute('stroke', v > .5 ? '#256b3a' : '#ff6a1f');
  });
}
`,
};

/* ---------- 06 partners ---------- */
export const partners = {
  name: '06-partners',
  T: 5,
  poster: 3.8,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:106px;font-size:132px">Built with the <span class="or">best</span><span class="or">.</span></div>
<div id="tiles"></div>
<div class="a" data-a="2.6" data-d=".5" data-dy="14" style="left:72px;top:704px"><span class="chip"><i></i>PayPal sandbox only</span></div>
`,
  js: `
var T5 = [['PayPal','Payments'],['Cloudflare','Web and docs'],['Render','API hosting'],['AG Grid','Data tables'],['Hugging Face','Open datasets']];
var TW = 200, TG = 14, TX = 72, TY = 320, TH = 280;
var tl = [];
function setup(h){
  var html = '';
  T5.forEach(function(n,i){
    var nm = n[0].split(' ');
    html += '<div class="a card tl" data-a="0" data-d="0" style="left:' + (TX + i*(TW+TG)) + 'px;top:' + TY + 'px;width:' + TW + 'px;height:' + TH + 'px;padding:28px 24px"><div class="nm" style="font:800 46px/.95 var(--display);text-transform:uppercase;letter-spacing:.01em">' + nm.join('<br>') + '</div><div class="rl" style="position:absolute;left:24px;bottom:56px;font:600 20px/1.2 var(--body);color:var(--muted)">' + n[1] + '</div><div class="ul" style="position:absolute;left:24px;bottom:30px;height:6px;width:60px;border-radius:3px;background:var(--orange);transform-origin:0 50%"></div></div>';
  });
  h.$('#tiles').innerHTML = html;
  tl = h.$$('.tl');
}
function update(t,h){
  var ex = h.exitp(t);
  tl.forEach(function(c,k){
    var en = h.pr(t, .15 + k*.11, .7, h.E.o4);
    var on = h.pr(t, 1.3 + k*.42, .3, h.E.o3) * (1 - h.pr(t, 1.3 + k*.42 + .75, .35, h.E.io));
    c.style.opacity = Math.min(1, en*2)*(1-ex);
    c.style.transform = 'translateY(' + ((1-en)*80 - ex*18 - 12*on).toFixed(1) + 'px)';
    var bg = on; // fades to ink and back
    c.style.background = 'rgb(' + Math.round(251 + (29-251)*bg) + ',' + Math.round(246 + (23-246)*bg) + ',' + Math.round(234 + (18-234)*bg) + ')';
    c.querySelector('.nm').style.color = 'rgb(' + Math.round(29 + (239-29)*bg) + ',' + Math.round(23 + (230-23)*bg) + ',' + Math.round(18 + (211-18)*bg) + ')';
    c.querySelector('.rl').style.color = 'rgb(' + Math.round(90 + (201-90)*bg) + ',' + Math.round(77 + (185-77)*bg) + ',' + Math.round(63 + (154-63)*bg) + ')';
    var ul = c.querySelector('.ul'); ul.style.transform = 'scaleX(' + (1 + 1.4*on) + ')';
  });
}
`,
};

/* ---------- 07 open data and honest gates ---------- */
export const data = {
  name: '07-open-data-and-gates',
  T: 5,
  poster: 3.8,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:112px;font-size:140px;width:520px">The evidence<br>is <span class="or">open</span><span class="or">.</span></div>
<div class="a sub" data-a="1.0" data-d=".6" data-dy="18" style="left:76px;top:560px;width:470px;font-size:30px;color:var(--ink);font-weight:600;line-height:1.25">Real, simulated, pending. Every claim says which.</div>
<div class="a" data-a="1.5" data-d=".5" data-dy="14" style="left:76px;top:690px"><span class="chip"><i></i>G3 in progress, G5 partial</span></div>
<div id="rows"></div>
`,
  js: `
var rowsD = [['gavel-gates','Real sandbox','ok'],['gavel-latency','Real sandbox','ok'],['gavel-sim-30d','Simulated','sim'],['gavel-stt-bids','Synthetic audio','syn'],['gavel-audit-demo','Simulated','sim']];
var RX = 620, RW = 508, RH = 92, RG = 16, RY = 128;
var rows = [];
function setup(h){
  var html = '';
  rowsD.forEach(function(r,i){
    html += '<div class="a card rw" data-a="0" data-d="0" style="left:' + RX + 'px;top:' + (RY + i*(RH+RG)) + 'px;width:' + RW + 'px;height:' + RH + 'px;border-radius:22px;padding:0 24px 0 30px;display:flex;align-items:center;justify-content:space-between;overflow:hidden"><div class="bar" style="position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--orange);transform-origin:50% 0"></div><span class="mono" style="font:700 26px/1 var(--mono);letter-spacing:-.01em">' + r[0] + '</span><span class="pill p-' + r[2] + ' pl">' + r[1] + '</span></div>';
  });
  h.$('#rows').innerHTML = html;
  rows = h.$$('.rw');
}
function update(t,h){
  var ex = h.exitp(t);
  rows.forEach(function(c,k){
    var en = h.pr(t, .2 + k*.13, .7, h.E.o4);
    var pp = h.pr(t, .55 + k*.13, .45, h.E.back);
    var on = h.pr(t, 1.9 + k*.28, .3, h.E.o3) * (1 - h.pr(t, 1.9 + k*.28 + .55, .35, h.E.io));
    c.style.opacity = Math.min(1, en*2)*(1-ex);
    c.style.transform = 'translate(' + ((1-en)*120 - ex*10*0).toFixed(1) + 'px,' + (-ex*18).toFixed(1) + 'px) scale(' + (1 + .018*on) + ')';
    c.querySelector('.pl').style.transform = 'scale(' + pp + ')';
    c.querySelector('.bar').style.transform = 'scaleY(' + (.0001 + h.pr(t, 1.9 + k*.28, .35, h.E.o4)) + ')';
  });
}
`,
};

/* ---------- 08 ending ---------- */
const L = lockupLetters();
export const ending = {
  name: '08-ending',
  T: 5,
  poster: 3.8,
  header: false,
  html: `
<div class="a" style="left:388px;top:196px;width:0;height:0">
  <div class="wave" style="position:absolute;left:0;top:0;width:260px;height:260px;border-radius:50%;border:3px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:260px;height:260px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
</div>
<div class="a" id="lk" data-a="0" data-d=".2" data-dy="0" style="left:288px;top:96px;width:625px;height:200px"></div>
<div id="lnk"></div>
<div class="a" data-a="2.3" data-d=".5" data-dy="14" style="left:0;right:0;top:728px;text-align:center"><span class="chip"><i></i>PayPal sandbox only. Bids are held, not charged.</span></div>
`,
  js: `
var LETTERS = ${JSON.stringify(L)};
var mk, waves, lets = [];
var LINKS = [['Web app','gavel.dualmindlab.tech'],['Docs','docs.gavel.dualmindlab.tech'],['Source','github.com/harshbhx/gavel-auction']];
var rowEls = [];
function setup(h){
  var host = h.$('#lk');
  host.innerHTML = '<div id="lkm" style="position:absolute;left:0;top:0;width:200px;height:200px"></div><svg viewBox="-22 -22 450.24 144" style="position:absolute;left:0;top:0;width:625px;height:200px;overflow:visible"><g transform="translate(126 19) scale(0.62)">' + LETTERS.map(function(l){ return '<g class="lt">' + l + '</g>'; }).join('') + '</g></svg>';
  mk = h.Mark(h.$('#lkm'), {size:200, swingStart:.28, swingDur:.85});
  lets = h.$$('.lt');
  waves = h.Waves(h.$$('.wave'), [mk.strike], {min:.5, max:4.2, dur:1.4, alpha:.5});
  var html = '';
  LINKS.forEach(function(l,i){
    html += '<div class="a card lr" data-a="' + (1.55 + i*.18) + '" data-d=".6" data-dy="40" style="left:210px;top:' + (350 + i*112) + 'px;width:780px;height:92px;border-radius:46px;padding:0 34px 0 40px;display:flex;align-items:center;justify-content:space-between"><span class="mono" style="font:700 14px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);width:110px;flex:none">' + l[0] + '</span><span style="font:800 40px/1 var(--display);letter-spacing:.02em;text-transform:lowercase;flex:1;text-align:left;white-space:nowrap">' + l[1] + '</span><span style="width:38px;height:38px;border-radius:50%;background:var(--orange);display:flex;align-items:center;justify-content:center;flex:none"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 12h12M13 7l5 5-5 5" fill="none" stroke="#1d1712" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>';
  });
  h.$('#lnk').innerHTML = html;
}
function update(t,h){
  mk.update(t); waves(t);
  lets.forEach(function(g,i){
    var p = h.pr(t, 0.95 + i*.08, .6, h.E.o4);
    g.setAttribute('transform', 'translate(' + h.lerp(i === 0 ? 0 : -90, 0, p).toFixed(2) + ' 0)');
    g.setAttribute('opacity', Math.min(1, p*2.2) * (1 - h.exitp(t)));
  });
}
`,
};
