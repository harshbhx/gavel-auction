document.fonts.ready.then(()=>{
  document.querySelectorAll('[data-fit]').forEach(el=>{
    const w=+el.dataset.fit; let fs=100; el.style.fontSize=fs+'px';
    for(let i=0;i<4;i++){const r=el.getBoundingClientRect().width; fs=fs*w/r; el.style.fontSize=fs+'px';}
  });
  document.body.dataset.ready='1';
});
