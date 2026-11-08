// The supplied recording becomes a pitched instrument for the Dorian drawing.
import {SoundEffects} from './effects.js';
import {RECORDING,RECORDINGS} from './audio-source.js';
import {melodyEvent,seedNumber} from './melody.js';
import {SOUND_DEFAULTS,PHRASE_LENGTH,progressionFor,soundSettings,frequency,chordMidi} from './harmony.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(param,value,time,speed=.045)=>{param.cancelScheduledValues(time);param.setTargetAtTime(value,time,speed);};
const remember=(map,key,value,limit=1024)=>{map.set(key,value);if(map.size>limit)map.delete(map.keys().next().value);};
async function loadRecording(context){
 const entries=await Promise.all(RECORDINGS.map(async record=>{
  const buffers=await Promise.all([record.sample,record.sustain].map(async path=>{
   const response=await fetch(new URL(path,import.meta.url));if(!response.ok)throw new Error('Recording unavailable');
   const buffer=await context.decodeAudioData(await response.arrayBuffer());if(!buffer.length)throw new Error('Empty recording');return buffer;
  }));return [record.id,{sample:buffers[0],sustain:buffers[1]}];
 }));return Object.fromEntries(entries);
}
export class ShapeInstrument{
 constructor({contextFactory,sampleLoader=loadRecording,onState=()=>{}}={}){
  this.sampleLoader=sampleLoader;this.loading=false;this.loadError=false;this.enableAttempt=0;this.original=null;this.compositionSeed=1;this.melodyStep=-1;this.bassStep=-1;this.lastMelody=null;this.phraseBase=0;this.harmonyPhrase=0;this.nextPhrase=0;this.progressionCache=null;
  this.contextFactory=contextFactory||(()=>new(globalThis.AudioContext||globalThis.webkitAudioContext)());
  this.settings={...SOUND_DEFAULTS};this.phraseStart=null;this.resolveUntil=0;this.activityUntil=0;this.previewUntil=0;this.bed=[];
  this.onState=onState;this.enabled=false;this.visible=true;this.volume=.45;this.peak=0;
  this.voices=new Map();this.notes=new Set();this.progress=new Map();this.arrivals=new Map();this.cooldowns=new Map();this.candidates=new Map();this.hovered=null;
 }
 get ready(){return this.enabled&&this.visible&&this.context?.state==='running';}
 async enable(){
  const attempt=++this.enableAttempt;clearTimeout(this.suspendTimer);
  if(!this.context){
   const c=this.context=this.contextFactory();this.bus=c.createGain();
   this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-20;this.compressor.knee.value=14;this.compressor.ratio.value=12;this.compressor.attack.value=.003;this.compressor.release.value=.22;
   const limiter=c.createWaveShaper(),curve=new Float32Array(2048);
   for(let i=0;i<curve.length;i++)curve[i]=Math.tanh((i/(curve.length-1)*2-1)*1.4)*.85;
   limiter.curve=curve;limiter.oversample='2x';this.master=c.createGain();this.master.gain.value=0;
   this.analyser=c.createAnalyser();this.analyser.fftSize=512;this.samples=new Float32Array(512);
   this.effects=new SoundEffects(c,this.bus,this.compressor,this.settings);this.compressor.connect(limiter);limiter.connect(this.master);this.master.connect(this.analyser);this.analyser.connect(c.destination);
  }
  this.loading=!this.sampleBuffer;this.loadError=false;this.onState();
  try{
   // Resume inside the gesture; fetch/decode can finish afterwards without losing activation.
   await this.context.resume();
   if(!this.recordingPromise)this.recordingPromise=this.sampleLoader(this.context).then(bank=>{this.bank=bank;this.sampleBuffer=bank['audio-2'].sample;this.sustainBuffer=bank['audio-2'].sustain;}).catch(error=>{this.recordingPromise=null;throw error;});
   await this.recordingPromise;
   if(attempt!==this.enableAttempt)return false;
   this.enabled=this.visible&&this.context.state==='running';
  }catch{if(attempt!==this.enableAttempt)return false;this.enabled=false;this.loadError=true;await this.context.suspend().catch(()=>{});}
  this.loading=false;this.setVolume(this.volume);this.onState();return this.enabled;
 }
 disable(){
  ++this.enableAttempt;this.loading=false;this.enabled=false;this.reset();if(this.context){smooth(this.master.gain,0,this.context.currentTime,.015);this.suspendTimer=setTimeout(()=>{if(!this.enabled)this.context.suspend().catch(()=>{});},90);}
  this.onState();
 }
 setVolume(value){this.volume=clamp(value);if(this.master)smooth(this.master.gain,this.enabled?this.volume*.7:0,this.context.currentTime,.025);}
 async setVisible(visible){
  this.visible=visible;if(!this.context)return;
  if(!visible){this.stopAll();await this.context.suspend().catch(()=>{});}
  else if(this.enabled){try{await this.context.resume();}catch{this.enabled=false;}if(this.context.state!=='running')this.enabled=false;this.setVolume(this.volume);}
  this.onState();
 }
 setSettings(input){
  const next=soundSettings(input,this.settings),old=this.settings,c=this.context;
  const retune=next.root!==old.root||next.reference!==old.reference;
  if(c&&next.pace!==old.pace&&this.phraseStart!==null){const elapsed=(c.currentTime-this.phraseStart)/old.pace;this.phraseStart=c.currentTime-elapsed*next.pace;if(this.previewUntil>c.currentTime)this.previewUntil=this.phraseStart+PHRASE_LENGTH*next.pace;}
  this.settings=next;
  if(c){
   this.effects.update(next);
   if(retune){this.stopNotes();this.clearEffects();}
   for(const v of this.voices.values())this.updateVoice(v,v.params);
   if(this.bed.length)this.updateHarmony();
  }
 }
 clearEffects(){this.effects.clear();}

