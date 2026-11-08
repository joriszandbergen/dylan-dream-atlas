// PROTOTYPE: an infinite, seeded relationship drawing. Generated sectors repeat a finite archive.
import {projects} from './projects.js';
import {SECTOR_W,SECTOR_H,CHANNELS,hash,generateSector} from './world.js';
import {buildInkPath,pointAt,strokeInterval,pressure} from './ink.js';
import {ShapeInstrument} from './sound.js';
import {RECORDINGS} from './audio-source.js';
import {SOUND_DEFAULTS,NOTE_NAMES,DORIAN,PHRASE_LENGTH,soundSettings,chordName} from './harmony.js';
const $=id=>document.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d');
const defaults={routing:'curve',spread:1,weight:1.3,typeSize:1,font:'sans',paper:'white',arrival:2.6,gesture:1,volume:.45,music:'#f51b3e',digital:'#234bff',physical:'#00ad58',yellow:'#ffdc00',black:'#171918',annotations:true,flow:false,channels:{music:true,digital:true,physical:true}};
const themes={white:{paper:'#ffffff',panel:'#ffffff',ink:'#20282b',muted:'#8a9296',rule:'#d8dddf',light:'#eef0f1'}};
const FIXED_SCALE=.78;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let velocity={x:0,y:0}, hoverMix=new Map(),selectedAt=0;
const instrument=new ShapeInstrument({onState:syncSoundUi});
let lastMeter=0;
const growth=new Map(),pathCache=new Map(),projectTargets=new Map();
let focusedNode=null,interactiveNodes=[];

let entryStart=performance.now(),entryDone=reducedMotion,entrySettled=false,growing=false,revealOrigin=null;
const ease=t=>t*t*(3-2*t),clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const projectImages=new Map();
projects.forEach((p,i)=>{if(p.image){const image=new Image();image.src='./assets/'+p.image;image.onload=()=>{projectImages.set(i,image);dirty=true};}});

