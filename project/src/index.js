import "core-js/stable";
import "regenerator-runtime/runtime";
import { html, render } from 'lit-html';
import { resumeAudioContext } from '@ircam/resume-audio-context';
import { Scheduler } from 'waves-masters';
import { AudioBufferLoader } from 'waves-loaders';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-button.js';
// import '@ircam/simple-components/sc-surface.js';
import '@ircam/simple-components/sc-dot-map.js';

const audioContext = new AudioContext();
// const audioFile = './assets/ligeti-artikulation.wav';
// const audioFile = './assets/drum-loop.wav';
const audioFile = './assets/hendrix.wav';
// const audioFile = './assets/cherokee.wav';

const globals = {
  buffer: null,
  synth: null,
  scheduler: null,
  guiPosition: { x: null, y: null }, // normalized position in the interface
}

const data = {
  times: [],
  rms: [], // list of RMS values for each block
  zeroCrossing: [],
  // we need normalized values for the interface and search
  normX: [], // list of normalized values according to one of the analysis
  normY: [], // list of normalized values according to another analysis
}

const BLOCK_SIZE = 2048;
const HOP_SIZE = 512;

// returns an Array of the blocks start times from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in samples)
// @param {Number} hopSize - Size of hop between two consecutive blocks (in samples)
// @return {Array}
function getTimes(channelData, sampleRate, blockSize, hopSize) {
  const times = [];
  const dataLen = channelData.length;
  for (let start=0 ; start<dataLen ; start += hopSize){
    const end = start + blockSize;
    if (end <= dataLen){
      const time = start/sampleRate;
      times.push(time);
    }
  }
  return times;
}

// returns an Array of RMS values from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in samples)
// @param {Number} hopSize - Size of hop between two consecutive blocks (in samples)
// @return {Array}
function rms(channelData, sampleRate, blockSize, hopSize) {
  const rms_array = [];
  const dataLen = channelData.length;
  // let's define a function for computing array average
  // (taken from stackoverflow)
  const average = arr => arr.reduce( (p, c) => p + c, 0)/arr.length;
  for (let start=0 ; start < dataLen ; start += hopSize){
    const end = start + blockSize;
    if (end <= dataLen){
      const block = channelData.slice(start, end);
      const block_squared = block.map(x => x**2);
      let block_rms = average(block_squared);
      block_rms = Math.sqrt(block_rms);
      rms_array.push(block_rms);
    }
  }
  return rms_array;
}

// returns an estimation of the pitch / noisiness (in Hz) using zero-crossing
// from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in samples)
// @param {Number} hopSize - Size of hop between two consecutive blocks (in samples)
// @return {Array}
function zeroCrossing(channelData, sampleRate, blockSize, hopSize) {
  const zcr_array = [];
  const dataLen = channelData.length;
  for (let start=0 ; start < dataLen ; start += hopSize){
    const end = start + blockSize;
    if (end <= dataLen) {
      const block = channelData.slice(start, end);
      // initialize zero-crossing counter
      let block_zc_cnt = 0;
      // variable to store previous value's sign
      let was_positive = (block[0] > 0);
      for (let i=1 ; i < blockSize ; i += 1){
        // iterate over block and count zero crossings
        if ((block[i] < 0) && (was_positive)) {
          was_positive = false;
          block_zc_cnt += 1;
        }
        else if ((block[i] > 0) && !(was_positive)){
          was_positive = true;
          block_zc_cnt += 1;
        }
      }
      const block_zcr = (block_zc_cnt / (blockSize - 1)) * sampleRate;
      zcr_array.push(block_zcr);
    }
  }
  return zcr_array;
}

// normalize given `data` array according to its min and max
// @param {Array} data - Array of the data to normalize
// @return {Array}
function normalize(data) {
  // get maximum and minimum values
  const max = Math.max(...data);
  const min = Math.min(...data);
  // substract min so that data begins at 0
  let result = data.map( x => x - min);
  // divide by max so that range is [0, 1]
  result = result.map( x => x / max);
  return result;
}

// find the time of the closest match in data according to current mouse position
// on the interface, using euclidian distance.
// @param {Object} guiPosition - current position in the interface
// @param {Object} data - global data object containing the times and descriptors
function findStartTimeFromGuiPosition(guiPosition, data) {
  // compute distance arrays for x and y
  const dist_x = data.normX.map( x => x - guiPosition.x);
  const dist_y = data.normY.map( y => y - guiPosition.y);
  const dist_x_squared = dist_x.map( x => x**2);
  const dist_y_squared = dist_y.map( x => x**2);
  // compute euclidean distance d = sqrt(dx**2 + dy**2)
  const dist = [];
  for (let i=0 ; i<dist_x.length ; i+=1){
    const tmp = Math.sqrt(dist_x_squared[i] + dist_y_squared);
    dist.push(tmp);
  }
  // find which point is the closest
  const closest_match_idx = dist.indexOf(Math.min(...dist));
  return data.times[closest_match_idx];
}

