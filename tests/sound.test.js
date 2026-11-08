import test from 'node:test';
import assert from 'node:assert/strict';
import {RECORDING,RECORDINGS} from '../dist/audio-source.js';
import {melodyEvent,seedNumber} from '../dist/melody.js';
import {ShapeInstrument} from '../dist/sound.js';
import {SOUND_DEFAULTS,DORIAN,progressionFor,frequency,chordMidi,soundSettings} from '../dist/harmony.js';
class Parameter{
 constructor(){this.value=0;this.events=[];}
 cancelScheduledValues(t){this.events=this.events.filter(e=>e[2]<t);}
 setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}
 setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}
 linearRampToValueAtTime(v,t){this.value=v;this.events.push(['linear',v,t]);}
 exponentialRampToValueAtTime(v,t){this.value=v;this.events.push(['exponential',v,t]);}
}
class AudioNode{
 constructor(){for(const key of ['delayTime','playbackRate','gain','frequency','Q','pan','threshold','knee','ratio','attack','release'])this[key]=new Parameter();this.links=[];}
 connect(n){this.links.push(n);return n;}disconnect(target){this.links=target?this.links.filter(n=>n!==target):[];this.disconnected=true;}
 start(t=0,offset=0){this.started=t;this.offset=offset;}stop(t){this.stopped=t;}
 getFloatTimeDomainData(a){a.fill(.025);}
}
class Context{
 constructor(){this.currentTime=0;this.sampleRate=48000;this.state='suspended';this.destination=new AudioNode();this.sources=[];this.lfos=[];}
 createGain(){return new AudioNode();}createBiquadFilter(){return new AudioNode();}createStereoPanner(){return new AudioNode();}createDynamicsCompressor(){return new AudioNode();}createWaveShaper(){return new AudioNode();}createAnalyser(){return new AudioNode();}
 createDelay(){return new AudioNode();}createOscillator(){const n=new AudioNode();this.lfos.push(n);return n;}
 createConvolver(){return new AudioNode();}
 createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:ch=>data[ch],length,duration:length/this.sampleRate};}
 createBufferSource(){const n=new AudioNode();n.playbackRate.value=1;this.sources.push(n);return n;}
 async resume(){this.state='running';}async suspend(){this.state='suspended';}
}
const fixture=()=>{const context=new Context(),bank=Object.fromEntries(RECORDINGS.map(r=>[r.id,{sample:context.createBuffer(2,Math.floor(r.duration*context.sampleRate)),sustain:context.createBuffer(2,19200)}])),buffers=bank['audio-2'];return {context,buffers,bank,instrument:new ShapeInstrument({contextFactory:()=>context,sampleLoader:async()=>bank})};};
const stroke=(id,progress=.1,extra={})=>({id,progress,visible:true,pan:0,height:.6,thickness:2,turn:.05,direction:0,length:500,seed:2,marks:[],routing:'curve',channel:'digital',...extra});
test('sound is opt-in; dense drawings are bounded; settled/offscreen lines release',async()=>{
 const {instrument,context}=fixture();instrument.beginFrame();instrument.stroke(stroke('silent'));instrument.endFrame();assert.equal(instrument.voices.size,0);
 await instrument.enable();instrument.beginFrame();for(let i=0;i<40;i++)instrument.stroke(stroke(String(i)));instrument.endFrame();assert.equal(instrument.voices.size,8);
 context.currentTime=.1;instrument.beginFrame();for(let i=0;i<40;i++)instrument.stroke(stroke(String(i),1));instrument.endFrame();assert.equal(instrument.voices.size,0);assert(context.sources.every(o=>Number.isFinite(o.stopped)));
 instrument.beginFrame();instrument.stroke(stroke('offscreen',.2,{visible:false}));instrument.endFrame();assert.equal(instrument.voices.size,0);
 instrument.disable();
});
test('marks trigger on crossings, never on repeated frames or stale catch-up',async()=>{
 const {instrument,context}=fixture();await instrument.enable();const marks=[{shape:0,travel:.2,pan:0,visible:true}];
 instrument.beginFrame();instrument.stroke(stroke('line',.1,{marks}));assert.equal(instrument.notes.size,0);
 context.currentTime=.05;instrument.stroke(stroke('line',.25,{marks}));assert.equal(instrument.notes.size,1);
 instrument.stroke(stroke('line',.25,{marks}));assert.equal(instrument.notes.size,1);
 context.currentTime=3;instrument.stroke(stroke('line',.9,{marks:[{shape:1,travel:.7,pan:0,visible:true}]}));assert.equal(instrument.notes.size,1);
 instrument.disable();assert.equal(instrument.notes.size,0);
});
test('project gestures play the supplied recording with tuned rhythmic sequences',async()=>{
 const {instrument,context}=fixture();await instrument.enable();
 instrument.project(0,{sides:0,angle:0});const circle=context.sources.at(-1);assert.equal(circle.buffer,instrument.sampleBuffer);assert.equal(circle.loop,false);assert.equal(circle.playbackRate.events.length,1);
 instrument.project(2,{sides:3,angle:-Math.PI/2});const triangle=context.sources.at(-1);assert.equal(triangle.buffer,instrument.sampleBuffer);assert.equal(triangle.playbackRate.events.length,3);
 instrument.project(3,{sides:4,angle:Math.PI/4});const square=context.sources.at(-1);assert.equal(square.playbackRate.events.length,4);
 instrument.project(4,{sides:6,angle:0});assert.equal(context.sources.at(-1).playbackRate.events.length,6);
 instrument.disable();
});
test('mute and hidden tabs stop sound; reset allows a new audiovisual generation',async()=>{
 const {instrument,context}=fixture();await instrument.enable();instrument.beginFrame();instrument.stroke(stroke('line'));instrument.endFrame();instrument.arrive('node',0,{sides:0,angle:0},0);assert(instrument.notes.size>0);
 instrument.arrive('node',0,{sides:0,angle:0},0);assert.equal(instrument.notes.size,1);
 await instrument.setVisible(false);assert.equal(context.state,'suspended');assert.equal(instrument.voices.size,0);assert.equal(instrument.notes.size,0);assert.equal(instrument.meter().level,0);
 await instrument.setVisible(true);assert.equal(instrument.ready,true);instrument.reset();instrument.arrive('node',0,{sides:0,angle:0},0);assert.equal(instrument.notes.size,1);
 instrument.setVolume(0);assert.equal(instrument.master.gain.value,0);instrument.disable();assert.equal(instrument.enabled,false);assert.equal(instrument.notes.size,0);
});

