import { createSignal, Switch, Match, For } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';
import PrefComboBox from './PrefComboBox.jsx';

const SUB_TABS = [
  { id: 'general', key: 'annotations.subtabGeneral' },
  { id: 'comments', key: 'annotations.subtabComments' },
  { id: 'text', key: 'annotations.subtabText' },
  { id: 'drawing', key: 'annotations.subtabDrawing' },
  { id: 'shapes', key: 'annotations.subtabShapes' },
];

export default function AnnotationsTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const p = props.prefs;
  const [subTab, setSubTab] = createSignal('general');

  return (
    <div class="pref-subtab-wrapper">
      <div class="pref-subtabs">
        <For each={SUB_TABS}>
          {(tab) => (
            <button
              class="pref-subtab"
              classList={{ active: subTab() === tab.id }}
              onClick={() => setSubTab(tab.id)}
            >
              {t(tab.key)}
            </button>
          )}
        </For>
      </div>

      <div class="pref-subtab-content">
        <Switch>
          <Match when={subTab() === 'general'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.generalDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.defaultAnnotationColor')}</label>
                <PrefColorPicker value={p.defaultAnnotationColor[0]} setValue={p.defaultAnnotationColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.defaultLineWidth')}</label>
                <PrefComboBox value={p.defaultLineWidth[0]} setValue={p.defaultLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.defaultFontSize')}</label>
                <PrefComboBox value={p.defaultFontSize[0]} setValue={p.defaultFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={16} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.highlightOpacity')}</label>
                <PrefComboBox value={p.highlightOpacity[0]} setValue={p.highlightOpacity[1]} min={10} max={100} fallback={50} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.angleSnap')}</label>
                <PrefComboBox value={p.angleSnapDegrees[0]} setValue={p.angleSnapDegrees[1]} options={[10,15,20,30,45]} min={1} max={90} fallback={30} suffix="°" />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.highlightDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.color')}</label>
                <PrefColorPicker value={p.highlightColor[0]} setValue={p.highlightColor[1]} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'comments'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.commentNoteDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.color')}</label>
                <PrefColorPicker value={p.commentColor[0]} setValue={p.commentColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.icon')}</label>
                <select value={p.commentIcon[0]()} onChange={e => p.commentIcon[1](e.target.value)}>
                  <option value="comment">{t('annotations.iconComment')}</option>
                  <option value="key">{t('annotations.iconKey')}</option>
                  <option value="note">{t('annotations.iconNote')}</option>
                  <option value="help">{t('annotations.iconHelp')}</option>
                  <option value="newParagraph">{t('annotations.iconNewParagraph')}</option>
                  <option value="paragraph">{t('annotations.iconParagraph')}</option>
                  <option value="insert">{t('annotations.iconInsert')}</option>
                </select>
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'text'}>
            <fieldset class="pref-fieldset">
              <legend>{t('annotations.textBoxDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.fillColor')}</label>
                <PrefColorPicker value={p.textboxFillColor[0]} setValue={p.textboxFillColor[1]} noneChecked={p.textboxFillNone[0]} setNoneChecked={p.textboxFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.strokeColor')}</label>
                <PrefColorPicker value={p.textboxStrokeColor[0]} setValue={p.textboxStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderWidth')}</label>
                <PrefComboBox value={p.textboxBorderWidth[0]} setValue={p.textboxBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0} max={20} fallback={1} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderStyle')}</label>
                <select value={p.textboxBorderStyle[0]()} onChange={e => p.textboxBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('annotations.opacity')}</label>
                <PrefComboBox value={p.textboxOpacity[0]} setValue={p.textboxOpacity[1]} min={10} max={100} fallback={100} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.fontSize')}</label>
                <PrefComboBox value={p.textboxFontSize[0]} setValue={p.textboxFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={14} suffix="pt" />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('annotations.calloutDefaults')}</legend>
              <div class="pref-row">
                <label>{t('annotations.fillColor')}</label>
                <PrefColorPicker value={p.calloutFillColor[0]} setValue={p.calloutFillColor[1]} noneChecked={p.calloutFillNone[0]} setNoneChecked={p.calloutFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.strokeColor')}</label>
                <PrefColorPicker value={p.calloutStrokeColor[0]} setValue={p.calloutStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderWidth')}</label>
                <PrefComboBox value={p.calloutBorderWidth[0]} setValue={p.calloutBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0} max={20} fallback={1} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('annotations.borderStyle')}</label>
                <select value={p.calloutBorderStyle[0]()} onChange={e => p.calloutBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('annotations.opacity')}</label>
                <PrefComboBox value={p.calloutOpacity[0]} setValue={p.calloutOpacity[1]} min={10} max={100} fallback={100} />
              </div>
              <div class="pref-row">
                <label>{t('annotations.fontSize')}</label>
                <PrefComboBox value={p.calloutFontSize[0]} setValue={p.calloutFontSize[1]} options={[7,8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72]} min={1} max={200} fallback={14} suffix="pt" />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'drawing'}>
            <fieldset class="pref-fieldset">
              <legend>{t('drawing.freehandDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.drawStrokeColor[0]} setValue={p.drawStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.drawLineWidth[0]} setValue={p.drawLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.drawOpacity[0]} setValue={p.drawOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.lineDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.lineStrokeColor[0]} setValue={p.lineStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.lineLineWidth[0]} setValue={p.lineLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.borderStyle')}</label>
                <select value={p.lineBorderStyle[0]()} onChange={e => p.lineBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.lineOpacity[0]} setValue={p.lineOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.arrowDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.arrowStrokeColor[0]} setValue={p.arrowStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.fillColor')}</label>
                <PrefColorPicker value={p.arrowFillColor[0]} setValue={p.arrowFillColor[1]} noneChecked={p.arrowFillNone[0]} setNoneChecked={p.arrowFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.arrowLineWidth[0]} setValue={p.arrowLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.borderStyle')}</label>
                <select value={p.arrowBorderStyle[0]()} onChange={e => p.arrowBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('drawing.startHead')}</label>
                <select value={p.arrowStartHead[0]()} onChange={e => p.arrowStartHead[1](e.target.value)}>
                  <option value="none">{tCommon('none')}</option>
                  <option value="open">{t('drawing.headOpen')}</option>
                  <option value="closed">{t('drawing.headClosed')}</option>
                  <option value="diamond">{t('drawing.headDiamond')}</option>
                  <option value="circle">{t('drawing.headCircle')}</option>
                  <option value="square">{t('drawing.headSquare')}</option>
                  <option value="slash">{t('drawing.headSlash')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('drawing.endHead')}</label>
                <select value={p.arrowEndHead[0]()} onChange={e => p.arrowEndHead[1](e.target.value)}>
                  <option value="none">{tCommon('none')}</option>
                  <option value="open">{t('drawing.headOpen')}</option>
                  <option value="closed">{t('drawing.headClosed')}</option>
                  <option value="diamond">{t('drawing.headDiamond')}</option>
                  <option value="circle">{t('drawing.headCircle')}</option>
                  <option value="square">{t('drawing.headSquare')}</option>
                  <option value="slash">{t('drawing.headSlash')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('drawing.headSize')}</label>
                <input type="number" min="4" max="40" value={p.arrowHeadSize[0]()} onInput={e => p.arrowHeadSize[1](parseInt(e.target.value) || 12)} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.arrowOpacity[0]} setValue={p.arrowOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('drawing.polylineDefaults')}</legend>
              <div class="pref-row">
                <label>{t('drawing.strokeColor')}</label>
                <PrefColorPicker value={p.polylineStrokeColor[0]} setValue={p.polylineStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('drawing.lineWidth')}</label>
                <PrefComboBox value={p.polylineLineWidth[0]} setValue={p.polylineLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('drawing.opacity')}</label>
                <PrefComboBox value={p.polylineOpacity[0]} setValue={p.polylineOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>
          </Match>

          <Match when={subTab() === 'shapes'}>
            <fieldset class="pref-fieldset">
              <legend>{t('shapes.rectangleDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.fillColor')}</label>
                <PrefColorPicker value={p.rectFillColor[0]} setValue={p.rectFillColor[1]} noneChecked={p.rectFillNone[0]} setNoneChecked={p.rectFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.rectStrokeColor[0]} setValue={p.rectStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderWidth')}</label>
                <PrefComboBox value={p.rectBorderWidth[0]} setValue={p.rectBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderStyle')}</label>
                <select value={p.rectBorderStyle[0]()} onChange={e => p.rectBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.rectOpacity[0]} setValue={p.rectOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.ellipseDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.fillColor')}</label>
                <PrefColorPicker value={p.circleFillColor[0]} setValue={p.circleFillColor[1]} noneChecked={p.circleFillNone[0]} setNoneChecked={p.circleFillNone[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.circleStrokeColor[0]} setValue={p.circleStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderWidth')}</label>
                <PrefComboBox value={p.circleBorderWidth[0]} setValue={p.circleBorderWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.borderStyle')}</label>
                <select value={p.circleBorderStyle[0]()} onChange={e => p.circleBorderStyle[1](e.target.value)}>
                  <option value="solid">{tCommon('solid')}</option>
                  <option value="dashed">{tCommon('dashed')}</option>
                  <option value="dotted">{tCommon('dotted')}</option>
                </select>
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.circleOpacity[0]} setValue={p.circleOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.polygonDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.polygonStrokeColor[0]} setValue={p.polygonStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.lineWidth')}</label>
                <PrefComboBox value={p.polygonLineWidth[0]} setValue={p.polygonLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.polygonOpacity[0]} setValue={p.polygonOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>

            <fieldset class="pref-fieldset">
              <legend>{t('shapes.cloudDefaults')}</legend>
              <div class="pref-row">
                <label>{t('shapes.strokeColor')}</label>
                <PrefColorPicker value={p.cloudStrokeColor[0]} setValue={p.cloudStrokeColor[1]} />
              </div>
              <div class="pref-row">
                <label>{t('shapes.lineWidth')}</label>
                <PrefComboBox value={p.cloudLineWidth[0]} setValue={p.cloudLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={2} suffix="pt" />
              </div>
              <div class="pref-row">
                <label>{t('shapes.opacity')}</label>
                <PrefComboBox value={p.cloudOpacity[0]} setValue={p.cloudOpacity[1]} min={10} max={100} fallback={100} />
              </div>
            </fieldset>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
