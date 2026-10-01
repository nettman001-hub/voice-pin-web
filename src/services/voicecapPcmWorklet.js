// Runs on the audio rendering thread, independently of UI rendering/timers.
class VoicecapPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(4096);
    this.offset = 0;
  }

  process(inputs, outputs) {
    // Capture only: never play the shared tab/microphone back through the app.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let value = 0;
      for (const channel of channels) value += channel[frame] || 0;
      value = Math.max(-1, Math.min(1, value / channels.length));
      this.samples[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('voicecap-pcm', VoicecapPcmProcessor);