test('all chord tones remain in Dorian at every root; fundamentals use the selected reference pitch',()=>{
 assert.equal(frequency(69,440),440);assert.equal(frequency(69,432),432);
 assert(Math.abs(frequency(50)-146.8323839587)<1e-8);
 for(let root=0;root<12;root++)for(let chord=0;chord<4;chord++)for(let midi=30;midi<90;midi+=.37){
  const harmony=progressionFor(seedNumber('field'))[chord],note=chordMidi(midi,root,harmony),interval=((note-root)%12+12)%12;
  assert(DORIAN.includes(interval));assert(harmony.tones.some(t=>t%12===interval));
 }
 assert.deepEqual(soundSettings({root:99,reference:0,pace:Infinity,tone:-2,space:9,other:true}),{...SOUND_DEFAULTS,root:11,reference:400,tone:0,space:1});
 assert.deepEqual(soundSettings(null),SOUND_DEFAULTS);
});
test('a generated line follows the chord progression and retunes live',async()=>{
 const {instrument,context}=fixture();await instrument.enable();instrument.setSettings({glide:0});
 instrument.beginFrame();instrument.stroke(stroke('phrase'));instrument.endFrame();
 for(let step=0;step<4;step++){
  context.currentTime=step*instrument.settings.pace+.01;instrument.tick();assert.equal(instrument.chord(),step);
  const v=instrument.voices.get('phrase'),midi=Math.round(69+12*Math.log2(v.source.playbackRate.value*RECORDING.rootHz/440)),relative=((midi-2)%12+12)%12;
  assert(instrument.progression()[step].tones.some(n=>n%12===relative));assert.equal(v.source.buffer,instrument.sustainBuffer);assert.equal(v.source.loop,true);
 }
 const old=instrument.voices.get('phrase').source.playbackRate.value;instrument.setSettings({reference:432});
 assert(Math.abs(instrument.voices.get('phrase').source.playbackRate.value/old-432/440)<1e-10);
 instrument.setSettings({tone:0,space:1,harmony:0});assert.equal(instrument.effects.tone.frequency.value,350);assert.equal(instrument.effects.reverbWet.gain.value,.65);assert(instrument.bed.every(v=>v.amp.gain.value===0));
 instrument.disable();assert.equal(instrument.bed.length,0);
});
test('audition plays four chords then resolves home, releases, and can be muted',async()=>{
 const {instrument,context}=fixture();await instrument.enable();instrument.setSettings({pace:2});instrument.audition();assert.equal(instrument.bed.length,5);
 for(let i=0;i<4;i++){context.currentTime=i*2+.01;instrument.tick();assert.equal(instrument.meter().chord,i);assert.equal(instrument.meter().preview,true);}
 context.currentTime=8.1;instrument.tick();assert.equal(instrument.chord(),0);assert.equal(instrument.meter().preview,false);
 context.currentTime=10;instrument.tick();assert.equal(instrument.bed.length,0);assert.equal(instrument.phraseStart,null);
 instrument.audition();instrument.stopAudition();assert.equal(instrument.chord(),0);assert.equal(instrument.meter().preview,false);
 instrument.disable();assert.equal(instrument.bed.length,0);assert.equal(instrument.previewUntil,0);
});
test('pace edits preserve position in the progression; root edits clear stale notes and reverb',async()=>{
 const {instrument,context}=fixture();await instrument.enable();instrument.audition();context.currentTime=4;
 const phase=(context.currentTime-instrument.phraseStart)/instrument.settings.pace;
 instrument.setSettings({pace:6});assert.equal((context.currentTime-instrument.phraseStart)/6,phase);
 const notesBefore=instrument.notes.size;instrument.project(0,{sides:0});assert.equal(instrument.notes.size,notesBefore+1);const reverb=instrument.effects.reverb;
 instrument.setSettings({root:5});assert.equal(instrument.notes.size,0);assert.notEqual(instrument.effects.reverb,reverb);
 await instrument.setVisible(false);assert.equal(instrument.bed.length,0);assert.equal(instrument.phraseStart,null);
 instrument.disable();
});

