// Deterministic, continuous drawing field. No storage or network dependencies.
export const SECTOR_W=1500, SECTOR_H=1100;
export const CHANNELS={music:{code:'S—01',name:'SOUND',members:[0,2,4,6]},digital:{code:'I—02',name:'IMAGE',members:[0,1,2,3]},physical:{code:'O—03',name:'OBJECT',members:[0,5]}};
export function hash(text){let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
export function random(seed){let a=hash(seed);return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const snap=v=>Math.round(v/20)*20;
export function boundary(seed,axis,x,y){const r=random(`${seed}/boundary/${axis}/${x}/${y}`);return snap((axis==='v'?SECTOR_H:SECTOR_W)*(.26+r()*.48))}
export function generateSector(seed,cx,cy,spread=1){
 const r=random(`${seed}/sector/${cx}/${cy}`), ox=cx*SECTOR_W,oy=cy*SECTOR_H;
 const base=[[490,370],[900,220],[1110,500],[1230,790],[650,820],[240,650],[930,960]];
 const mirror=r()>.5, shift=r()>.5?1:-1;
 const nodes=base.map(([bx,by],i)=>{let x=750+(bx-750)*spread+(r()-.5)*150,y=550+(by-550)*spread+(r()-.5)*110;if(mirror)x=1500-x;return{id:`${cx}:${cy}:${i}`,project:i,cx,cy,x:ox+snap(Math.max(130,Math.min(1370,x))),y:oy+snap(Math.max(120,Math.min(990,y))),labelSide:i===0?-1:1,angle:r()>.5?0:1}});
 // Resolve crowding after jitter and keep annotations clear enough to inspect.
 for(let k=0;k<4;k++)for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(Math.abs(a.x-b.x)<220&&Math.abs(a.y-b.y)<140){b.y=Math.min(oy+1000,b.y+140);if(Math.abs(a.y-b.y)<140)b.x+=a.x<b.x?160:-160;}}
 const edges=[],hubs=[];
 Object.entries(CHANNELS).forEach(([key,c],ch)=>{
  const hub={x:ox+snap(680+(r()-.5)*200+ch*60),y:oy+snap(480+(r()-.5)*140+ch*65),channel:key};hubs.push(hub);
  const west={x:ox,y:oy+boundary(seed,'v',cx,cy)+ch*14},east={x:ox+SECTOR_W,y:oy+boundary(seed,'v',cx+1,cy)+ch*14};
  const north={x:ox+boundary(seed,'h',cx,cy)+ch*14,y:oy},south={x:ox+boundary(seed,'h',cx,cy+1)+ch*14,y:oy+SECTOR_H};
  const add=(a,b,id,project=null,trunk=false)=>edges.push({a,b,id:`${cx}:${cy}:${key}:${id}`,channel:key,project,trunk,lane:(r()-.5)*130,axis:trunk?'x':r()>.5?'x':'y'});
  add(west,hub,'w',null,true);add(hub,east,'e',null,true);add(north,hub,'n');add(hub,south,'s');
  c.members.forEach((index,i)=>{const n=nodes[index];add(hub,{x:n.x,y:n.y},`p${index}`,index);if(i&&key==='digital')add(nodes[c.members[i-1]],n,`chain${index}`,index)});
 });
 return{key:`${cx},${cy}`,cx,cy,ox,oy,nodes,edges,hubs,stamp:`${hash(`${seed}:${cx}:${cy}`).toString(16).slice(0,6).toUpperCase()}`,shift};
}
export function routePoints(edge,mode){
 const {a,b,lane,axis}=edge;
 if(mode==='diagonal'){const dx=b.x-a.x,dy=b.y-a.y,diagonal=Math.min(Math.abs(dx),Math.abs(dy))*.64;const sx=Math.sign(dx),sy=Math.sign(dy);return[a,{x:b.x-sx*diagonal,y:a.y},{x:b.x,y:a.y+sy*diagonal},b]}
 if(axis==='x'){const mid=(a.x+b.x)/2+lane;return[a,{x:mid,y:a.y},{x:mid,y:b.y},b]}
 const mid=(a.y+b.y)/2+lane;return[a,{x:a.x,y:mid},{x:b.x,y:mid},b];
}