 chord(){
  if(this.phraseStart===null||this.resolveUntil)return 0;
  return Math.floor(Math.max(0,this.context.currentTime-this.phraseStart)/this.settings.pace)%PHRASE_LENGTH;
 }
 progression(){
  if(this.phraseStart!==null&&!this.resolveUntil){
   this.harmonyPhrase=this.phraseBase+Math.floor(Math.max(0,this.context.currentTime-this.phraseStart)/(this.settings.pace*PHRASE_LENGTH));
   this.nextPhrase=this.harmonyPhrase+1;
  }
  if(this.progressionCache?.phrase!==this.harmonyPhrase)this.progressionCache={phrase:this.harmonyPhrase,chords:progressionFor(this.compositionSeed,this.harmonyPhrase)};
  return this.progressionCache.chords;
 }
 engage(){
  if(this.phraseStart===null||this.resolveUntil){this.phraseBase=this.nextPhrase;this.harmonyPhrase=this.phraseBase;this.nextPhrase++;this.phraseStart=this.context.currentTime;this.resolveUntil=0;this.melodyStep=-1;this.bassStep=-1;}
 }
 pitch(midi){return frequency(chordMidi(midi,this.settings.root,this.progression()[this.chord()]),this.settings.reference);}
 stopNotes(){for(const note of this.notes){try{note.source.stop(this.context.currentTime+.025);}catch{}note.cleanup();}this.notes.clear();}
 player(loop=true,id='audio-2'){
  const source=this.context.createBufferSource();source.buffer=this.bank[id][loop?'sustain':'sample'];source.loop=loop;return source;
 }
 setSeed(seed){const next=seedNumber(seed);if(next!==this.compositionSeed){this.reset();this.compositionSeed=next;}}
 auditionSource(id='audio-2'){
  if(!this.ready)return;this.reset();const c=this.context,source=this.player(false,id),amp=c.createGain();
  amp.gain.value=.22;source.connect(amp);amp.connect(this.compressor);const preview={source,amp};this.original=preview;
  source.onended=()=>{source.disconnect();amp.disconnect();if(this.original===preview){this.original=null;this.onState();}};source.start();this.onState();
 }
 stopSource(){if(!this.original)return;const {source,amp}=this.original;this.original=null;source.stop();source.disconnect();amp.disconnect();this.onState();}
 startHarmony(){
  const c=this.context;
  for(let i=0;i<5;i++){
   const source=this.player(),amp=c.createGain(),pan=c.createStereoPanner();amp.gain.value=0;pan.pan.value=(i-2)*.15;
   source.connect(amp);amp.connect(pan);pan.connect(this.bus);
   source.onended=()=>{source.disconnect();amp.disconnect();pan.disconnect();};source.start(0,i*this.sustainBuffer.duration/5);this.bed.push({source,amp,pan});
  }
 }
 updateHarmony(){
  const c=this.context,chord=this.progression()[this.chord()],notes=[36+this.settings.root+chord.root,...chord.voicing.map(n=>48+this.settings.root+n)];
  this.bed.forEach((v,i)=>{smooth(v.source.playbackRate,frequency(notes[i],this.settings.reference)/RECORDING.rootHz,c.currentTime,.08);smooth(v.amp.gain,this.settings.harmony*(i===0?.055:.03),c.currentTime,.12);});
 }
 stopHarmony(){
  const now=this.context.currentTime;for(const v of this.bed){smooth(v.amp.gain,0,now,.025);v.source.stop(now+.15);}this.bed=[];
 }
 tick(){
  if(!this.ready||this.original)return;
  const now=this.context.currentTime,active=this.voices.size>0||now<this.activityUntil||now<this.previewUntil;
  if(active){this.engage();if(!this.bed.length)this.startHarmony();}
  else if(this.phraseStart!==null&&!this.resolveUntil)this.resolveUntil=now+1.2*this.settings.tail;
  if(this.resolveUntil&&now>=this.resolveUntil){this.stopHarmony();this.phraseStart=null;this.resolveUntil=0;}
  if(this.bed.length)this.updateHarmony();
  if(active)this.playComposition();
  for(const v of this.voices.values())this.updateVoice(v,v.params);
 }
 playComposition(){
  const c=this.context,s=this.settings,elapsed=Math.max(0,c.currentTime-this.phraseStart),step=Math.floor(elapsed/s.pace*8),bar=Math.floor(step/8);
  if(bar!==this.bassStep){
   this.bassStep=bar;const chord=this.progression()[bar%PHRASE_LENGTH];
   if(s.harmony>0)this.sequence({frequencies:[frequency(36+s.root+chord.root,s.reference)],sourceId:'audio-4',level:.18*s.harmony,attack:.008,decay:.45,offset:.008,cutoff:1300,keepAlive:false});
  }
  if(step===this.melodyStep)return;this.melodyStep=step;
  const event=melodyEvent(this.compositionSeed,step,s.root,s.melodyDensity,this.progression());if(!event||s.melody===0)return;
  this.lastMelody={midi:event.midi,time:c.currentTime,source:event.source};
  this.sequence({frequencies:[frequency(event.midi,s.reference)],sourceId:event.source,pan:event.pan,level:.18*s.melody*event.accent,attack:.009,decay:Math.min(.6,s.pace/8*.85),cutoff:4800,keepAlive:false});
 }
 audition(){
  if(!this.ready)return;this.stopAll();this.engage();this.previewUntil=this.context.currentTime+this.settings.pace*PHRASE_LENGTH;this.tick();
 }
 stopAudition(){this.previewUntil=0;this.tick();}
 stopVoice(id){
  const v=this.voices.get(id);if(!v)return;this.voices.delete(id);
  const now=this.context.currentTime;smooth(v.amp.gain,0,now,.025);
  v.source.stop(now+.12);
 }
 stopAll(){
  this.stopSource();
  for(const id of this.voices.keys())this.stopVoice(id);
  this.stopNotes();if(this.context){this.stopHarmony();this.clearEffects();}
  this.phraseStart=null;this.resolveUntil=0;this.activityUntil=0;this.previewUntil=0;this.melodyStep=-1;this.bassStep=-1;this.lastMelody=null;this.candidates.clear();
 }
 reset(){this.stopAll();this.phraseBase=0;this.harmonyPhrase=0;this.nextPhrase=0;this.progressionCache=null;this.progress.clear();this.arrivals.clear();this.cooldowns.clear();this.hovered=null;}
 beginFrame(){this.candidates.clear();this.frameNotes=0;}
 stroke({id,progress,flow=false,visible,pan,height,thickness,turn,direction,length,seed,marks,routing,channel}){
  if(!this.ready||this.original)return;
  const previous=this.progress.get(id),time=this.context.currentTime;
  remember(this.progress,id,{progress,time});
  // Only crossed marks sound, and only where they are actually visible. No catch-up bursts.
  if(previous&&time-previous.time<.3){
   const delta=flow&&progress<previous.progress?1+progress-previous.progress:progress-previous.progress;
   if(delta>0&&delta<.22)for(const m of marks){
    const crossed=flow&&progress<previous.progress?(m.travel>previous.progress||m.travel<=progress):(m.travel>previous.progress&&m.travel<=progress);
    if(crossed&&m.visible&&this.frameNotes<5){this.frameNotes++;this.mark(m.shape,seed+Math.round(m.travel*97),m.pan);}
   }
  }
  if(visible&&progress>0&&(flow||progress<1))this.candidates.set(id,{pan,height,thickness,turn,direction,length,seed,routing,channel,flow});
 }
 endFrame(){
  if(!this.ready||this.original)return;
  // Stable priority keeps dense fields polyphonic without spawning a voice for every pixel.
  const audible=[...this.candidates].sort((a,b)=>this.priority(b)-this.priority(a)).slice(0,8),ids=new Set(audible.map(([id])=>id));
  for(const id of this.voices.keys())if(!ids.has(id))this.stopVoice(id);
  for(const [id,p]of audible){let v=this.voices.get(id);if(!v){v=this.makeVoice(p);this.voices.set(id,v);}this.updateVoice(v,p);}
 }
 priority([id,p]){return 1-Math.abs(p.pan)*.5+(this.voices.has(id)?.3:0)+Math.min(p.thickness,10)*.015;}
 makeVoice(p){
  this.engage();const sourceId=p.channel==='music'?'audio-9':'audio-2',record=RECORDINGS.find(r=>r.id===sourceId);const c=this.context,source=this.player(true,sourceId),filter=c.createBiquadFilter(),amp=c.createGain(),pan=c.createStereoPanner();
  filter.type='lowpass';amp.gain.value=0;
  source.connect(filter);filter.connect(amp);amp.connect(pan);pan.connect(this.bus);
  source.onended=()=>{source.disconnect();filter.disconnect();amp.disconnect();pan.disconnect();};
  source.start(0,(Math.abs(p.seed)%97)/97*source.buffer.duration);return {source,filter,amp,pan,rootHz:record.rootHz};
 }
 updateVoice(v,p){
  v.params=p;const now=this.context.currentTime,octave=p.length>850?-12:p.length<260?12:0;
  const chord=this.progression()[this.chord()],degree=chord.tones[Math.abs(p.seed)%chord.tones.length];
  const midi=48+this.settings.root+degree+octave+(p.height-.5)*7-clamp(p.thickness/12)*4+p.direction*.8;
  const target=this.pitch(midi);
  if(v.target!==target){
   v.target=target;
   for(const [param,value]of [[v.source.playbackRate,target/v.rootHz]]){
    param.cancelScheduledValues(now);
    if(this.settings.glide)smooth(param,value,now,this.settings.glide/3);else param.setValueAtTime(value,now);
   }
  }
  smooth(v.filter.frequency,clamp(1100+p.height*1800+p.turn*2400-p.thickness*45,500,5000),now);
  smooth(v.filter.Q,.3+p.turn*2,now);smooth(v.pan.pan,clamp(p.pan,-.85,.85),now);
  smooth(v.amp.gain,(.04+clamp(p.thickness/12)*.05)*(p.flow?.38:1),now,.035);
 }
 sequence({frequencies,pan=0,level=.12,spacing=.09,decay=.28,attack=.008,cutoff=2600,glide=false,offset=RECORDING.sampleOffset,sourceId='audio-2',keepAlive=true}){
  if(!this.ready||this.original||this.notes.size>=24)return;
  this.engage();decay*=this.settings.tail;
  const c=this.context,now=c.currentTime,source=this.player(false,sourceId),record=RECORDINGS.find(r=>r.id===sourceId),filter=c.createBiquadFilter(),amp=c.createGain(),panner=c.createStereoPanner();
  level*=1.6;filter.type='lowpass';filter.frequency.value=cutoff;filter.Q.value=.4;panner.pan.value=clamp(pan,-.85,.85);
  source.connect(filter);filter.connect(amp);amp.connect(panner);panner.connect(this.bus);amp.gain.setValueAtTime(.0001,now);
  frequencies.forEach((frequency,i)=>{
   const start=now+i*spacing;
   if(glide&&i)source.playbackRate.exponentialRampToValueAtTime(frequency/record.rootHz,start);else source.playbackRate.setValueAtTime(frequency/record.rootHz,start);
   amp.gain.setValueAtTime(.0001,start);amp.gain.linearRampToValueAtTime(level*(1-i*.06),start+attack);
   amp.gain.exponentialRampToValueAtTime(.0001,start+Math.min(decay,i===frequencies.length-1?decay:spacing*.95));
  });
  const end=now+(frequencies.length-1)*spacing+decay+.03;if(keepAlive)this.activityUntil=Math.max(this.activityUntil,end);
  const note={source,cleanup:()=>{source.disconnect();filter.disconnect();amp.disconnect();panner.disconnect();this.notes.delete(note);}};
  source.onended=note.cleanup;this.notes.add(note);source.start(now,offset);source.stop(end);
 }
 mark(shape,seed,pan){
  if(!this.ready||this.original)return;this.engage();const chord=this.progression()[this.chord()],degree=chord.tones[Math.abs(seed)%chord.tones.length];
  const base=this.pitch(60+this.settings.root+degree);
  this.sequence({frequencies:[base],type:shape===0?'sine':shape===2?'triangle':'sine',pan,level:.055,decay:shape===2?.22:.12,attack:.005,cutoff:shape===3?1200:3500,sourceId:Math.abs(seed)%2?'audio-19':'audio-9',offset:.035+(Math.abs(seed)%5)*.012});
 }
 project(index,geometry,pan=0,strength=1){
  if(!this.ready||this.original)return;this.engage();const chord=this.progression()[this.chord()],root=48+this.settings.root,degree=index%chord.tones.length;
  const note=offset=>this.pitch(root+chord.tones[(degree+offset)%chord.tones.length]+(degree+offset>=chord.tones.length?12:0)),level=.115*strength;
  if(!geometry.sides)this.sequence({frequencies:[note(0)],sourceId:['audio-2','audio-9','audio-19'][index%3],pan,level,attack:.02,decay:1.15,cutoff:3200});
  else if(geometry.sides===3)this.sequence({frequencies:[note(0),note(1),note(2)],type:'triangle',pan,level,spacing:.095,decay:.36,cutoff:2200});
  else if(geometry.sides===4&&geometry.angle===0)this.sequence({frequencies:[note(1),note(2),note(1)],pan,level:level*.8,spacing:.09,decay:.48,cutoff:5000,glide:true});
  else if(geometry.sides===4)this.sequence({frequencies:[note(0),note(0),note(2),note(0)],type:'square',pan,level:level*.62,spacing:.085,decay:.18,cutoff:850});
  else this.sequence({frequencies:[note(0),note(1),note(2),note(3),note(2),note(1)],type:'triangle',pan,level:level*.72,spacing:.065,decay:.3,cutoff:2400});
 }
 arrive(id,index,geometry,pan,selected=false){
  if(!this.ready||this.arrivals.has(id))return;remember(this.arrivals,id,true,512);if(!selected)this.project(index,geometry,pan,.65);
 }
 hover(id,index,geometry,pan){
  if(id===this.hovered)return;this.hovered=id;if(!id||!this.ready)return;
  const time=this.context.currentTime;if(time-(this.cooldowns.get(id)??-10)<.5)return;
  remember(this.cooldowns,id,time,256);this.project(index,geometry,pan,.55);
 }
 meter(){
  const progression=this.progression(),phrase=this.harmonyPhrase;
  if(!this.ready)return {progression,phrase,level:0,peak:this.peak,voices:0,chord:0,phase:0,preview:false};
  this.analyser.getFloatTimeDomainData(this.samples);let sum=0;for(const v of this.samples)sum+=v*v;
  const rms=Math.sqrt(sum/this.samples.length);this.peak=Math.max(this.peak,rms);
  return {progression,phrase,level:clamp(rms*8),peak:this.peak,voices:this.voices.size+this.notes.size+this.bed.length+(this.original?1:0),chord:this.chord(),phase:this.phraseStart===null||this.resolveUntil?0:((this.context.currentTime-this.phraseStart)/this.settings.pace)%1,preview:this.context.currentTime<this.previewUntil,melody:this.lastMelody&&this.context.currentTime-this.lastMelody.time<.55?this.lastMelody:null};
 }
}
