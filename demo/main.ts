import { airHockey } from '../src/client';
import type { AirHockey } from '../src/client';
import { localSocket } from '../src/local';

const q = new URLSearchParams(location.search);
// ?goals=2&rounds=1 shortens local matches (the host tab's values win).
const rules = Object.fromEntries(
  ['goals', 'rounds'].filter(k => q.has(k)).map(k => [k, Number(q.get(k))]),
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const fields = form.elements as unknown as Record<'name' | 'mode' | 'url', HTMLInputElement>;
const status = $('status');
/** Shown while playing; the join form and the intro the rest of the time. */
const playing = (on: boolean) => {
  ['play', 'status', 'leave'].forEach(id => ($(id).hidden = !on));
  [form, $('intro')].forEach(el => (el.hidden = on));
};

let game: AirHockey | undefined;

const syncMode = () => {
  $('url').hidden = fields.mode.value != 'server';
};

const join = () => {
  const name = fields.name.value.trim();
  const server = fields.mode.value == 'server';
  const url = fields.url.value;
  game = airHockey($('game'), {
    name,
    ...(server ? { url } : { socket: localSocket('demo', rules) }),
  });
  status.textContent = server ? `Playing on ${url}` : 'Playing locally';
  game.on('close', () => (status.textContent = 'Disconnected'));
  playing(true);
};

const leave = () => {
  game?.destroy();
  game = undefined;
  playing(false);
};

fields.mode.addEventListener('change', syncMode);
form.addEventListener('submit', e => {
  e.preventDefault();
  join();
});
$('leave').addEventListener('click', leave);

// ?name=…&mode=local|server&url=… joins right away.
fields.name.value = q.get('name') ?? `Player ${Math.floor(Math.random() * 900) + 100}`;
fields.mode.value = q.get('mode') == 'server' ? 'server' : 'local';
fields.url.value = q.get('url') ?? fields.url.value;
syncMode();
if (q.has('name')) {
  join();
}