test('the recording is loaded once, and all pitched layers use its audio buffers',async()=>{
 const {context,bank}=fixture();let loads=0;
 const instrument=new ShapeInstrument({contextFactory:()=>context,sampleLoader:async()=>{loads++;return bank;}});
 assert.equal(context.sources.length,0);await instrument.enable();instrument.beginFrame();instrument.stroke(stroke('sample'));instrument.endFrame();instrument.tick();instrument.project(0,{sides:0});
 assert.equal(instrument.bed.length,5);assert(context.sources.length>=7);assert(context.sources.every(source=>Object.values(bank).some(b=>source.buffer===b.sample||source.buffer===b.sustain)));
 instrument.disable();await instrument.enable();assert.equal(loads,1);instrument.disable();
});
test('source audition bypasses transposition and prevents drawing sounds until it finishes',async()=>{
 const {instrument,context,buffers}=fixture();await instrument.enable();instrument.auditionSource();const original=instrument.original;
 assert.equal(original.source.buffer,buffers.sample);assert.equal(original.source.playbackRate.value,1);assert.equal(original.source.loop,false);
 instrument.beginFrame();instrument.stroke(stroke('quiet'));instrument.endFrame();instrument.project(0,{sides:0});instrument.tick();assert.equal(context.sources.length,1);assert.equal(instrument.bed.length,0);
 original.source.onended();assert.equal(instrument.original,null);instrument.auditionSource();instrument.disable();assert.equal(instrument.original,null);
});
test('failed sample loads can retry, and muting during loading cannot start playback later',async()=>{
 const {context,bank}=fixture();let attempts=0;
 const instrument=new ShapeInstrument({contextFactory:()=>context,sampleLoader:async()=>{if(++attempts===1)throw new Error('offline');return bank;}});
 assert.equal(await instrument.enable(),false);assert.equal(instrument.loadError,true);assert.equal(instrument.loading,false);assert.equal(context.state,'suspended');
 assert.equal(await instrument.enable(),true);assert.equal(instrument.loadError,false);instrument.disable();
 let finish;const pending=new ShapeInstrument({contextFactory:()=>context,sampleLoader:()=>new Promise(resolve=>finish=resolve)});
 const enabled=pending.enable();await Promise.resolve();pending.disable();finish(bank);assert.equal(await enabled,false);assert.equal(pending.enabled,false);assert.equal(pending.loading,false);
});