const state={...defaults,sound:{...SOUND_DEFAULTS},channels:{...defaults.channels}};
const params=new URLSearchParams(location.search);
const freshSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0,7).toUpperCase();
let seed=params.get('seed')?.slice(0,32)||freshSeed(),camera={x:750,y:550,z:FIXED_SCALE},W=1,H=1,dpr=1,dirty=true,frame=0,last=0,hover=null,selected=null,pointerWorld=null,drag=null,pinch=null,toastTimeout,ready=false;
const cache=new Map(),visited=new Set(),found=new Set(),keys=new Set(),pointers=new Map();
let visibleSectors=[];
if(params.has('seed')){for(const key of ['x','y']){const n=Number(params.get(key));if(params.has(key)&&Number.isFinite(n))camera[key]=Math.max(-1e9,Math.min(1e9,n));}try{const settings=JSON.parse(params.get('plot')||'{}');state.sound=soundSettings(settings.sound);for(const k of ['routing','font'])if(typeof settings[k]==='string'&&({routing:['orthogonal','diagonal','curve'],font:['mono','sans','serif']}[k].includes(settings[k])))state[k]=settings[k];for(const [k,min,max] of [['spread',.6,1.5],['weight',.5,3],['typeSize',.7,1.6],['arrival',1,5],['gesture',0,2],['volume',0,1]])if(Number.isFinite(settings[k]))state[k]=Math.max(min,Math.min(max,settings[k]));for(const k of ['music','digital','physical','yellow','black'])if(/^#[0-9a-f]{6}$/i.test(settings[k]))state[k]=settings[k];for(const k of ['annotations','flow'])if(typeof settings[k]==='boolean')state[k]=settings[k];if(settings.channels)for(const k in state.channels)if(typeof settings.channels[k]==='boolean')state.channels[k]=settings.channels[k];}catch{}}
const fonts={mono:'DM Mono',sans:'DM Sans',serif:'Instrument Serif'};
function font(size){return `${size}px "${fonts[state.font]}", monospace`}
function text(s,x,y,size=10,color=themes[state.paper].ink,align='left'){ctx.font=font(size);ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(s).toLowerCase(),x,y)}
function line(x1,y1,x2,y2,color,width=.7){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
function circle(x,y,r,color,width=1,fill=null){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill()}ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()}
function screen(p){return{x:(p.x-camera.x)*camera.z+W/2,y:(p.y-camera.y)*camera.z+H/2}}
function world(x,y){return{x:(x-W/2)/camera.z+camera.x,y:(y-H/2)/camera.z+camera.y}}
function sector(cx,cy){const key=`${cx},${cy}`;if(!cache.has(key))cache.set(key,generateSector(seed,cx,cy,state.spread));return cache.get(key)}
function activeNode(n){return Object.entries(CHANNELS).some(([key,ch])=>state.channels[key]&&ch.members.includes(n.project))}
function updateSectors(){
 const min=world(-180,-180),max=world(W+180,H+180),used=new Set();visibleSectors=[];
 for(let y=Math.floor(min.y/SECTOR_H);y<=Math.floor(max.y/SECTOR_H);y++)for(let x=Math.floor(min.x/SECTOR_W);x<=Math.floor(max.x/SECTOR_W);x++){const s=sector(x,y);visibleSectors.push(s);used.add(s.key)}
 for(const key of cache.keys())if(!used.has(key)&&cache.size>48){cache.delete(key);const prefix=key.replace(',',':')+':';for(const k of pathCache.keys())if(k.startsWith(prefix))pathCache.delete(k);for(const k of growth.keys())if(k.startsWith(prefix))growth.delete(k);}
 const current=`${Math.floor(camera.x/SECTOR_W)},${Math.floor(camera.y/SECTOR_H)}`;visited.add(current);
 $('sector-count').textContent=String(visited.size).padStart(2,'0');$('sector-display').textContent=current.split(',').map(formatSector).join(' / ');
 $('coord-x').textContent=formatCoord(camera.x);$('coord-y').textContent=formatCoord(camera.y);
}
function formatSector(v){return (Number(v)<0?'−':'+')+String(Math.abs(Number(v))).padStart(2,'0')}
function formatCoord(v){return(v<0?'−':'+')+String(Math.round(Math.abs(v))).padStart(5,'0')}
// One cached timeline per complete edge. Direction is fixed when first encountered.
function edgePath(edge){
 const key=edge.id+':'+state.routing;
 if(!pathCache.has(key))pathCache.set(key,buildInkPath(edge,state.routing,state.gesture,seed));
 return pathCache.get(key);
}
function segmentVisible(a,b){
 // Exact rectangular clipping avoids starting an offscreen curve early.
 let lo=0,hi=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q] of [[-dx,a.x],[dx,W-a.x],[-dy,a.y],[dy,H-a.y]]){
  if(p===0){if(q<0)return false;continue;}
  const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;
 }
 return true;
}
function edgeArrival(edge,path,now){
 if(reducedMotion)return {progress:1,reverse:false};
 let item=growth.get(edge.id);
 if(!item){
  const projected=path.points.map(screen);
  if(!projected.some((p,i)=>i&&segmentVisible(projected[i-1],p)))return {progress:0,reverse:false};
  const a=projected[0],b=projected.at(-1);
  const reverse=Math.hypot(b.x-W/2,b.y-H/2)<Math.hypot(a.x-W/2,a.y-H/2);
  const delay=path.hash%370;
  item={born:entryDone?now+delay:entryStart+650+delay,duration:state.arrival*1000*(.75+Math.min(path.length,1500)/3000),reverse};
  growth.set(edge.id,item);
 }
 const t=clamp((now-item.born)/item.duration);
 // A little rhythmic variation in drawing speed; the tip never travels backwards.
 const progress=t+Math.sin(t*Math.PI*2)*.055;
 if(t<1)growing=true;return {progress,reverse:item.reverse};
}
function edgeColor(edge){
 if(edge.id.includes(':chain'))return state.yellow;
 if(/:(n|s)$/.test(edge.id))return state.black;
 return state[edge.channel];
}
function projectColor(index){return index===1?state.yellow:state[projects[index].filter];}
function inkMark(p,size,color,shape=0,angle=0){
 ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.fillStyle=color;ctx.beginPath();
 if(shape===0)ctx.ellipse(0,0,size,size*.93,0,0,Math.PI*2);
 else if(shape===1){ctx.moveTo(-size*1.35,0);ctx.bezierCurveTo(-size*.6,-size*.24,-size*.5,-size,size*.2,-size);ctx.bezierCurveTo(size*1.5,-size*.85,size*1.5,size*.85,size*.2,size);ctx.bezierCurveTo(-size*.5,size,-size*.6,size*.24,-size*1.35,0);}
 else if(shape===2){ctx.roundRect(-size*1.5,-size*.65,size*3,size*1.3,size*.65);}
 else{ctx.moveTo(-size,0);ctx.bezierCurveTo(-size,-size*1.4,-size*.2,-size*.9,0,-size*.4);ctx.bezierCurveTo(size*.5,-size*1.4,size*1.5,-size*.6,size,.25*size);ctx.bezierCurveTo(size,1.4*size,size*.25,size,0,size*.5);ctx.bezierCurveTo(-size*.8,size*1.1,-size*1.2,size*.6,-size,0);}
 ctx.fill();ctx.restore();
}
function drawRibbon(path,points,color,width,alpha){
 if(points.length<2)return;
 const projected=points.map(screen),left=[],right=[];
 for(let i=0;i<projected.length;i++){
  const a=projected[Math.max(0,i-1)],b=projected[Math.min(projected.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const half=width*pressure(path,points[i].t,state.gesture)*.5,p=projected[i];
  left.push({x:p.x-dy/len*half,y:p.y+dx/len*half});right.push({x:p.x+dy/len*half,y:p.y-dx/len*half});
 }
 ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(left[0].x,left[0].y);
 for(const p of left)ctx.lineTo(p.x,p.y);for(const p of right.reverse())ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill();
}
function drawEdge(edge,now){
 if(!state.channels[edge.channel])return;
 const path=edgePath(edge),arrival=edgeArrival(edge,path,now),{progress,reverse}=arrival;
 if(progress<=0)return;
 const isSelected=selected&&edge.id.startsWith(`${selected.cx}:${selected.cy}:`)&&edge.project===selected.project;
 const hoverAmount=hoverMix.get(`${edge.id.split(':')[0]}:${edge.id.split(':')[1]}:${edge.project}`)||0;
 const alpha=selected&&!isSelected?.16:1,width=state.weight*camera.z*(isSelected?1.35:1+hoverAmount*.55),color=edgeColor(edge);
 const start=reverse?1-progress:0,end=reverse?1:progress;
 ctx.save();drawRibbon(path,strokeInterval(path,start,end),color,width,alpha);
 // Score-like beats appear only after the single drawing tip passes their position.
 for(const mark of path.marks){
  if(mark.t<start||mark.t>end)continue;
  const p=screen(pointAt(path,mark.t)),before=screen(pointAt(path,Math.max(0,mark.t-.005))),angle=Math.atan2(p.y-before.y,p.x-before.x);
  inkMark(p,mark.size*camera.z,mark.black?state.black:color,mark.shape,angle);
  if(mark.cluster)for(const offset of [-10,10])inkMark({x:p.x-Math.sin(angle)*offset,y:p.y+Math.cos(angle)*offset},2.5,state.black);
 }
 const root=screen(pointAt(path,reverse?1:0)),tip=screen(pointAt(path,reverse?start:end));
 inkMark(root,2.9*camera.z,color,path.hash%2);
 const tipSize=progress<1?3.3+pressure(path,reverse?start:end,state.gesture)*width*.17:3;
 inkMark(tip,tipSize,color,progress<1?1:path.hash%2,Math.atan2(tip.y-root.y,tip.x-root.x));
 const flowing=state.flow&&progress===1,travel=flowing?(now*.000035+path.hash%100/100)%1:progress;
 const at=flowing?travel:reverse?start:end;
 const cursor=flowing?screen(pointAt(path,at)):tip;
 if(flowing)inkMark(cursor,2.3,color,0);
 if(instrument.ready){
  const before=screen(pointAt(path,clamp(at-.01))),after=screen(pointAt(path,clamp(at+.01)));
  const ax=cursor.x-before.x,ay=cursor.y-before.y,bx=after.x-cursor.x,by=after.y-cursor.y;
  const turn=Math.abs(Math.atan2(ax*by-ay*bx,ax*bx+ay*by))/Math.PI;
  instrument.stroke({id:edge.id+(flowing?':flow':''),progress:travel,flow:flowing,
   visible:cursor.x>=0&&cursor.x<=W&&cursor.y>=0&&cursor.y<=H,pan:cursor.x/W*2-1,height:1-cursor.y/H,
   thickness:pressure(path,at,state.gesture)*state.weight,turn,direction:(after.y-before.y)/(Math.hypot(after.x-before.x,after.y-before.y)||1),length:path.length,seed:path.hash,routing:state.routing,channel:edge.channel,
   marks:path.marks.map(m=>{const p=screen(pointAt(path,m.t));return {shape:m.shape,travel:flowing?m.t:reverse?1-m.t:m.t,pan:p.x/W*2-1,visible:p.x>=0&&p.x<=W&&p.y>=0&&p.y<=H};})});
 }

 ctx.restore();
}
function nodeProgress(n,now){
 if(reducedMotion||selected?.id===n.id)return 1;
 const related=visibleSectors.find(s=>s.cx===n.cx&&s.cy===n.cy)?.edges.filter(e=>e.project===n.project&&state.channels[e.channel])||[];
 let reached=false;
 for(const edge of related){const path=edgePath(edge),arrival=edgeArrival(edge,path,now);if(arrival.progress>=(arrival.reverse?0.01:.98))reached=true;}
 if(!reached)return 0;
 const key=n.id+':node';let item=growth.get(key);
 if(!item){item={born:now};growth.set(key,item);}
 const p=clamp((now-item.born)/260);if(p<1)growing=true;return p;
}
// Solid project circles share the same rounded sonic character.
const projectGeometry=projects.map(()=>({sides:0,angle:0}));
function drawNode(n,now){
 const p=screen(n);if(p.x<-160||p.x>W+160||p.y<-100||p.y>H+100)return;
 const progress=nodeProgress(n,now);if(progress<=0)return;
 const chosen=selected?.id===n.id,hoverAmount=hoverMix.get(n.id)||0,col=projectColor(n.project);
 const radius=10.5+hoverAmount*2;
 if(progress>.08&&activeNode(n)&&p.x>=0&&p.x<=W&&p.y>=0&&p.y<=H)instrument.arrive(n.id,n.project,projectGeometry[n.project],p.x/W*2-1,chosen);
 ctx.save();ctx.globalAlpha=(activeNode(n)?1:.12)*(selected&&!chosen?.3:1);
 const pop=1-Math.pow(1-progress,3);
 ctx.beginPath();ctx.arc(p.x,p.y,radius*pop,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();
 ctx.restore();
 if(activeNode(n)&&progress>.5&&p.x>0&&p.x<W&&p.y>0&&p.y<H)interactiveNodes.push(n);
}
function syncProjectTargets(){
 const present=new Set(interactiveNodes.map(n=>n.id));
 for(const [id,target]of projectTargets)if(!present.has(id)){
  if(document.activeElement===target.button)canvas.focus({preventScroll:true});
  target.button.remove();projectTargets.delete(id);
 }
 for(const n of interactiveNodes){
  let target=projectTargets.get(n.id);
  if(!target){
   const button=document.createElement('button');button.className='project-target';
   button.setAttribute('aria-label','open '+projects[n.project].title.toLowerCase());
   button.setAttribute('aria-describedby','node-hint');
   target={button,node:n};projectTargets.set(n.id,target);
   button.addEventListener('focus',()=>{focusedNode=target.node;hover=null;dirty=true;});
   button.addEventListener('blur',()=>{if(focusedNode?.id===target.node.id)focusedNode=null;dirty=true;});
   button.addEventListener('click',()=>select(target.node));
   $('project-targets').append(button);
  }
  target.node=n;const p=screen(n);target.button.style.left=p.x+'px';target.button.style.top=p.y+'px';
 }
 const n=focusedNode||hover,hint=$('node-hint'),show=!!n&&present.has(n.id)&&!selected&&!drag&&!pinch;
 instrument.hover(show?n.id:null,n?.project,n?projectGeometry[n.project]:null,n?screen(n).x/W*2-1:0);
 hint.classList.toggle('visible',show);hint.setAttribute('aria-hidden',String(!show));
 if(show){
  const p=screen(n),project=projects[n.project];
  hint.style.fontSize=(12*state.typeSize)+'px';hint.replaceChildren();const title=document.createElement('strong');title.textContent=project.title.toLowerCase();hint.append(title);
  if(state.annotations){const detail=document.createElement('span');detail.style.fontSize=(9*state.typeSize)+'px';detail.textContent=project.category.split('/')[0].trim().toLowerCase()+' · '+project.year;hint.append(detail);}
  const width=hint.offsetWidth,height=hint.offsetHeight;
  const x=p.x+32+width<W-12?p.x+32:p.x-width-32;
  hint.style.left=Math.max(12,x)+'px';hint.style.top=Math.max(70,Math.min(H-height-35,p.y-height/2))+'px';
 }
}

function positionReveal(){
 if(!selected)return;
 const p=screen(selected),el=$('project-reveal'),width=Math.min(400,W-36),height=Math.min(575,H-125);
 const x=clamp(p.x,Math.min(width/2+20,W/2),Math.max(W/2,W-width/2-20));
 const y=clamp(p.y-20,Math.min(height/2+70,H/2),Math.max(H/2,H-height/2-40));
 el.style.left=x+'px';el.style.top=y+'px';el.style.setProperty('--origin-x',(p.x-x+width/2)+'px');el.style.setProperty('--origin-y',(p.y-y+height/2)+'px');
 if(Math.hypot(p.x-x,p.y-y)>60){ctx.save();ctx.globalAlpha=.35;ctx.strokeStyle=projectColor(selected.project);ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.bezierCurveTo(p.x,p.y-60,x,y+80,x,y);ctx.stroke();ctx.restore()}
}
function drawBackgroundGrid(){
 // The background follows 86% of camera travel, giving the drawing a little depth.
 const travel=reducedMotion?1:.86,spacing=64*camera.z*Math.SQRT2;
 const origin={x:W/2-camera.x*camera.z*travel,y:H/2-camera.y*camera.z*travel};
 ctx.save();ctx.strokeStyle='#e9eaec';ctx.lineWidth=.75;ctx.beginPath();
 for(const slope of [-1,1]){
  const phase=(origin.y-slope*origin.x)%spacing,min=Math.min(0,-slope*W),max=H+Math.max(0,-slope*W);
  for(let b=Math.floor((min-phase)/spacing)*spacing+phase;b<=max;b+=spacing){ctx.moveTo(0,b);ctx.lineTo(W,slope*W+b);}
 }
 ctx.stroke();ctx.restore();
}
function draw(now=performance.now()){
 growing=false;instrument.beginFrame();updateSectors();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
 drawBackgroundGrid();
 visibleSectors.forEach(s=>s.edges.forEach(e=>drawEdge(e,now)));
 interactiveNodes=[];visibleSectors.forEach(s=>s.nodes.forEach(n=>drawNode(n,now)));
 syncProjectTargets();
 positionReveal();instrument.endFrame();dirty=false;
}
function finishEntry(){
 entryDone=true;entrySettled=true;document.body.classList.remove('entering');$('entry').hidden=true;$('skip-entry').hidden=true;
 // A deliberate skip makes already-visible lines immediately usable.
 for(const item of growth.values())item.born=performance.now()-10000;dirty=true;
}
function updateEntry(now){
 if(entrySettled)return;
 const age=now-entryStart;
 if(reducedMotion){finishEntry();return;}
 if(age>900)document.body.classList.add('entry-opening');
 if(age>2200)document.body.classList.add('entry-arrived');
 if(age>3300){entryDone=true;entrySettled=true;document.body.classList.remove('entering');$('entry').hidden=true;$('skip-entry').hidden=true;}
 dirty=true;
}
function tick(now){
 const dt=Math.min((now-last)/1000,.05);last=now;updateEntry(now);
 if(keys.size){hover=null;const speed=480*dt/camera.z;for(const key of keys){if(['ArrowLeft','a'].includes(key))camera.x-=speed;if(['ArrowRight','d'].includes(key))camera.x+=speed;if(['ArrowUp','w'].includes(key))camera.y-=speed;if(['ArrowDown','s'].includes(key))camera.y+=speed}dirty=true;}
 if(!drag&&!pinch&&!reducedMotion&&(Math.abs(velocity.x)+Math.abs(velocity.y)>.08)){camera.x-=velocity.x;camera.y-=velocity.y;const damping=Math.pow(.82,dt*60);velocity.x*=damping;velocity.y*=damping;dirty=true;}
 for(const s of visibleSectors)for(const n of s.nodes){const current=hoverMix.get(n.id)||0,target=(hover?.id===n.id||focusedNode?.id===n.id)?1:0,next=reducedMotion?target:current+(target-current)*(1-Math.exp(-dt*16));if(Math.abs(next-current)>.001){hoverMix.set(n.id,next);dirty=true}else if(next<.01)hoverMix.delete(n.id)}
 if(selected&&now-selectedAt<650&&!reducedMotion)dirty=true;
 if(dirty||state.flow||growing)draw(now);
 instrument.tick();
 if(now-lastMeter>100){lastMeter=now;const meter=instrument.meter();$('sound-meter').style.setProperty('--level',meter.level);$('sound-meter').setAttribute('aria-valuenow',String(Math.round(meter.level*100)));$('sound-meter').dataset.peak=meter.peak.toFixed(5);$('sound-meter').dataset.voices=String(meter.voices);$('sound-toggle').style.setProperty('--level',meter.level);syncChordUi(meter);}
 frame=requestAnimationFrame(tick);
}
function resize(){const r=$('viewport').getBoundingClientRect();W=r.width;H=r.height;dpr=Math.min(devicePixelRatio,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);dirty=true;}
function applySettings(){applySoundSettings();instrument.setVolume(state.volume);$('volume').value=state.volume;$('volume-value').value=Math.round(state.volume*100)+'%';const t=themes[state.paper];for(const [k,v]of Object.entries(t))document.documentElement.style.setProperty('--'+(k==='light'?'light-rule':k),v);for(const [css,key]of [['sound','music'],['image','digital'],['object','physical']])document.documentElement.style.setProperty('--'+css,state[key]);document.documentElement.style.setProperty('--letter',`"${fonts[state.font]}",monospace`);for(const id of ['routing','font'])$(id).value=state[id];for(const [id,key]of [['spread','spread'],['weight','weight'],['type-size','typeSize'],['arrival','arrival'],['gesture','gesture']]){$(id).value=state[key];$(id+'-value').value=state[key].toFixed(2)}for(const id of ['annotations','flow'])$(id).checked=state[id];for(const [id,key]of [['sound-color','music'],['image-color','digital'],['object-color','physical'],['yellow-color','yellow'],['black-color','black']])$(id).value=state[key];document.querySelectorAll('[data-channel]').forEach(el=>el.checked=state.channels[el.dataset.channel]);$('seed-display').textContent=seed;$('seed-input').value=seed;dirty=true;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),2400)}
function renderRegister(){
 $('project-register').innerHTML=projects.map((p,i)=>`<button class="register-row ${found.has(i)?'visited':''} ${selected?.project===i?'selected':''}" data-project="${i}" aria-label="Inspect ${p.title}"><span class="ref">${String(i+1).padStart(2,'0')}</span><b>${p.title}</b><span class="entry-marker"></span></button>`).join('');
 $('project-register').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const cx=Math.floor(camera.x/SECTOR_W),cy=Math.floor(camera.y/SECTOR_H),node=sector(cx,cy).nodes[Number(b.dataset.project)];select(node);dirty=true}));$('found-count').textContent=String(found.size).padStart(2,'0')+' / 07';
}
function select(n){
 instrument.project(n.project,projectGeometry[n.project],clamp(screen(n).x/W*2-1,-.85,.85));
 if(!entryDone)finishEntry();selectedAt=performance.now();velocity={x:0,y:0};selected=n;found.add(n.project);renderRegister();setPanel(true);setSoundPanel(false);$('node-hint').classList.remove('visible');
 const p=projects[n.project],color=projectColor(n.project),reveal=$('project-reveal');
 reveal.style.setProperty('--project-color',color);
 const art=p.image?`<img src="./assets/${p.image}" alt="${p.title}">`:`<div class="abstract-art" aria-hidden="true"><i></i><i></i><i></i><span>${p.title.toLowerCase()}</span></div>`;
 reveal.innerHTML=`<div class="reveal-content"><button class="reveal-close" id="close-reveal" aria-label="Close project">×</button><div class="reveal-image">${art}<span class="reveal-image-index">${String(n.project+1).padStart(2,'0')} / 07</span></div><div class="reveal-copy"><span class="reveal-category">${p.category.toLowerCase()} · ${p.year}</span><h2>${p.title.toLowerCase()}</h2><p>${p.text}</p><div class="reveal-links"><a href="${p.source}" target="_blank" rel="noopener noreferrer">view project ↗</a><button id="follow-connection">follow a connection →</button></div><small>${p.image?p.credit:p.collaborator}</small></div></div>`;
 reveal.hidden=false;reveal.classList.remove('is-open');positionReveal();requestAnimationFrame(()=>reveal.classList.add('is-open'));
 $('close-reveal').addEventListener('click',clearSelection);$('follow-connection').addEventListener('click',()=>select(sector(n.cx,n.cy).nodes[p.related]));
 $('status').textContent=p.title.toLowerCase();$('close-reveal').focus({preventScroll:true});dirty=true;
}
function clearSelection(){
 selected=null;renderRegister();$('project-reveal').hidden=true;$('project-reveal').classList.remove('is-open');$('status').textContent='a little further, always';canvas.focus({preventScroll:true});dirty=true;
}
function hit(x,y){let foundNode=null,nearest=Infinity;for(const n of interactiveNodes){const p=screen(n),d=Math.hypot(p.x-x,p.y-y);if(d<29&&d<nearest){foundNode=n;nearest=d}}return foundNode}
function local(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!entryDone)finishEntry();if(e.ctrlKey)return;hover=null;velocity={x:0,y:0};const unit=e.deltaMode===1?16:e.deltaMode===2?H:1;camera.x+=(e.shiftKey?e.deltaY:e.deltaX)*unit/camera.z;camera.y+=(e.shiftKey?0:e.deltaY)*unit/camera.z;dirty=true},{passive:false});
canvas.addEventListener('gesturestart',e=>e.preventDefault());canvas.addEventListener('gesturechange',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(!entryDone)finishEntry();if(selected)clearSelection();hover=null;velocity={x:0,y:0};$('node-hint').classList.remove('visible');canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const p=local(e);pointers.set(e.pointerId,p);if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};drag=null;}else drag={start:p,previous:p,moved:false};canvas.classList.add('dragging')});
canvas.addEventListener('pointermove',e=>{const p=local(e);pointerWorld=world(p.x,p.y);if(pointers.has(e.pointerId))pointers.set(e.pointerId,p);if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};camera.x-=(center.x-pinch.center.x)/camera.z;camera.y-=(center.y-pinch.center.y)/camera.z;pinch={center};dirty=true;return}if(drag){const vx=(p.x-drag.previous.x)/camera.z,vy=(p.y-drag.previous.y)/camera.z;camera.x-=vx;camera.y-=vy;velocity={x:Math.max(-16,Math.min(16,vx*.45)),y:Math.max(-16,Math.min(16,vy*.45))};drag.time=performance.now();drag.moved||=Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>4;drag.previous=p;dirty=true;}else{hover=hit(p.x,p.y);canvas.style.cursor=hover?'pointer':'grab';dirty=true;}});
function pointerEnd(e){const p=local(e);if(!drag||performance.now()-(drag.time||0)>80)velocity={x:0,y:0};if(drag&&!drag.moved){const n=hit(p.x,p.y);if(n)select(n)}pointers.delete(e.pointerId);drag=null;pinch=null;canvas.classList.remove('dragging');dirty=true;}
canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',()=>{velocity={x:0,y:0};pointers.clear();drag=null;pinch=null;canvas.classList.remove('dragging')});canvas.addEventListener('pointerleave',()=>{hover=null;pointerWorld=null;$('node-hint').classList.remove('visible');dirty=true});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sound-panel').hidden){setSoundPanel(false,true);return}if(e.target.closest('input,select,textarea,dialog,#sound-panel')||$('help-dialog').open)return;if(e.key==='Escape'){clearSelection();return}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(e.key)){e.preventDefault();keys.add(e.key)}});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());
function newMap(value){instrument.reset();seed=String(value||freshSeed()).trim().slice(0,32)||freshSeed();camera={x:750,y:550,z:FIXED_SCALE};velocity={x:0,y:0};hover=null;focusedNode=null;hoverMix.clear();growth.clear();pathCache.clear();cache.clear();visited.clear();found.clear();clearSelection();const url=new URL(location.href);url.search='';history.replaceState({},'',url);applySettings();entryStart=performance.now();entryDone=reducedMotion;entrySettled=false;document.body.classList.remove('entry-opening','entry-arrived');document.body.classList.add('entering');$('entry').hidden=false;$('skip-entry').hidden=false;}
$('new-map').addEventListener('click',()=>newMap());$('load-seed').addEventListener('click',()=>newMap($('seed-input').value));$('seed-input').addEventListener('keydown',e=>{if(e.key==='Enter')newMap(e.target.value)});
for(const id of ['routing','font'])$(id).addEventListener('change',e=>{state[id]=e.target.value;applySettings()});
for(const [id,key]of [['spread','spread'],['weight','weight'],['type-size','typeSize'],['arrival','arrival'],['gesture','gesture']])$(id).addEventListener('input',e=>{state[key]=Number(e.target.value);if(key==='gesture')pathCache.clear();if(key==='spread'){cache.clear();pathCache.clear();if(selected){selected=sector(selected.cx,selected.cy).nodes[selected.project];select(selected)}}applySettings()});
for(const id of ['annotations','flow'])$(id).addEventListener('change',e=>{state[id]=e.target.checked;applySettings()});
for(const [id,key]of [['sound-color','music'],['image-color','digital'],['object-color','physical'],['yellow-color','yellow'],['black-color','black']])$(id).addEventListener('input',e=>{state[key]=e.target.value;applySettings()});
document.querySelectorAll('[data-channel]').forEach(el=>el.addEventListener('change',()=>{state.channels[el.dataset.channel]=el.checked;dirty=true}));
$('reset').addEventListener('click',()=>{Object.assign(state,defaults,{sound:{...SOUND_DEFAULTS},channels:{...defaults.channels}});cache.clear();pathCache.clear();if(selected){selected=sector(selected.cx,selected.cy).nodes[selected.project];select(selected)}applySettings()});
function setPanel(hidden){if(!hidden)setSoundPanel(false);$('control-panel').inert=hidden;$('control-panel').setAttribute('aria-hidden',String(hidden));document.body.classList.toggle('panel-hidden',hidden);$('panel-toggle').setAttribute('aria-expanded',String(!hidden));$('panel-toggle').innerHTML=`tune <span>${hidden?'+':'−'}</span>`;}
$('panel-toggle').addEventListener('click',()=>setPanel(!document.body.classList.contains('panel-hidden')));$('close-panel').addEventListener('click',()=>setPanel(true));setPanel(true);
$('clear-selection').addEventListener('click',clearSelection);$('help').addEventListener('click',()=>$('help-dialog').showModal());document.querySelector('.close-dialog').addEventListener('click',()=>$('help-dialog').close());$('help-close').addEventListener('click',()=>$('help-dialog').close());
function setSoundPanel(open,restoreFocus=false){
 $('sound-panel').hidden=!open;$('sound-settings').setAttribute('aria-expanded',String(open));
 if(open){setPanel(true);keys.clear();$('close-sound-panel').focus({preventScroll:true});}
 else if(restoreFocus)$('sound-settings').focus({preventScroll:true});
}
$('sound-settings').addEventListener('click',()=>setSoundPanel($('sound-panel').hidden));
$('close-sound-panel').addEventListener('click',()=>setSoundPanel(false,true));
$('sound-root').innerHTML=NOTE_NAMES.map((name,index)=>`<option value="${index}">${name}</option>`).join('');
$('chord-strip').innerHTML=Array.from({length:PHRASE_LENGTH},(_,i)=>`<span class="chord-step" data-chord="${i}"><b></b><i></i></span>`).join('');
function applySoundSettings(){
 instrument.setSettings(state.sound);instrument.setSeed(seed);syncEffectsUi();
 $('sound-root').value=state.sound.root;$('sound-reference').value=state.sound.reference;
 $('tuning-name').textContent=NOTE_NAMES[state.sound.root]+' dorian';
 $('scale-notes').textContent=DORIAN.map(n=>NOTE_NAMES[(n+state.sound.root)%12]).join(' · ');
 syncChordUi(instrument.meter());
 for(const key of ['pace','tone','space','tail','glide','harmony','reverbDecay','delay','delayTime','feedback','chorus','chorusRate','drive','melody','melodyDensity']){
  $('sound-'+key).value=key==='delayTime'?state.sound[key]*1000:state.sound[key];
  $(key+'-value').value=['pace','reverbDecay'].includes(key)?state.sound[key].toFixed(1)+' s':key==='tail'?state.sound[key].toFixed(2)+'×':['glide','delayTime'].includes(key)?Math.round(state.sound[key]*1000)+' ms':key==='chorusRate'?state.sound[key].toFixed(2)+' hz':Math.round(state.sound[key]*100)+'%';
 }
}
function setSoundTab(name,focus=false){
 for(const key of ['notes','effects']){const active=key===name;$(key+'-tab').setAttribute('aria-selected',String(active));$(key+'-tab').tabIndex=active?0:-1;$('sound-'+key).hidden=!active;}
 if(focus)$(name+'-tab').focus({preventScroll:true});
}
for(const key of ['notes','effects']){
 $(key+'-tab').addEventListener('click',()=>setSoundTab(key));
 $(key+'-tab').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setSoundTab(e.key==='Home'?'notes':e.key==='End'?'effects':key==='notes'?'effects':'notes',true);}});
}
const effectPresets={
 close:{space:.15,reverbDecay:.8,delay:0,delayTime:.16,feedback:.16,chorus:.05,chorusRate:.5,drive:.1,tone:.7},
 drift:{space:.5,reverbDecay:5,delay:.22,delayTime:.42,feedback:.4,chorus:.3,chorusRate:.2,drive:.05,tone:.55},
 echo:{space:.2,reverbDecay:1.6,delay:.38,delayTime:.32,feedback:.52,chorus:.1,chorusRate:.4,drive:.15,tone:.6}
};
function syncEffectsUi(){
 $('effects-bypass').setAttribute('aria-pressed',String(state.sound.fxBypass));$('effects-bypass').textContent=state.sound.fxBypass?'restore effects':'compare dry';
 $('sound-effects').classList.toggle('is-dry',state.sound.fxBypass);
 document.querySelectorAll('[data-effect-preset]').forEach(button=>{const preset=effectPresets[button.dataset.effectPreset];button.setAttribute('aria-pressed',String(!state.sound.fxBypass&&Object.entries(preset).every(([k,v])=>state.sound[k]===v)));});
}
$('effects-bypass').addEventListener('click',()=>{state.sound=soundSettings({fxBypass:!state.sound.fxBypass},state.sound);applySoundSettings();});
for(const button of document.querySelectorAll('[data-effect-preset]'))button.addEventListener('click',()=>{state.sound=soundSettings({...effectPresets[button.dataset.effectPreset],fxBypass:false},state.sound);applySoundSettings();});
$('source-select').innerHTML=RECORDINGS.map(record=>`<option value="${record.id}">${record.name} · ${record.role}</option>`).join('');
$('source-select').addEventListener('change',()=>{instrument.stopSource();const record=RECORDINGS.find(r=>r.id===$('source-select').value);$('source-duration').textContent=record.duration.toFixed(1)+' s';});
function syncChordUi(meter){
 $('phrase-number').textContent='phrase '+String(meter.phrase+1).padStart(2,'0')+' · evolving';
 const note=meter.melody?.midi;$('melody-note').textContent=Number.isFinite(note)?'melody · '+NOTE_NAMES[note%12]+(Math.floor(note/12)-1):'melody · —';
 $('melody-note').classList.toggle('playing',Number.isFinite(note));
 document.querySelectorAll('.chord-step').forEach((el,i)=>{
  const name=chordName(state.sound.root,meter.progression[i]);if(el.querySelector('b').textContent!==name)el.querySelector('b').textContent=name;
  const active=i===meter.chord&&instrument.enabled;
  el.classList.toggle('active',active);el.setAttribute('aria-current',String(active));el.style.setProperty('--phase',active?meter.phase:0);
 });
 $('audition-progression').innerHTML=meter.preview?'stop preview <span>□</span>':'hear composition <span>▷</span>';
 $('audition-progression').setAttribute('aria-pressed',String(meter.preview));
}
function syncSoundUi(){
 const enabled=instrument.enabled;
 $('sound-toggle').setAttribute('aria-pressed',String(enabled));$('sound-toggle').setAttribute('aria-label',enabled?'Mute sound':'Enable sound');
 $('sound-toggle').querySelector('.sound-copy').textContent=enabled?'sound on':'sound off';
 $('panel-mute').textContent=enabled?'mute':'sound off';$('panel-mute').setAttribute('aria-label',enabled?'Mute field audio':'Enable field audio');
 $('sound-status').textContent=instrument.loading?'loading your recording…':instrument.loadError?'recording could not load · tap sound to retry':enabled?'four recordings · one evolving composition':'sound is off · tap hear composition to listen';
 $('audition-source').textContent=instrument.original?'stop source □':'listen source ▷';$('audition-source').setAttribute('aria-pressed',String(!!instrument.original));
 for(const id of ['audition-source','audition-progression','sound-toggle','panel-mute'])$(id).disabled=instrument.loading;
 document.body.classList.toggle('sound-on',enabled);
}
for(const key of ['root','reference','pace','tone','space','tail','glide','harmony','reverbDecay','delay','delayTime','feedback','chorus','chorusRate','drive','melody','melodyDensity']){
 const el=$('sound-'+key);
 el.addEventListener(key==='root'||key==='reference'?'change':'input',()=>{state.sound=soundSettings({[key]:el.value===''?NaN:Number(el.value)/(key==='delayTime'?1000:1)},state.sound);applySoundSettings();});
}
$('sound-reference').addEventListener('input',e=>{if(e.target.value!==''&&e.target.validity.valid){state.sound=soundSettings({reference:Number(e.target.value)},state.sound);instrument.setSettings(state.sound);}});
$('sound-reset').addEventListener('click',()=>{state.sound={...SOUND_DEFAULTS};state.volume=defaults.volume;applySettings();instrument.reset();syncChordUi(instrument.meter());});
$('audition-progression').addEventListener('click',async()=>{
 if(instrument.meter().preview){instrument.stopAudition();return;}
 $('audition-progression').disabled=true;
 try{if(!instrument.enabled&&!(await instrument.enable())){toast('tap sound to try again');return;}instrument.audition();}
 catch{toast('sound is unavailable in this browser');}
 finally{$('audition-progression').disabled=false;syncSoundUi();}
});
$('panel-mute').addEventListener('click',toggleSound);
$('audition-source').addEventListener('click',async()=>{
 if(instrument.original){instrument.stopSource();return;}
 $('audition-source').disabled=true;
 try{if(!instrument.enabled&&!(await instrument.enable())){toast('tap sound to try again');return;}instrument.auditionSource($('source-select').value);}
 catch{toast('the recording could not play');}
 finally{$('audition-source').disabled=false;syncSoundUi();}
});

