import {DORIAN,progressionFor,chordMidi} from './harmony.js';
export function seedNumber(text){let h=2166136261;for(const c of String(text)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;}
const random=(seed,index)=>{let h=Math.imul(seed^(index+17),1597334677);h=Math.imul(h^(h>>>16),2246822507);return(h^(h>>>13))>>>0;};
// Eight subdivisions per chord: a recurring motif, passing notes, rests, and a tonic ending.
export function melodyEvent(seed,step,root,density,progression=progressionFor(seed,Math.floor(step/32))){
 const position=step%32,chord=Math.floor(position/8),beat=position%8;
 if(density<=0||((random(seed,position)%1000)/1000>density&&beat!==0&&position!==31))return null;
 const motifs=[[0,2,4,3,2,1,2,0],[0,1,3,4,2,3,1,0],[2,3,4,6,5,4,2,1]],motif=motifs[seed%motifs.length];
 let degree=motif[beat];if(chord===1)degree=(degree+2)%7;if(chord===2)degree=(degree+1)%7;
 let midi=60+root+DORIAN[degree];
 if(beat%2===0)midi=chordMidi(midi,root,progression[chord]);
 if(position===31)midi=60+root;
 return {midi,source:beat===5||beat===7?'audio-19':'audio-9',accent:beat===0?1:.72,pan:((random(seed,position+64)%100)/100-.5)*.9,chord};
}