test('effects settings are bounded, dry comparison bypasses every effect, and reset flushes feedback',async()=>{
 const {instrument,context}=fixture();await instrument.enable();instrument.setSettings({space:1,reverbDecay:999,delay:1,delayTime:99,feedback:99,chorus:1,chorusRate:99,drive:1});
 const fx=instrument.effects;assert.equal(instrument.settings.reverbDecay,6);assert.equal(fx.echo[0].feedback.gain.value,.68);assert.equal(fx.echo[0].delay.delayTime.value,.9);
 assert.equal(fx.chorus[0].lfo.frequency.value,1.5);assert.equal(fx.drivePre.gain.value,13);assert.equal(fx.clean.gain.value,0);
 const oldDelay=fx.echo[0].delay,oldLfos=fx.chorus.map(v=>v.lfo);instrument.setSettings({fxBypass:true});assert.equal(fx.clean.gain.value,1);assert.equal(fx.return.gain.value,0);assert.equal(fx.feed.gain.value,0);assert.notEqual(fx.echo[0].delay,oldDelay);assert(oldLfos.every(o=>o.stopped!==undefined||o.disconnected));
 instrument.setSettings({fxBypass:false});assert.equal(fx.clean.gain.value,0);assert.equal(fx.return.gain.value,1);
 const prior=fx.echo[0].delay;instrument.reset();assert.notEqual(fx.echo[0].delay,prior);instrument.disable();
});
test('reverb decay edits are debounced and old convolution paths are retired',async()=>{
 const {instrument}=fixture();await instrument.enable();const fx=instrument.effects,old=fx.reverb;
 instrument.setSettings({reverbDecay:3});instrument.setSettings({reverbDecay:4});instrument.setSettings({reverbDecay:5});
 await new Promise(resolve=>setTimeout(resolve,110));assert.equal(fx.reverb.node.buffer.duration,5);assert.equal(fx.retired.length,1);
 await new Promise(resolve=>setTimeout(resolve,200));assert.equal(fx.retired.length,0);assert.equal(old.node.disconnected,true);
 instrument.disable();assert.equal(fx.reverbTimer,null);
});
test('melodies reproduce per field, follow generated chords and resolve to the tonic',()=>{
 const seed=seedNumber('field');let other=false;
 for(let root=0;root<12;root++)for(let step=0;step<192;step++){
  const event=melodyEvent(seed,step,root,1);assert.deepEqual(event,melodyEvent(seed,step,root,1));
  assert(DORIAN.includes((event.midi-root)%12));if(step%2===0)assert(progressionFor(seed,Math.floor(step/32))[Math.floor(step/8)%4].tones.some(t=>t%12===(event.midi-root)%12));
  if(event.midi!==melodyEvent(seedNumber('other field'),step,root,1).midi)other=true;
 }
 assert(other);assert.equal(melodyEvent(seed,31,2,1).midi,62);assert.equal(melodyEvent(seed,0,2,0),null);
});
test('composition uses all four recordings, skips missed beats, and cannot sustain itself forever',async()=>{
 const {instrument,context,bank}=fixture();await instrument.enable();instrument.setSeed('music');instrument.audition();
 for(let step=0;step<32;step++){context.currentTime=step*instrument.settings.pace/8+.001;instrument.tick();}
 for(const id of ['audio-4','audio-9','audio-19'])assert(context.sources.some(source=>source.buffer===bank[id].sample));
 assert(context.sources.some(source=>source.buffer===bank['audio-2'].sustain));const count=context.sources.length;
 context.currentTime=14.1;instrument.tick();assert.equal(instrument.chord(),0);assert.equal(context.sources.length,count);
 context.currentTime=17;instrument.tick();assert.equal(instrument.bed.length,0);assert.equal(instrument.phraseStart,null);instrument.disable();
});

