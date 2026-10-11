import { get, put } from './api.js';

const listeners = new Set();

export const store = {
  profile: null,
  summary: null,
  coach: { enabled: false },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

export function settings() {
  return store.profile?.settings || {};
}

export function applyTheme() {
  const s = settings();
  document.documentElement.dataset.theme = s.theme || 'premium';
  document.body.classList.toggle('four-color', !!s.fourColor);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = s.theme === 'light' ? '#f3f1ea' : '#0a0f1c';
}

export async function loadProfile() {
  try {
    store.profile = await get('/me');
  } catch {
    store.profile = null;
  }
  applyTheme();
  emit();
  return store.profile;
}

export async function saveSettings(patch) {
  const s = await put('/me/settings', patch);
  store.profile.settings = s;
  applyTheme();
  emit();
  return s;
}

export async function refreshSummary() {
  if (!store.profile) return null;
  try {
    store.summary = await get('/me/summary');
    store.profile = store.summary.profile;
    emit();
  } catch {
    /* brak połączenia — zostaw stary stan */
  }
  return store.summary;
}

export function updateProgress(payload) {
  if (!payload || !store.summary) return;
  if (payload.level) store.summary.level = payload.level;
  if (payload.virtualBankroll != null) store.summary.virtualBankroll = payload.virtualBankroll;
  emit();
}
