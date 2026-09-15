class Recorder extends AudioWorkletProcessor {
 constructor(){super();this.recording=false;this.buffer=new Float32Array(8192);this.offset=0;this.port.onmessage=e=>{if(e.data==='start'){this.offset=0;this.recording=true}if(e.data==='stop'){this.recording=false;this.flush();this.port.postMessage('stopped')}}}
 flush(){if(this.offset){const b=this.buffer.slice(0,this.offset);this.port.postMessage(b,[b.buffer]);this.offset=0}}
 process(inputs,outputs){const input=inputs[0];const output=outputs[0];for(let c=0;c<output.length;c++)output[c].set(input[c]??input[0]??new Float32Array(128));if(this.recording){const frames=output[0]?.length??128;for(let i=0;i<frames;i++){this.buffer[this.offset++]=input[0]?.[i]??0;this.buffer[this.offset++]=input[1]?.[i]??input[0]?.[i]??0;if(this.offset===this.buffer.length)this.flush()}}return true}
}
registerProcessor('cue-recorder',Recorder);
