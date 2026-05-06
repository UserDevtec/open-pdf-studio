import { createSignal, createMemo, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  getReleases, getActiveLang, setActiveLang,
  isLoading, getError, closeWhatsNew
} from '../../stores/whatsNewStore.js';
import { parseBilingualBody, renderMarkdown } from '../../../help/release-notes.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { getAppVersion } from '../../../core/platform.js';

export default function WhatsNewDialog() {
  const { t } = useTranslation('appMenu');
  const [dontShow, setDontShow] = createSignal(true);

  const parsed = createMemo(() => {
    return getReleases().map(r => ({
      ...r,
      sections: parseBilingualBody(r.bodyMarkdown)
    }));
  });

  const close = async () => {
    if (dontShow()) {
      try {
        const v = await getAppVersion();
        if (v) {
          state.preferences.lastSeenReleaseVersion = v;
          savePreferences();
        }
      } catch {
        /* ignore */
      }
    }
    closeWhatsNew();
  };

  const langTab = (lang, label) => (
    <button
      type="button"
      class={`wn-tab ${getActiveLang() === lang ? 'active' : ''}`}
      onClick={() => setActiveLang(lang)}
    >
      {label}
    </button>
  );

  const footer = (
    <>
      <label class="wn-dont-show">
        <input
          type="checkbox"
          checked={dontShow()}
          onChange={(e) => setDontShow(e.currentTarget.checked)}
        />
        {t('whatsNew.dontShowAgain')}
      </label>
      <button type="button" class="wn-close-btn" onClick={close}>
        {t('whatsNew.close')}
      </button>
    </>
  );

  return (
    <Dialog
      title={t('whatsNew.title')}
      dialogClass="whats-new-dialog"
      onClose={close}
      footer={footer}
      footerClass="whats-new-footer"
      bodyClass="whats-new-body"
    >
      <div class="wn-tabs">
        {langTab('nl', t('whatsNew.tabNl'))}
        {langTab('en', t('whatsNew.tabEn'))}
      </div>
      <div class="wn-content">
        <Show when={isLoading()}>
          <p class="wn-loading">{t('whatsNew.loading')}</p>
        </Show>
        <Show when={!isLoading() && getError()}>
          <p class="wn-error">{t('whatsNew.error')}</p>
        </Show>
        <Show when={!isLoading() && !getError() && parsed().length === 0}>
          <p class="wn-empty">{t('whatsNew.empty')}</p>
        </Show>
        <For each={parsed()}>
          {(rel) => {
            const lang = () => getActiveLang();
            const body = () => {
              const s = rel.sections;
              if (lang() === 'nl') return s.nl || s.en || '';
              return s.en || s.nl || '';
            };
            const date = () => {
              try { return new Date(rel.publishedAt).toLocaleDateString(); }
              catch { return ''; }
            };
            return (
              <article class="wn-release">
                <header class="wn-release-header">
                  <span class="wn-release-tag">{rel.tag}</span>
                  <span class="wn-release-date">{date()}</span>
                </header>
                <div class="wn-release-body" innerHTML={renderMarkdown(body())} />
              </article>
            );
          }}
        </For>
      </div>
    </Dialog>
  );
}
