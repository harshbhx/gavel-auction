// Slides 01 to 04. Each slide: html (absolute layout on a 1200x800 stage), js (setup + update(t, h)), T (loop seconds),
// poster (second used for the still). Elements with data-a / data-d fade and slide in by themselves and out at the end.
import { asset } from './kit.mjs';

/* ---------- 01 hero ---------- */
export const hero = {
  name: '01-hero',
  T: 5,
  poster: 3.4,
  header: false,
  html: `
<div class="a" style="left:920px;top:392px;width:0;height:0">
  <div class="wave" style="position:absolute;left:0;top:0;width:380px;height:380px;border-radius:50%;border:3px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:420px;height:420px;border-radius:50%;border:1.5px solid #ff6a1f;opacity:0"></div>
  <div class="wave" style="position:absolute;left:0;top:0;width:420px;height:420px;border-radius:50%;border:1px solid #ff6a1f;opacity:0"></div>
</div>
<div class="a card" id="plate" data-a="0" data-d=".5" data-dy="0" data-s=".86" style="left:740px;top:212px;width:360px;height:360px;border-radius:50%"></div>
<div class="a" id="g" data-a="0" data-d=".2" data-dy="0" style="left:792px;top:264px;width:256px;height:256px"></div>
<div class="a h1" data-a=".35" data-d=".7" data-dy="60" style="left:72px;top:196px;font-size:150px;width:640px">Every bid</div>
<div class="a h1" data-a=".5" data-d=".7" data-dy="60" style="left:72px;top:330px;font-size:150px;width:640px">is a <span class="or">hold.</span></div>
<div class="a" data-a="1.2" data-d=".6" data-dy="24" style="left:76px;top:500px;width:560px">
  <div style="width:84px;height:6px;background:var(--orange);border-radius:3px;margin-bottom:26px"></div>
  <div class="sub" style="font-size:38px;color:var(--ink);font-weight:600">The hammer is the charge.</div>
</div>
<div class="a" data-a="1.7" data-d=".5" data-dy="16" style="left:76px;top:690px"><span class="chip"><i></i>PayPal sandbox only</span></div>
`,
  js: `
var mk, waves;
function setup(h){
  mk = h.Mark(h.$('#g'), {size:256, swingStart:.28, swingDur:.9, echoes:[2.75]});
  waves = h.Waves(h.$$('.wave'), [mk.strike, 2.75], {min:.5, max:3.3, dur:1.4, alpha:.55});
}
function update(t,h){ mk.update(t); waves(t); }
`,
};