test('harmonic routes vary across fields and phrases while retaining Dorian character and tonic resolution',()=>{
 const routes=new Set();
 for(let field=0;field<20;field++){
  const seed=seedNumber('field-'+field);let previous;
  for(let phrase=0;phrase<20;phrase++){
   const progression=progressionFor(seed,phrase);assert.deepEqual(progression,progressionFor(seed,phrase));
   assert.equal(progression.length,4);assert.equal(progression[0].root,0);assert.equal(progression[3].root,0);
   assert.deepEqual(progression[0].tones,progression[3].tones);
   if(previous)assert.notEqual(progression[1].root,previous[1].root);
   assert(progression.some(chord=>chord.tones.some(n=>n%12===9)));
   for(const chord of progression){
    assert(chord.tones.every(n=>DORIAN.includes(n%12)));assert.equal(chord.voicing.length,4);
    assert(chord.voicing.every(n=>chord.tones.some(t=>t%12===(n+12)%12)));
    assert(chord.voicing.every(n=>n>=-3&&n<=21));
   }
   routes.add(progression.map(c=>c.root+c.suffix).join('/'));previous=progression;
  }
 }
 assert(routes.size>=20);
});
test('continuous exploration evolves harmony, keeps bass and melody aligned, and preserves position when pace changes',async()=>{
 const {instrument,context,bank}=fixture();await instrument.enable();instrument.setSeed('evolving');instrument.setSettings({glide:0,melodyDensity:1});
 instrument.beginFrame();instrument.stroke(stroke('continuous'));instrument.endFrame();instrument.tick();const first=instrument.progression();
 for(let bar=1;bar<12;bar++){
  instrument.stopNotes();context.currentTime=bar*instrument.settings.pace+.001;instrument.tick();
  const meter=instrument.meter(),chord=meter.progression[bar%4];assert.equal(meter.phrase,Math.floor(bar/4));
  assert.deepEqual(meter.progression,progressionFor(seedNumber('evolving'),meter.phrase));
  const bass=context.sources.filter(n=>n.buffer===bank['audio-4'].sample).at(-1);
  assert(Math.abs(bass.playbackRate.value-frequency(36+2+chord.root)/RECORDINGS.find(r=>r.id==='audio-4').rootHz)<1e-10);
  assert(chord.tones.some(n=>n%12===(meter.melody.midi-2)%12));
 }
 assert.notDeepEqual(instrument.progression(),first);const before=instrument.meter();instrument.setSettings({pace:6});const after=instrument.meter();
 assert.equal(before.phrase,after.phrase);assert.equal(before.chord,after.chord);assert.deepEqual(before.progression,after.progression);
 instrument.reset();instrument.audition();assert.deepEqual(instrument.progression(),first);assert.equal(instrument.meter().phrase,0);
 instrument.audition();assert.equal(instrument.meter().phrase,1);assert.notEqual(instrument.progression()[1].root,first[1].root);
 instrument.setSeed('another field');assert.equal(instrument.meter().phrase,0);assert.deepEqual(instrument.progression(),progressionFor(seedNumber('another field')));
 instrument.disable();
});
