import "core-js/stable";
import "regenerator-runtime/runtime";
import { html, render } from 'lit-html';
import { resumeAudioContext } from '@ircam/resume-audio-context';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-number.js';
import '@ircam/simple-components/sc-bang.js';

const audioContext = new AudioContext();

// a priority queue is a list where each element has a "priority" associated
// with it and, that garantees that the order of the elements is binded
// to this priority. (cf. https://en.wikipedia.org/wiki/Priority_queue)
class DumbPriorityQueue {
  constructor() {
    this.engines = [];
  }

  add(engine, time) {
    engine.time = time;
    this.engines.push(engine);
  }

  head() {
    this.engines.sort((a, b) => a.time <= b.time ? -1 : 1);

    if (this.engines.length) {
      const engine = this.engines[0];
      return engine;
    } else {
      return null;
    }
  }

  deleteHead() {
    this.engines.shift();
  }
}

// [students] ----------------------------
const period = 0.05; // seconds
const lookahead = 0.1; // seconds
const queue = new DumbPriorityQueue();

function tick() {
  const now = audioContext.currentTime;
  let engine = queue.head();

  // if the scheduled time of the event is in the time frame defined by the lookahead
  while (engine && engine.time < now + lookahead) {
    // the event will be processed, so we can delete it from the queue
    queue.deleteHead();
    // call the `advanceTime` method of the engine
    const time = engine.time;
    const dt = time - now; // delta time between the actual call of the engine and current time
    const nextTime = engine.advanceTime(time, dt);
    // if the engine retrieve a time at which it wants to be scheduled next, we add it to the queue
    if (nextTime) {
      queue.add(engine, nextTime);
    }
    // get next event in the queue (this may be the event we just added)
    // and jump to the beginning of the while loop
    engine = queue.head();
  }

  // call back `tick` in period
  setTimeout(tick, period * 1000);
}

function playMetroSound(time) {
  const env = audioContext.createGain();
  env.connect(audioContext.destination);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(1, time + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  const src = audioContext.createOscillator();
  src.frequency.value = 600;
  src.connect(env);
  
  src.start(time);
  src.stop(time + 0.05);
}
const metro = {
  guiElement : null,
  period : 1,
  advanceTime(currentTime, dt) {
    if (!this.guiElement){
      this.guiElement = document.querySelector('.metro');
    };
    if (this.guiElement) {
      setTimeout(() => {
        this.guiElement.active = true
      }, dt * 1000);
    };
    playMetroSound(currentTime);
    return currentTime + this.period;
  }
};

// ## Going further
// - write a proper `Scheduler` class
// - allow removing engines
// - implement a step sequencer (cf. playing audio buffer)
// - wrap the metronome into a proper class
// - play different sound for 1rst beat in 4/4, etc.

// ![students] -------------------------)

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // launch scheduler
  tick();
  // add our metro engine to the queue
  queue.add(metro, Math.ceil(audioContext.currentTime));

  //const now = audioContext.currentTime;
  //console.log(now);
  //for (let t=0; t<16; t++) {
  //  playMetroSound(now + t/2);
  //};

  renderGUI();
}());

// GUI
function renderGUI() {
  const $main = document.querySelector('.main');
  render(html`
    <div style="padding-bottom: 4px;">
      <sc-bang class="metro"></sc-bang>
    </div>
    <div>
      <sc-text
        width="100"
        value="period (sec)"
        readonly
      ></sc-text>
      <sc-number
        min="0.001"
        max="3"
        value="${metro.period}"
        @input="${e => metro.period = e.detail.value}"
      ></sc-number>
    </div>
  `, $main);
}

