import SignalsmithStretch from 'signalsmith-stretch';
export const frequencies=[60,170,350,1000,3500,10000];
export const neutral=()=>({tempo:1,pitch:0,eq:null});
export class AudioEngine {
  constructor(){this.duration=0;this.position=0;this._volume=.8;this.effects=neutral();this.globalEq=frequencies.map(()=>0);this.generation=0;this.paused=true;}
  async init(){
    if(this.ready)return this.ready;
    this.context=new AudioContext({latencyHint:'playback'});
    this.ready=(async()=>{
      this.node=await SignalsmithStretch(this.context,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      this.filters=frequencies.map((f,i)=>{const n=this.context.createBiquadFilter();n.type=i===0?'lowshelf':i===5?'highshelf':'peaking';n.frequency.value=f;n.Q.value=.8;return n});
      this.preamp=this.context.createGain();this.output=this.context.createGain();
      this.node.connect(this.preamp);let last=this.preamp;for(const filter of this.filters){last.connect(filter);last=filter}last.connect(this.output);this.output.connect(this.context.destination);
      this.node.setUpdateInterval(.04,()=>{if(this.paused)return;this.position=Math.max(0,this.node.inputTime);this.onTime?.();if(this.position>=this.duration&&this.duration){this.pause();this.onEnded?.()}});
      this.apply();
    })();return this.ready;
  }
  load(){this.generation++;this.pending=true;this.pause();this.position=0;}
  async play(){
    await this.init();await this.context.resume();
    if(this.pending){const generation=this.generation,src=this.src;this.pending=false;
      const response=await fetch(src);if(!response.ok)throw Error('Could not download audio');
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      if(generation!==this.generation)return;
      await this.node.dropBuffers();
      const left=buffer.getChannelData(0),right=buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1));
      await this.node.addBuffers([left,right]);this.duration=buffer.duration;this.onMetadata?.();
    }
    this.apply();this.node.schedule({active:true,input:this.position});this.paused=false;
  }
  pause(){this.paused=true;this.node?.stop();}
  get currentTime(){return this.position}
  set currentTime(v){this.position=Math.max(0,Math.min(this.duration,v));this.node?.schedule({input:this.position,active:!this.paused});this.onTime?.()}
  set volume(v){this._volume=v;if(this.output)this.output.gain.setTargetAtTime(v,this.context.currentTime,.015)}
  get volume(){return this._volume}
  removeAttribute(){this.load();this.src='';this.duration=0;this.node?.dropBuffers()}
  setEffects(e,g){this.effects=e;this.globalEq=g;this.apply()}
  apply(){if(!this.node)return;const eq=this.effects.eq??this.globalEq;this.node.schedule({rate:this.effects.tempo,semitones:this.effects.pitch,formantCompensation:true});
    const now=this.context.currentTime;this.filters.forEach((f,i)=>f.gain.setTargetAtTime(eq[i]||0,now,.025));
    // Conservative headroom for additive boosts prevents EQ-induced clipping.
    const boost=eq.reduce((sum,g)=>sum+Math.max(0,g),0);this.preamp.gain.setTargetAtTime(10**(-boost/20),now,.025);this.volume=this._volume;
  }
  dispose(){this.pause();this.context?.close()}
}
