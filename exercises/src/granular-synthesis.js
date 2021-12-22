import "core-js/stable";
import "regenerator-runtime/runtime";
import { html, render } from 'lit-html';
import { resumeAudioContext } from '@ircam/resume-audio-context';
import { Scheduler } from 'waves-masters';
import { AudioBufferLoader } from 'waves-loaders';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-button.js';

const audioContext = new AudioContext();

const globals = {
  buffer: null,
  synth: null,
  scheduler: null,
}

// [students] ----------------------------------------
class GranularEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;

    this.buffer = null;
    this.period = 0.02;
    this.duration = 0.1;

    this._position = 0;

    this._output = this.audioContext.createGain();
  }


  connect(output) {
    this._output.connect(output);
  }

//  set buffer(value) {
//    this.buffer = value;
//  }
//
//  get buffer() {
//    return this.buffer;
//  }

  set position(value) {
    // clamp to [0, buffer.duration - grain.duration]
    const maxPosition = this.buffer.duration - this.duration;
    const minPosition = 0;
    this._position = Math.max(minPosition, Math.min(maxPosition, value));
  }

  get position() {
    return this._position;
  }

  advanceTime(currentTime, audioTime, dt) {
    // add some jitter to avoid audible artifact due to period
    // <-----------------------------
    // code
    // ---------------------------->

    // fire and forget the grain
    const env = this.audioContext.createGain();
    env.connect(this._output);
    env.gain.value = 0;

    const src = this.audioContext.createBufferSource();
    src.buffer = this.buffer;
    src.connect(env);

    env.gain.setValueAtTime(0, currentTime);
    env.gain.linearRampToValueAtTime(1, currentTime + this.duration / 2);
    env.gain.linearRampToValueAtTime(0, currentTime + this.duration);

    src.start(currentTime, this.position);
    src.stop(currentTime + this.period);

    return currentTime + this.period;
  }
}

// ## Going further
// - explore https://webaudio.github.io/web-audio-api/#audiobuffersourcenode to
//   see which controls could be added the granular synth
// - implement some logic to be able to select between several sound files
// - see project :)

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // load audio file
  const loader = new AudioBufferLoader();
  const buffer = await loader.load('./assets/cherokee.wav');
  console.log(buffer);

  // create scheduler
  const getTimeFunction = () => audioContext.currentTime;
  const scheduler = new Scheduler(getTimeFunction);

  // create granular engine
  const synth = new GranularEngine(audioContext);
  synth.buffer = buffer;
  synth.connect(audioContext.destination);

  scheduler.add(synth)

  globals.buffer = buffer;
  globals.scheduler = scheduler;
  globals.synth = synth;
  // @see interface to see to interact w/ the synth and the scheduler
  renderGUI();
}());

// GUI
function renderGUI() {
  const $main = document.querySelector('.main');
  render(html`
    <div style="padding-bottom: 4px;">
      <sc-button
        value="start"
        @input="${e => globals.scheduler.add(globals.synth)}"
      ></sc-button>
      <sc-button
        value="stop"
        @input="${e => globals.scheduler.remove(globals.synth)}"
      ></sc-button>
    </div>
    <div style="padding-bottom: 4px;">
      <sc-text
        value="position"
        readonly
      ></sc-text>
      <sc-slider
        value="${globals.synth.position}"
        min="0"
        max="${globals.buffer.duration}"
        width="500"
        display-number
        @input="${e => globals.synth.position = e.detail.value}"
      ></sc-slider>
    </div>
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
  `, $main);
}