/* ---------- 02 how it works ---------- */
export const how = {
  name: '02-how-it-works',
  T: 5,
  poster: 3.9,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:106px;font-size:132px">Four moves<span class="or">.</span></div>
<div id="cards"></div>
<div class="a" id="track" style="left:72px;top:650px;width:1056px;height:40px"></div>
<div class="a sub" data-a="2.9" data-d=".6" data-dy="18" style="left:72px;top:716px;font-size:32px;color:var(--ink);font-weight:600">Only the winning hold is captured.</div>
<div class="a" data-a="3.1" data-d=".5" data-dy="14" style="left:830px;top:715px"><span class="chip"><i></i>PayPal sandbox only</span></div>
`,
  js: `
var steps = [
  {k:'Hold', cap:'Held, not charged.'},
  {k:'Bid', cap:'Prices only go up.'},
  {k:'Hammer', cap:'The winner is named.'},
  {k:'Receipt', cap:'Proof you can share.'}
];
var act = [0.95, 1.7, 2.45, 3.2];
var CW = 246, GAP = 24, X0 = 72;
var cardEls = [], marks = [], tok;
function setup(h){
  var host = h.$('#cards'), tr = h.$('#track');
  var vis = [
    '<div class="hv hv0" style="position:relative;height:120px;margin-top:18px"><div style="font:700 56px/1 var(--mono);letter-spacing:-.04em">$20</div><div class="hbar" style="position:absolute;left:0;right:0;top:78px;height:30px;border-radius:15px;overflow:hidden;border:2px solid var(--orange);background:rgba(255,106,31,.08)"><div class="hfill" style="height:100%;width:100%;background:repeating-linear-gradient(135deg,#ff6a1f 0 6px,transparent 6px 13px)"></div></div></div>',
    '<div class="hv" style="height:120px;margin-top:18px"><div class="price" style="font:800 100px/1 var(--display);letter-spacing:.01em">$10</div></div>',
    '<div class="hv" style="height:120px;margin-top:18px;position:relative"><div class="hm" style="position:absolute;left:50px;top:-8px"></div></div>',
    '<div class="hv" style="height:120px;margin-top:18px;position:relative"><div class="rc" style="position:absolute;left:0;top:0;width:150px;height:112px;border-radius:12px;background:#fff;box-shadow:0 0 0 1px rgba(29,23,18,.12),0 10px 18px -8px rgba(29,23,18,.3);padding:16px 14px"><div style="height:8px;border-radius:4px;background:var(--ink);width:70%"></div><div style="height:8px;border-radius:4px;background:var(--rule);width:92%;margin-top:12px"></div><div style="height:8px;border-radius:4px;background:var(--rule);width:56%;margin-top:10px"></div><div style="height:8px;border-radius:4px;background:var(--rule);width:80%;margin-top:10px"></div></div><svg class="ck" viewBox="0 0 60 60" width="64" height="64" style="position:absolute;left:130px;top:46px;overflow:visible"><circle cx="30" cy="30" r="27" fill="#256b3a"/><path class="ckp" pathLength="1" d="M17 31 l9 9 l17 -19" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/></svg></div>'
  ];
  var html = '';
  steps.forEach(function(s,i){
    html += '<div class="a card sc" data-a="' + (0.08 + i*0.1) + '" data-d=".7" data-dy="70" style="left:' + (X0 + i*(CW+GAP)) + 'px;top:286px;width:' + CW + 'px;height:320px;padding:26px 26px"><div style="font:800 62px/1 var(--display);text-transform:uppercase;letter-spacing:.01em">' + s.k + '</div>' + vis[i] + '<div style="font:600 21px/1.3 var(--body);color:var(--muted);margin-top:26px">' + s.cap + '</div></div>';
  });
  host.innerHTML = html;
  cardEls = h.$$('.sc');
  tr.innerHTML = '<div style="position:absolute;left:0;right:0;top:19px;height:2px;background:var(--rule);border-radius:1px"></div><div id="tfill" style="position:absolute;left:0;top:18px;height:4px;background:var(--orange);border-radius:2px;width:0"></div>' +
    steps.map(function(s,i){ return '<div class="nd" style="position:absolute;left:' + (i*(CW+GAP) + CW/2 - 13) + 'px;top:7px;width:26px;height:26px;border-radius:50%;background:var(--bg);border:3px solid var(--rule)"></div>'; }).join('') +
    '<div id="tok" style="position:absolute;left:0;top:8px;width:24px;height:24px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 7px rgba(255,106,31,.22)"></div>';
  tok = h.$('#tok');
  marks[2] = h.Mark(h.$('.hm'), {size:112, ringDone:true, swingStart:act[2]+.05, swingDur:.8});
  marks[3] = null;
}
function nodeX(i){ return i*(CW+GAP) + CW/2; }
function update(t,h){
  var ex = h.exitp(t);
  // token position: eased hops between nodes, arriving at act times
  var x = nodeX(0), i;
  for(i=0;i<3;i++){ var a0 = act[i]+.12, a1 = act[i+1]-.05; x = h.lerp(x, nodeX(i+1), h.pr(t, a0, a1-a0, h.E.io)); }
  var tp = h.pr(t, .5, .5, h.E.back);
  tok.style.transform = 'translateX(' + (x-12) + 'px) scale(' + tp + ')';
  tok.style.opacity = 1-ex;
  var tf = h.$('#tfill'); tf.style.width = (x - nodeX(0) + 0) + 'px'; tf.style.left = nodeX(0) + 'px'; tf.style.opacity = 1-ex;
  var nds = h.$$('.nd');
  nds.forEach(function(n,k){ var on = t >= act[k]; n.style.background = on ? '#ff6a1f' : 'var(--bg)'; n.style.borderColor = on ? '#ff6a1f' : 'var(--rule)'; n.style.opacity = h.pr(t,.4,.4)*(1-ex); });
  cardEls.forEach(function(c,k){
    var p = h.pr(t, act[k], .45, h.E.o4);
    var en = h.pr(t, 0.08 + k*.1, .7, h.E.o4);
    var base = (1-en)*70 - ex*18;
    c.style.transform = 'translateY(' + (base - 14*p).toFixed(2) + 'px)';
    c.style.boxShadow = '0 0 0 ' + (1 + 2*p) + 'px ' + (p>.01 ? 'rgba(255,106,31,' + (.15+.85*p).toFixed(2) + ')' : 'rgba(29,23,18,.09)') + ',0 1px 0 rgba(255,255,255,.8) inset,0 ' + (30+20*p) + 'px ' + (50+20*p) + 'px -22px rgba(29,23,18,.32),0 8px 16px -8px rgba(29,23,18,.16)';
  });
  // hold: hatch fills in
  var hf = h.$('.hfill'); hf.style.transformOrigin = '0 50%'; hf.style.transform = 'scaleX(' + h.pr(t, act[0]+.05, .7, h.E.o4) + ')';
  // bid: price rises
  var pv = 10 + 10*h.pr(t, act[1]+.05, .9, h.E.io); var shown = Math.round(pv/5)*5; if(t < act[1]+.05) shown = 10;
  var pe = h.$('.price'); pe.textContent = '$' + shown; pe.style.color = t >= act[1]+.5 ? '#ff6a1f' : '#1d1712';
  var sc = 1 + .08*Math.sin(Math.PI*h.pr(t, act[1]+.45, .35, h.E.lin)); pe.style.transform = 'scale(' + sc + ')'; pe.style.transformOrigin = '0 60%';
  // hammer
  marks[2].update(t);
  // receipt: card rises and check draws
  var rc = h.$('.rc'); var rp = h.pr(t, act[3], .6, h.E.o4); rc.style.transform = 'translateY(' + ((1-rp)*16) + 'px)'; rc.style.opacity = .35 + .65*rp;
  var cp = h.$('.ckp'); cp.setAttribute('stroke-dashoffset', 1 - h.pr(t, act[3]+.35, .45, h.E.o3));
  var ck = h.$('.ck'); ck.style.transform = 'scale(' + h.pr(t, act[3]+.25, .45, h.E.back) + ')'; ck.style.transformOrigin = '30px 30px';
}
`,
};

/* ---------- 03 architecture ---------- */
export const arch = {
  name: '03-architecture',
  T: 5,
  poster: 3.9,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:106px;font-size:132px">One bid<span class="or">.</span> Four stops<span class="or">.</span></div>
<div id="blocks"></div>
<svg class="a" id="path" width="1056" height="200" viewBox="0 0 1056 200" style="left:72px;top:468px;overflow:visible"></svg>
<div class="a sub" data-a="2.9" data-d=".6" data-dy="18" style="left:72px;top:704px;font-size:32px;color:var(--ink);font-weight:600">Every step is written to the ledger.</div>
<div class="a" data-a="3.1" data-d=".5" data-dy="14" style="left:830px;top:703px"><span class="chip"><i></i>PayPal sandbox only</span></div>
`,
  js: `
var names = [['Browser','Bidders and screen'],['Cloudflare','Web and docs'],['Render','Auction engine'],['PayPal','Holds and capture']];
var BW = 232, BG = 42, BX = 72, BY = 320, BH = 182;
var arrive = [0.55, 1.2, 1.85, 2.5];
var blocks = [], dot, trail;
function cx(i){ return i*(BW+BG) + BW/2; }
function setup(h){
  var html = '';
  names.forEach(function(n,i){
    html += '<div class="a card bk" data-a="' + (0.1 + i*0.12) + '" data-d=".7" data-dy="60" style="left:' + (BX + i*(BW+BG)) + 'px;top:' + BY + 'px;width:' + BW + 'px;height:' + BH + 'px;padding:28px 26px"><div style="font:800 46px/1 var(--display);text-transform:uppercase;letter-spacing:.01em">' + n[0] + '</div><div style="font:600 21px/1.3 var(--body);color:var(--muted);margin-top:14px">' + n[1] + '</div><div class="bar" style="position:absolute;left:26px;bottom:22px;height:5px;width:48px;border-radius:3px;background:var(--rule)"></div></div>';
  });
  h.$('#blocks').innerHTML = html;
  blocks = h.$$('.bk');
  // path layer: forward line through block centres at y = BY+BH/2-468 ; return arc beneath
  var y = BY + BH/2 - 468;
  var svg = h.$('#path');
  var d = '';
  var segs = '';
  for(var i=0;i<3;i++){ var x1 = cx(i) + BW/2 - 0, x2 = cx(i+1) - BW/2; segs += '<line class="seg" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#c9b99a" stroke-width="3" stroke-linecap="round"/><line class="segf" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" stroke="#ff6a1f" stroke-width="4" stroke-linecap="round"/>'; }
  var ry = BY + BH - 468;
  var ret = 'M ' + cx(3) + ' ' + (ry + 6) + ' C ' + cx(3) + ' ' + (ry+110) + ' ' + cx(0) + ' ' + (ry+110) + ' ' + cx(0) + ' ' + (ry+6);
  svg.innerHTML = segs + '<path id="ret" d="' + ret + '" fill="none" stroke="#c9b99a" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/><path id="retf" pathLength="1" d="' + ret + '" fill="none" stroke="#256b3a" stroke-width="4" stroke-linecap="round" stroke-dasharray="1"/><circle id="pk" r="11" fill="#ff6a1f"/><circle id="pkh" r="22" fill="#ff6a1f" opacity=".2"/><text id="rt" font-family="JetBrains Mono Variable, monospace" font-weight="700" font-size="15" letter-spacing="2" fill="#256b3a" text-anchor="middle" x="' + ((cx(0)+cx(3))/2) + '" y="' + (ry+112) + '" opacity="0">RECEIPT</text>';
}
function update(t,h){
  var ex = h.exitp(t);
  var y = BY + BH/2 - 468;
  // packet position along forward line, eased between blocks
  var x = cx(0);
  for(var i=0;i<3;i++){ x = h.lerp(x, cx(i+1) - BW/2, h.pr(t, arrive[i]+.1, arrive[i+1]-arrive[i]-.35, h.E.io)); if(t > arrive[i+1]-.25) x = Math.max(x, cx(i+1)); }
  // simple continuous path: move centre-to-centre
  var px = cx(0);
  for(i=0;i<3;i++){ px = h.lerp(px, cx(i+1), h.pr(t, arrive[i]+.05, arrive[i+1]-arrive[i]-.1, h.E.io)); }
  var fwd = t < 2.75;
  var pk = h.$('#pk'), pkh = h.$('#pkh');
  var py = y, pxx = px;
  if(t >= 2.75){
    var rp = h.pr(t, 2.75, 1.05, h.E.io);
    var rpath = h.$('#ret'), L = rpath.getTotalLength();
    var pt = rpath.getPointAtLength(L*rp);
    pxx = pt.x; py = pt.y;
    h.$('#retf').setAttribute('stroke-dashoffset', 1 - rp);
  } else { h.$('#retf').setAttribute('stroke-dashoffset', 1); }
  var po = h.pr(t, .35, .3) * (1-ex) * (t > 3.85 ? 1 - h.pr(t, 3.85, .2, h.E.lin) : 1);
  pk.setAttribute('cx', pxx); pk.setAttribute('cy', py); pk.setAttribute('opacity', po);
  pkh.setAttribute('cx', pxx); pkh.setAttribute('cy', py); pkh.setAttribute('opacity', .22*po);
  var segf = h.$$('.segf'), seg = h.$$('.seg');
  segf.forEach(function(s,k){
    var x1 = cx(k)+BW/2, x2 = cx(k+1)-BW/2;
    var f = h.cl((px - x1)/(x2-x1)); s.setAttribute('x2', x1 + (x2-x1)*f); s.setAttribute('opacity', (f>0?1:0)*(1-ex));
  });
  seg.forEach(function(s){ s.setAttribute('opacity', h.pr(t,.4,.4)*(1-ex)); });
  h.$('#ret').setAttribute('opacity', h.pr(t,2.4,.4)*(1-ex));
  h.$('#retf').setAttribute('opacity', 1-ex);
  var rt = h.$('#rt'); rt.setAttribute('opacity', h.pr(t, 3.35, .4)*(1-ex));
  blocks.forEach(function(b,k){
    var p = h.pr(t, arrive[k], .4, h.E.o3) ;
    var en = h.pr(t, 0.1 + k*.12, .7, h.E.o4);
    var after = h.pr(t, arrive[k]+.9, .6, h.E.io);
    var glow = p*(1-after*.65);
    b.style.transform = 'translateY(' + ((1-en)*60 - ex*18 - 10*glow).toFixed(2) + 'px)';
    b.style.boxShadow = '0 0 0 ' + (1+2*glow) + 'px ' + (glow>.02 ? 'rgba(255,106,31,' + (.12+.88*glow).toFixed(2) + ')' : 'rgba(29,23,18,.09)') + ',0 1px 0 rgba(255,255,255,.8) inset,0 ' + (30+14*glow) + 'px ' + (50+14*glow) + 'px -22px rgba(29,23,18,.32),0 8px 16px -8px rgba(29,23,18,.16)';
    var bar = b.querySelector('.bar'); bar.style.width = (48 + 130*p) + 'px'; bar.style.background = k===3 && p>.5 ? '#256b3a' : (p>.05 ? '#ff6a1f' : '#c9b99a');
  });
}
`,
};

