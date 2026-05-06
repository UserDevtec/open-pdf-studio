import { createSignal } from 'solid-js';
import { openDialog, closeDialog } from './dialogStore.js';

const [releases, setReleasesSig] = createSignal([]);
const [activeLang, setActiveLangSig] = createSignal('en');
const [loading, setLoadingSig] = createSignal(false);
const [error, setErrorSig] = createSignal(null);

export function getReleases() { return releases(); }
export function getActiveLang() { return activeLang(); }
export function isLoading() { return loading(); }
export function getError() { return error(); }

export function setReleases(list) { setReleasesSig(list || []); }
export function setActiveLang(lang) { setActiveLangSig(lang === 'nl' ? 'nl' : 'en'); }
export function setLoading(v) { setLoadingSig(!!v); }
export function setError(e) { setErrorSig(e || null); }

/**
 * Open the dialog. If `data` contains releases / activeLang they override the
 * current store values. Triggered both automatically (after detecting a newer
 * version on startup) and manually (Help → "What's new").
 */
export function openWhatsNew(data = {}) {
  if (Array.isArray(data.releases)) setReleasesSig(data.releases);
  if (data.activeLang) setActiveLangSig(data.activeLang === 'nl' ? 'nl' : 'en');
  if (typeof data.loading === 'boolean') setLoadingSig(data.loading);
  if (data.error !== undefined) setErrorSig(data.error);
  openDialog('whats-new', data);
}

export function closeWhatsNew() {
  closeDialog('whats-new');
}
