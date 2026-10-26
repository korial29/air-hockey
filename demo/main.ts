import { airHockey } from '../src/client';
import type { AirHockey } from '../src/client';
import { localSocket } from '../src/local';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const fields = form.elements as unknown as Record<'name' | 'mode' | 'url', HTMLInputElement>;
const play = $('play');
const status = $('status');

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
    ...(server ? { url } : { socket: localSocket('demo') }),
  });
  status.textContent = server ? `Playing on ${url}` : 'Playing locally';
  game.on('close', () => (status.textContent = 'Disconnected'));
  form.hidden = true;
  play.hidden = false;
};

const leave = () => {
  game?.destroy();
  game = undefined;
  play.hidden = true;
  form.hidden = false;
};

fields.mode.addEventListener('change', syncMode);
form.addEventListener('submit', e => {
  e.preventDefault();
  join();
});
$('leave').addEventListener('click', leave);

// ?name=…&mode=local|server&url=… joins right away.
const q = new URLSearchParams(location.search);
fields.name.value = q.get('name') ?? `Player ${Math.floor(Math.random() * 900) + 100}`;
fields.mode.value = q.get('mode') == 'server' ? 'server' : 'local';
fields.url.value = q.get('url') ?? fields.url.value;
syncMode();
if (q.has('name')) {
  join();
}
