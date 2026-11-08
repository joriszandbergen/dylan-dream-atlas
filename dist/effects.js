// A bounded, sample-preserving effects rack. Oscillators modulate delay time only.
const move=(p,v,t)=>{p.cancelScheduledValues(t);p.setTargetAtTime(v,t,.035);};
export class SoundEffects{
 constructor(context,input,output,settings){
  this.context=context;this.input=input;this.output=output;this.settings=settings;this.impulses=new Map();this.retired=[];
  const c=context;this.clean=c.createGain();this.feed=c.createGain();this.return=c.createGain();
  this.tone=c.createBiquadFilter();this.tone.type='lowpass';this.tone.Q.value=.35;
  this.driveClean=c.createGain();this.drivePre=c.createGain();this.shaper=c.createWaveShaper();this.makeup=c.createGain();this.driven=c.createGain();
  this.afterDrive=c.createGain();const curve=new Float32Array(4096);
  for(let i=0;i<curve.length;i++)curve[i]=Math.tanh(i/(curve.length-1)*2-1);
  this.shaper.curve=curve;this.shaper.oversample='2x';
  input.connect(this.clean);this.clean.connect(output);input.connect(this.feed);this.feed.connect(this.tone);
  this.tone.connect(this.driveClean);this.driveClean.connect(this.afterDrive);
  this.tone.connect(this.drivePre);this.drivePre.connect(this.shaper);this.shaper.connect(this.makeup);this.makeup.connect(this.driven);this.driven.connect(this.afterDrive);
  this.return.connect(output);this.clear();
 }
 impulse(seconds){
  if(this.impulses.has(seconds))return this.impulses.get(seconds);
  const c=this.context,buffer=c.createBuffer(2,Math.ceil(c.sampleRate*seconds),c.sampleRate);let seed=173;
  for(let channel=0;channel<2;channel++){
   const data=buffer.getChannelData(channel);
   for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const t=i/c.sampleRate;data[i]=(seed/4294967296*2-1)*Math.exp(-6.9*t/seconds)*Math.min(1,t/.018);}
  }
  this.impulses.set(seconds,buffer);if(this.impulses.size>3)this.impulses.delete(this.impulses.keys().next().value);return buffer;
 }
 disposeReverb(r){
  if(!r)return;clearTimeout(r.timer);try{this.afterDrive.disconnect(r.node);}catch{}r.node.disconnect();r.gain.disconnect();
 }
 replaceReverb(seconds,crossfade=true){
  const c=this.context,old=this.reverb,node=c.createConvolver(),gain=c.createGain();node.buffer=this.impulse(seconds);gain.gain.value=crossfade?0:1;
  this.afterDrive.connect(node);node.connect(gain);gain.connect(this.reverbWet);this.reverb={node,gain};
  if(crossfade)move(gain.gain,1,c.currentTime);
  if(old){
   move(old.gain.gain,0,c.currentTime);this.retired.push(old);
   old.timer=setTimeout(()=>{this.disposeReverb(old);this.retired=this.retired.filter(r=>r!==old);},180);
   if(this.retired.length>2)this.disposeReverb(this.retired.shift());
  }
 }
 clear(){
  clearTimeout(this.reverbTimer);this.reverbTimer=null;
  this.afterDrive.disconnect();this.disposeReverb(this.reverb);this.reverb=null;
  for(const r of this.retired)this.disposeReverb(r);this.retired=[];
  if(this.chorus)for(const v of this.chorus){v.lfo.stop();v.lfo.disconnect();}
  if(this.nodes)for(const node of this.nodes)node.disconnect();
  const c=this.context;this.nodes=[];const keep=node=>{this.nodes.push(node);return node;};
  this.dry=keep(c.createGain());this.afterDrive.connect(this.dry);this.dry.connect(this.return);
  this.reverbWet=keep(c.createGain());this.reverbWet.gain.value=0;this.reverbWet.connect(this.return);this.replaceReverb(this.settings.reverbDecay,false);
  this.delayWet=keep(c.createGain());this.delayWet.gain.value=0;this.delayWet.connect(this.return);this.echo=[];
  for(let i=0;i<2;i++){
   const delay=keep(c.createDelay(1.5)),feedback=keep(c.createGain()),filter=keep(c.createBiquadFilter()),pan=keep(c.createStereoPanner());
   delay.delayTime.value=this.settings.delayTime;feedback.gain.value=this.settings.feedback;filter.type='lowpass';filter.frequency.value=2600;pan.pan.value=i? .8:-.8;
   delay.connect(pan);pan.connect(this.delayWet);delay.connect(filter);filter.connect(feedback);this.echo.push({delay,feedback,filter,pan});
  }
  this.afterDrive.connect(this.echo[0].delay);this.echo[0].feedback.connect(this.echo[1].delay);this.echo[1].feedback.connect(this.echo[0].delay);
  this.chorus=[];
  for(let i=0;i<2;i++){
   const delay=keep(c.createDelay(.06)),lfo=c.createOscillator(),depth=keep(c.createGain()),wet=keep(c.createGain()),pan=keep(c.createStereoPanner());
   wet.gain.value=0;delay.delayTime.value=i?.024:.018;depth.gain.value=.002;pan.pan.value=i?.85:-.85;
   this.afterDrive.connect(delay);delay.connect(wet);wet.connect(pan);pan.connect(this.return);lfo.connect(depth);depth.connect(delay.delayTime);lfo.start();this.chorus.push({delay,lfo,depth,wet,pan});
  }
  this.apply();
 }
 apply(){
  const s=this.settings,t=this.context.currentTime,on=s.fxBypass?0:1;
  move(this.clean.gain,1-on,t);move(this.feed.gain,on,t);move(this.return.gain,on,t);
  move(this.tone.frequency,350*Math.pow(16000/350,s.tone),t);
  move(this.driveClean.gain,1-s.drive,t);move(this.drivePre.gain,1+s.drive*12,t);move(this.makeup.gain,1/Math.sqrt(1+s.drive*12),t);move(this.driven.gain,s.drive,t);
  move(this.reverbWet.gain,s.space*.65,t);move(this.delayWet.gain,s.delay*.55,t);
  for(const v of this.echo){move(v.delay.delayTime,s.delayTime,t);move(v.feedback.gain,s.feedback,t);}
  this.chorus.forEach((v,i)=>{move(v.wet.gain,s.chorus*.28,t);move(v.lfo.frequency,s.chorusRate*(i?.83:1),t);move(v.depth.gain,.0005+s.chorus*.003,t);});
 }
 update(settings){
  const old=this.settings;this.settings=settings;
  // Comparing dry and wet never revives a previously stored echo.
  if(old.fxBypass!==settings.fxBypass){this.clear();return;}
  this.apply();
  if(old.reverbDecay!==settings.reverbDecay){
   clearTimeout(this.reverbTimer);
   this.reverbTimer=setTimeout(()=>{this.reverbTimer=null;this.replaceReverb(this.settings.reverbDecay);},90);
  }
 }
}