// [students] ----------------------------------------
class ConcatEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;

    this._buffer = null;
    this.period = 0.05; // period of the grains
    this.duration = 0.2; // duration of the grains

    //this.position = 0;
    this.output = audioContext.createGain();
  }

  connect(output) {
    this.output.connect(output);
  }

  set buffer(value) {
    this._buffer = value;
  }

  get buffer() {
    return this._buffer;
  }

//  set position(value) {
//    const maxPosition = this.buffer.duration - this.duration;
//    const minPosition = 0;
//    this.position = Math.max(minPosition, Math.min(maxPosition, value));
//  }
//
//  get position() {
//    return this.position;
//  }

  advanceTime(currentTime, audioTime, dt) {
    // get time corresponding to guiposition
    //console.log(globals.guiPosition);
    const startTime = findStartTimeFromGuiPosition(globals.guiPosition, data);
    // jitter?
    
    // fire and forget the grain
    const env = this.audioContext.createGain();
    env.connect(this.output);
    env.gain.value = 0;

    const src = this.audioContext.createBufferSource();
    src.buffer = this.buffer;
    src.connect(env);

    // // Create enveloppe
    env.gain.setValueAtTime(0, audioTime);
    env.gain.linearRampToValueAtTime(1, audioTime + this.duration / 2);
    env.gain.linearRampToValueAtTime(0, audioTime + this.duration);

    // // play grain
    src.start(audioTime, startTime);
    src.stop(audioTime + this.period);

    // // return end time
    return currentTime + this.period;

  }
}

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // [students] ----------------------------------------
  // 1. load audio file
  const loader = new AudioBufferLoader();
  const buffer = await loader.load(audioFile);
  // 2. perform analysis and store results in `data`
  const rate = buffer.sampleRate;
  const channelData = buffer.getChannelData(0)
  data.times = getTimes(channelData, rate, BLOCK_SIZE, HOP_SIZE); 
  data.rms = rms(channelData, rate, BLOCK_SIZE, HOP_SIZE);
  data.zeroCrossing = zeroCrossing(channelData, rate, BLOCK_SIZE, HOP_SIZE);
  // 3. compute normalized analysis for GUI and search
  data.normX = normalize(data.zeroCrossing);
  data.normY = normalize(data.rms);

  // 4. create scheduler
  const getTimeFunction = () => audioContext.currentTime;
  const scheduler = new Scheduler(getTimeFunction);

  // 5. create concat engine
  const synth = new ConcatEngine(audioContext);
  synth.buffer = buffer;
  synth.connect(audioContext.destination);

  // 6. add engine to scheduler
  scheduler.add(synth);

  globals.buffer = buffer;
  globals.scheduler = scheduler;
  globals.synth = synth;
  // @see interface to see to interact w/ the synth and the scheduler
  renderGUI();
}());

// GUI
function renderGUI() {
  const $main = document.querySelector('.main');
  const dots = [];
  for (let i = 0; i < data.normX.length; i++) {
    const dot = { x: data.normX[i], y: data.normY[i] }
    dots.push(dot);
  }

  render(html`
    <div style="padding-bottom: 4px;">
      <sc-text
        value="period"
        readonly
      ></sc-text>
      <sc-slider
        value="${globals.synth.period}"
        min="0.01"
        max="0.2"
        width="500"
        display-number
        @input="${e => globals.synth.period = e.detail.value}"
      ></sc-slider>
    </div>
    <div style="padding-bottom: 4px;">
      <sc-text
        value="duration"
        readonly
      ></sc-text>
      <sc-slider
        value="${globals.synth.duration}"
        min="0"
        max="1"
        width="500"
        display-number
        @input="${e => globals.synth.duration = e.detail.value}"
      ></sc-slider>
    </div>
    <!-- insert new sliders there -->

    <div style="position: absolute">
      <sc-dot-map
        style="position: absolute; top: 0; left: 0"
        width="500"
        height="500"
        color="white"
        radius="2"
        y-range="[1, 0]"
        value="${JSON.stringify(dots)}"
      ></sc-dot-map>
      <sc-dot-map
        style="position: absolute; top: 0; left: 0"
        width="500"
        height="500"
        background-color="transparent"
        y-range="[1, 0]"
        capture-events
        @input="${e => {
          if (e.detail.value.length) {
            globals.guiPosition.x = e.detail.value[0].x;
            globals.guiPosition.y = e.detail.value[0].y;
          } else {
            globals.guiPosition.x = null;
            globals.guiPosition.y = null;
          }
        }}"
      ></sc-dot-map>
    </div>
  `, $main);
}