function replayDrawing(){
 finishEntry();clearSelection();hover=null;hoverMix.clear();instrument.reset();growth.clear();dirty=true;
}
async function toggleSound(){
 if(instrument.enabled){instrument.disable();return;}
 $('sound-toggle').disabled=true;
 try{if(await instrument.enable())replayDrawing();else toast('tap sound to try again');}
 catch{toast('sound is unavailable in this browser');}
 finally{$('sound-toggle').disabled=false;syncSoundUi();}
}
$('sound-toggle').addEventListener('click',toggleSound);
$('skip-entry').textContent='enter with sound ↗';
$('skip-entry').addEventListener('click',()=>{if(instrument.enabled)replayDrawing();else toggleSound();});
$('volume').addEventListener('input',e=>{state.volume=Number(e.target.value);instrument.setVolume(state.volume);$('volume-value').value=Math.round(state.volume*100)+'%';});
$('replay-drawing').addEventListener('click',()=>{if(instrument.enabled)replayDrawing();else toggleSound();});
syncSoundUi();

$('copy-link').addEventListener('click',async()=>{const url=new URL(location.href);url.search='';url.searchParams.set('seed',seed);for(const k of ['x','y'])url.searchParams.set(k,camera[k].toFixed(2));url.searchParams.set('plot',JSON.stringify(state));history.replaceState({},'',url);try{await navigator.clipboard.writeText(url.href);toast('MAP LINK COPIED / SEED + POSITION + SETTINGS')}catch{toast('SAVED IN THE ADDRESS BAR / COPY ITS URL')}});
$('export').addEventListener('click',()=>{draw(performance.now());const a=document.createElement('a');a.download=`DVD-${seed}-${Math.floor(camera.x/SECTOR_W)}-${Math.floor(camera.y/SECTOR_H)}.png`;a.href=canvas.toDataURL('image/png');a.click();toast('DRAWING EXPORTED')});
document.body.classList.add('entering');
new ResizeObserver(resize).observe($('viewport'));document.fonts.ready.then(()=>dirty=true);applySettings();renderRegister();resize();draw();frame=requestAnimationFrame(tick);
document.addEventListener('visibilitychange',()=>{instrument.setVisible(!document.hidden);keys.clear();if(document.hidden)cancelAnimationFrame(frame);else{last=performance.now();dirty=true;frame=requestAnimationFrame(tick)}});
