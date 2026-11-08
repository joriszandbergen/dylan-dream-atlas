"""Prepare the four supplied recordings. Usage: python3 scripts/prepare-audio.py /path/to/source-folder"""
from pathlib import Path
import sys, subprocess, json, wave
import numpy as np
folder=Path(sys.argv[1]);dest=Path(__file__).resolve().parents[1]/'dist/assets/audio';dest.mkdir(parents=True,exist_ok=True);sr=44100
specs=[('audio-2','Audio 2 [2026-10-31 142421].wav','chords',340,360,.15,.55,.2,.64),('audio-4','Audio 4 [2026-10-31 143321].wav','bass',54,64,.02,.3,.06,.42),('audio-9','Audio 9 [2026-10-31 143430].wav','melody',190,205,.04,.3,.08,.5),('audio-19','Audio 19 [2026-10-31 143352].wav','accents',380,405,.02,.25,.08,.45)]
records=[]
def save(name,data):
 with wave.open(str(dest/name),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
for identity,filename,role,low,high,pitch_start,pitch_end,loop_start,loop_end in specs:
 a=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(folder/filename),'-f','f32le','-ac','2','-ar',str(sr),'pipe:1']),dtype=np.float32).reshape(-1,2).copy();a-=a.mean(axis=0);a*=min(1.5,.88/np.max(np.abs(a)))
 x=a[int(pitch_start*sr):int(pitch_end*sr)].mean(axis=1);n=262144;spectrum=np.abs(np.fft.rfft(x*np.hanning(len(x)),n));freq=np.fft.rfftfreq(n,1/sr);candidates=np.where((freq>low)&(freq<high))[0];peak=candidates[np.argmax(spectrum[candidates])];logs=np.log(np.maximum(spectrum[peak-1:peak+2],1e-12));delta=.5*(logs[0]-logs[2])/(logs[0]-2*logs[1]+logs[2]);pitch=(peak+delta)*sr/n
 period=sr/pitch;length=round(np.floor((loop_end-loop_start)*sr/period)*period);overlap=round(max(2,np.floor(length/period*.1))*period);chunk=a[round(loop_start*sr):round(loop_start*sr)+length];u=np.arange(overlap)[:,None]/overlap;fade=.5-.5*np.cos(np.pi*u);loop=np.concatenate([chunk[overlap:-overlap],chunk[-overlap:]*(1-fade)+chunk[:overlap]*fade]);loop*=min(2,.82/np.max(np.abs(loop)))
 fade_n=220;a[:fade_n]*=np.linspace(0,1,fade_n)[:,None];a[-fade_n:]*=np.linspace(1,0,fade_n)[:,None]
 save(identity+'.wav',a);save(identity+'-sustain.wav',loop)
 records.append({'id':identity,'name':identity.replace('-',' '),'role':role,'duration':round(len(a)/sr,5),'rootHz':round(float(pitch),4),'sample':'./assets/audio/'+identity+'.wav','sustain':'./assets/audio/'+identity+'-sustain.wav','sampleOffset':.008 if role=='bass' else .015,'loopSeconds':len(loop)/sr})
(dest/'source.json').write_text(json.dumps(records,indent=2)+'\n')
(dest.parents[1]/'audio-source.js').write_text('// Prepared from the four recordings supplied for this prototype.\nexport const RECORDINGS='+json.dumps(records,separators=(',',':'))+';\nexport const RECORDING=RECORDINGS[0];\n')
print(json.dumps([{k:r[k] for k in ['id','role','duration','rootHz']} for r in records],indent=2))
