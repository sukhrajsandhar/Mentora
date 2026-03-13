// audio-processor.js — AudioWorkletProcessor to replace ScriptProcessorNode
// Must be served as a separate file from the same origin as the app.
// Loaded via: micCtx.audioWorklet.addModule('./audio-processor.js')

class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._chunkSize = options?.processorOptions?.chunkSize ?? 2048;
    this._buffer    = new Float32Array(this._chunkSize);
    this._filled    = 0;
  }

  process(inputs) {
    const input   = inputs[0];
    const channel = input?.[0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const remaining = this._chunkSize - this._filled;
      const toCopy    = Math.min(remaining, channel.length - offset);
      this._buffer.set(channel.subarray(offset, offset + toCopy), this._filled);
      this._filled += toCopy;
      offset       += toCopy;

      if (this._filled >= this._chunkSize) {
        // Send a copy — don't transfer the buffer since we reuse it
        this.port.postMessage({ samples: this._buffer.slice() });
        this._filled = 0;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('mic-processor', MicProcessor);
