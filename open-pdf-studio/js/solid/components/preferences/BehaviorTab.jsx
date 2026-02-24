import { useTranslation } from '../../../i18n/useTranslation.js';

export default function BehaviorTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('behavior.startup')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.restoreLastSession[0]()} onChange={e => p.restoreLastSession[1](e.target.checked)} />
            <span>{t('behavior.restoreLastSession')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.author')}</legend>
        <div class="pref-row">
          <label>{t('behavior.defaultAuthorName')}</label>
          <input type="text" value={p.authorName[0]()} onInput={e => p.authorName[1](e.target.value)} />
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.snapping')}</legend>
        <div class="pref-row">
          <label>{t('behavior.angleSnap')}</label>
          <input type="number" min="1" max="90" value={p.angleSnapDegrees[0]()} onInput={e => p.angleSnapDegrees[1](parseInt(e.target.value) || 30)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableAngleSnap[0]()} onChange={e => p.enableAngleSnap[1](e.target.checked)} />
            <span>{t('behavior.enableAngleSnapping')}</span>
          </label>
        </div>
        <div class="pref-row">
          <label>{t('behavior.gridSize')}</label>
          <input type="number" min="5" max="100" value={p.gridSize[0]()} onInput={e => p.gridSize[1](parseInt(e.target.value) || 10)} />
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.enableGridSnap[0]()} onChange={e => p.enableGridSnap[1](e.target.checked)} />
            <span>{t('behavior.enableGridSnapping')}</span>
          </label>
        </div>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.showGrid[0]()} onChange={e => p.showGrid[1](e.target.checked)} />
            <span>{t('behavior.showGridOverlay')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.creation')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.autoSelectAfterCreate[0]()} onChange={e => p.autoSelectAfterCreate[1](e.target.checked)} />
            <span>{t('behavior.autoSelectAfterCreation')}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('behavior.deletion')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.confirmBeforeDelete[0]()} onChange={e => p.confirmBeforeDelete[1](e.target.checked)} />
            <span>{t('behavior.confirmBeforeDeleting')}</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
