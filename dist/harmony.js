export const NOTE_NAMES=['c','c♯','d','e♭','e','f','f♯','g','a♭','a','b♭','b'];
export const DORIAN=[0,2,3,5,7,9,10];
export const PHRASE_LENGTH=4;
const chords={
 home9:{root:0,suffix:'m9',tones:[0,3,7,10,14],voicing:[0,3,10,14]},
 home6:{root:0,suffix:'m6/9',tones:[0,3,7,9,14],voicing:[0,3,9,14]},
 second:{root:2,suffix:'m7',tones:[2,5,9,12],voicing:[2,5,9,12]},
 third:{root:3,suffix:'maj7',tones:[3,7,10,14],voicing:[3,7,10,14]},
 fourth:{root:5,suffix:'6',tones:[5,9,12,14],voicing:[2,5,9,12]},
 fifth:{root:7,suffix:'m7',tones:[7,10,14,17],voicing:[2,5,7,10]},
 seventh:{root:10,suffix:'maj7',tones:[10,14,17,21],voicing:[2,5,9,10]}
};
const departures=['second','third','fourth','fifth','seventh'];
const cadences={second:['fourth','fourth','seventh'],third:['fourth','second'],fourth:['second','seventh','fifth'],fifth:['fourth','second','seventh'],seventh:['fourth','second','fourth']};
const choice=(seed,index)=>{let h=Math.imul(seed^(index+31),1597334677);h=Math.imul(h^(h>>>16),2246822507);return(h^(h>>>13))>>>0;};
function voiceLead(chord,previous){
 let best=chord.voicing,cost=Infinity;
 for(let rotation=0;rotation<4;rotation++)for(let shift=-12;shift<=12;shift+=12){
  const notes=chord.voicing.slice(rotation).concat(chord.voicing.slice(0,rotation).map(n=>n+12)).map(n=>n+shift);
  if(notes[0]<-3||notes[3]>21)continue;
  const movement=notes.reduce((sum,n,i)=>sum+Math.abs(n-previous[i]),0);
  if(movement<cost){cost=movement;best=notes;}
 }
 return {...chord,voicing:best};
}
// Seeded harmonic routes, not a bank of fixed progressions. The departure cannot
// repeat on adjacent phrases; weighted cadences and extensions vary independently.
export function progressionFor(seed,phrase=0){
 const index=Math.max(0,Math.floor(phrase)),stride=1+choice(seed,2)%4;
 const departure=departures[(choice(seed,1)%departures.length+(index%departures.length)*stride)%departures.length];
 const options=cadences[departure],cadence=options[choice(seed,index*3+10)%options.length];
 const home=choice(seed,index*3+11)%3===0?'home6':'home9';
 let previous=chords[home].voicing;
 return [home,departure,cadence,home].map(key=>{const chord=voiceLead(chords[key],previous);previous=chord.voicing;return chord;});
}
export const SOUND_DEFAULTS={root:2,reference:440,pace:3.5,tone:.6,tail:1,glide:.08,space:.3,harmony:.4,reverbDecay:2.8,delay:.12,delayTime:.36,feedback:.3,chorus:.12,chorusRate:.35,drive:.08,fxBypass:false,melody:.6,melodyDensity:.65};
const limits={root:[0,11],reference:[400,480],pace:[1.5,8],tone:[0,1],tail:[.25,2],glide:[0,.5],space:[0,1],harmony:[0,1],reverbDecay:[.6,6],delay:[0,1],delayTime:[.08,.9],feedback:[0,.68],chorus:[0,1],chorusRate:[.1,1.5],drive:[0,1],melody:[0,1],melodyDensity:[0,1]};
export function soundSettings(input={},base=SOUND_DEFAULTS){
 const result={...base};
 for(const [key,[min,max]] of Object.entries(limits))if(Number.isFinite(input?.[key]))result[key]=Math.max(min,Math.min(max,input[key]));
 if(typeof input?.fxBypass==='boolean')result.fxBypass=input.fxBypass;
 result.root=Math.round(result.root);return result;
}
export function frequency(midi,reference=440){return reference*2**((midi-69)/12);}
export function chordName(root,chord){return NOTE_NAMES[(root+chord.root)%12]+chord.suffix;}
export function chordMidi(midi,root,chord){
 const origin=48+root,octave=Math.floor((midi-origin)/12);let nearest=origin,distance=Infinity;
 for(let o=octave-1;o<=octave+1;o++)for(const interval of chord.tones){const note=origin+o*12+interval,d=Math.abs(note-midi);if(d<distance){distance=d;nearest=note;}}
 return nearest;
}