/* ---------- 04 judge flow ---------- */
const shots = [
  ['readme/see-it-run-1-start-room.png', 'Room'],
  ['readme/see-it-run-3-bids.png', 'Bid'],
  ['readme/see-it-run-4-hammer.png', 'Hammer'],
  ['readme/see-it-run-6-receipt.png', 'Receipt'],
];
export const judge = {
  name: '04-judge-flow',
  T: 5,
  poster: 3.7,
  html: `
<div class="a h1" data-a=".05" data-d=".6" style="left:72px;top:90px;font-size:98px">Try it in <span class="or">two minutes</span></div>
<div class="a sub" data-a=".3" data-d=".6" data-dy="18" style="left:76px;top:184px;font-size:27px">Start at <span class="mono" style="font-weight:700;color:var(--ink);font-size:25px">gavel.dualmindlab.tech/try</span></div>
<div id="stack" class="a" style="left:0;top:0;width:1200px;height:800px"></div>
<div id="chips" class="a" style="left:0;top:742px;width:1200px;text-align:center"></div>
`,
  js: `
var SH = ${JSON.stringify(shots.map(([f, l]) => [asset('docs/assets/' + f), l]))};
var WIN_W = 700, WIN_H = 437, BAR = 34;
var win = [], chips = [];
function setup(h){
  var html = '';
  SH.forEach(function(s,i){
    html += '<div class="a win" style="left:' + (600 - WIN_W/2) + 'px;top:240px;width:' + WIN_W + 'px;height:' + (WIN_H+BAR) + 'px;border-radius:16px;overflow:hidden;background:#fbf6ea;box-shadow:0 0 0 1px rgba(29,23,18,.16),0 40px 60px -26px rgba(29,23,18,.45),0 10px 20px -10px rgba(29,23,18,.2)"><div style="height:' + BAR + 'px;background:#e6dac1;display:flex;align-items:center;padding:0 14px;gap:7px;border-bottom:1px solid rgba(29,23,18,.14)"><i style="width:10px;height:10px;border-radius:50%;background:#c9b99a;display:block"></i><i style="width:10px;height:10px;border-radius:50%;background:#c9b99a;display:block"></i><i style="width:10px;height:10px;border-radius:50%;background:#c9b99a;display:block"></i><span style="margin-left:14px;flex:1;max-width:300px;height:20px;border-radius:10px;background:rgba(251,246,234,.9);font:600 11px/20px var(--mono);color:var(--muted);padding:0 12px">gavel.dualmindlab.tech</span></div><img src="' + s[0] + '" style="display:block;width:' + WIN_W + 'px;height:' + WIN_H + 'px;object-fit:cover;object-position:top"></div>';
  });
  h.$('#stack').innerHTML = html;
  win = h.$$('.win');
  var c = '';
  SH.forEach(function(s,i){ c += '<span class="chip ch" style="margin:0 6px">' + s[1] + '</span>'; });
  h.$('#chips').innerHTML = c;
  chips = h.$$('.ch');
}
var STEP = [1.0, 1.75, 2.5], TD = 0.6;
function update(t,h){
  var ex = h.exitp(t);
  var pos = 0;
  for(var i=0;i<3;i++) pos += h.pr(t, STEP[i], TD, h.E.io);
  var en = h.pr(t, .15, .8, h.E.o4);
  win.forEach(function(w,k){
    var o = k - pos, ao = Math.abs(o);
    var sc = 1 - .24*Math.min(ao,1);
    var x = o*540;
    var op = (ao >= 1.6 ? 0 : 1 - .6*Math.min(ao,1) - (ao>1 ? (ao-1)*.8 : 0));
    var y = (1-en)*80 - ex*20 + Math.min(ao,1)*10;
    // incoming first window enters; others wait offscreen to the right until the stack is shown
    w.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';
    w.style.opacity = Math.max(0, op) * en * (1-ex);
    w.style.zIndex = 10 - Math.round(ao*2); w.style.filter = 'blur(' + (Math.min(ao,1)*2.5).toFixed(2) + 'px)';
  });
  chips.forEach(function(c,k){
    var on = Math.abs(k - pos) < .5;
    c.style.background = on ? '#ff6a1f' : 'rgba(251,246,234,.8)';
    c.style.borderColor = on ? '#ff6a1f' : 'rgba(29,23,18,.2)';
    c.style.color = '#1d1712';
    var p = h.pr(t, .4 + k*.08, .5, h.E.o4);
    c.style.opacity = p * (1-ex);
    c.style.transform = 'translateY(' + ((1-p)*14) + 'px)';
  });
}
`,
};
