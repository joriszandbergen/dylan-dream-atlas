// Seeded stroke geometry. A stroke always reveals as one connected interval.
import {hash,routePoints} from './world.js';
const clamp=v=>Math.max(0,Math.min(1,v));
export function buildInkPath(edge,mode,gesture,seed){
 const h=hash(`${seed}/${edge.id}`),{a,b}=edge,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
 const nx=-dy/len,ny=dx/len,points=[];
 if(mode==='curve'){
  const bend=edge.lane*1.5;
  const c1=edge.axis==='x'?{x:a.x+dx*.58+bend,y:a.y}:{x:a.x,y:a.y+dy*.58+bend};
  const c2=edge.axis==='x'?{x:b.x-dx*.58+bend,y:b.y}:{x:b.x,y:b.y-dy*.58+bend};
  for(let i=0;i<=128;i++){
   const t=i/128,u=1-t;
   const flourish=Math.sin(Math.PI*t)**2*Math.sin(t*Math.PI*(h%3+2)+(h%7))*(h%4===0?75:18)*gesture;
   points.push({x:u*u*u*a.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x+nx*flourish,y:u*u*u*a.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*b.y+ny*flourish});
  }
 }else{
  const control=routePoints(edge,mode);
  for(let i=0;i<control.length-1;i++)for(let j=0;j<32;j++){const t=j/32;points.push({x:control[i].x+(control[i+1].x-control[i].x)*t,y:control[i].y+(control[i+1].y-control[i].y)*t});}
  points.push(b);
 }
 const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
 const length=cumulative.at(-1);
 const path={points,cumulative,length,hash:h,marks:[]};
 // Marks belong to positions along a line; they are never independent animations.
 const count=2+h%5;
 for(let i=0;i<count;i++){const t=(i+1)/(count+1),m=hash(`${h}/mark/${i}`);path.marks.push({t,shape:m%4,size:2.6+m%3,cluster:m%7===0,black:m%5===0});}
 return path;
}
export function pointAt(path,t){
 const distance=clamp(t)*path.length;let i=1;
 while(i<path.points.length-1&&path.cumulative[i]<distance)i++;
 const a=path.points[i-1],b=path.points[i],span=path.cumulative[i]-path.cumulative[i-1],f=span?(distance-path.cumulative[i-1])/span:0;
 return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t:clamp(t)};
}
export function strokeInterval(path,start,end){
 start=clamp(start);end=clamp(end);if(end<start)[start,end]=[end,start];
 const result=[pointAt(path,start)];
 for(let i=1;i<path.points.length-1;i++){const t=path.length?path.cumulative[i]/path.length:0;if(t>start&&t<end)result.push({...path.points[i],t});}
 if(end>start)result.push(pointAt(path,end));return result;
}
export function pressure(path,t,gesture){
 const h=path.hash,center=.24+(h%51)/100,span=.07+(h%13)/100;
 const distance=Math.max(0,span-Math.abs(t-center));
 const shoulder=clamp(distance/.028);
 // Flat-bodied ink bars, with circular shoulders where they join the fine thread.
 const cap=Math.sqrt(1-Math.pow(1-shoulder,2));
 const swell=(h%4===0?10:h%4===1?3.8:0)*cap*gesture;
 return .85+swell+(h%11===0?2.8*gesture:0);
}
