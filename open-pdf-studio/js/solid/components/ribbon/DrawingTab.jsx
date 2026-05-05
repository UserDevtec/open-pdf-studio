import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { setTool } from '../../../tools/manager.js';
import { state, getActiveDocument, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { clearSelection, selectAllOnPage } from '../../../core/stores/selection-helpers.js';
import { toggleFindBar } from '../../../search/find-bar.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { copyAnnotation, copyAnnotations, pasteAnnotation, pasteAnnotations, duplicateAnnotation } from '../../../annotations/clipboard.js';
import { flipHorizontal, flipVertical } from '../../../annotations/z-order.js';
import { cloneAnnotation } from '../../../annotations/factory.js';
import { recordBulkModify } from '../../../core/undo-manager.js';
import { alignLeft } from '../../../annotations/alignment.js';
import {
  handIcon, selectCommentsIcon, findIcon,
  lineIcon, rectIcon, polylineIcon, textboxIcon, noteIcon, ellipseIcon,
  calloutIcon, cloudIcon,
  measureDistanceIcon, measureAngleIcon, measurePerimeterIcon,
  alignLeftIcon, alignTopIcon, alignBottomIcon,
  flipHIcon, flipVIcon, rotateCwIcon,
  preferencesIcon, clearAllIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Generic placeholder icons for buttons without a dedicated icon
const placeholderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="0" stroke-dasharray="3 2"/><path d="M9 9 L15 15 M15 9 L9 15" stroke-width="1"/></svg>`;
const arcIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20 Q 12 4 20 20"/></svg>`;
const splineIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17 C 7 2, 13 2, 12 12 S 17 22 21 7"/></svg>`;
const hatchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M3 9 L9 3 M3 15 L15 3 M3 21 L21 3 M9 21 L21 9 M15 21 L21 15" stroke-width="1"/></svg>`;
const imageIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>`;
const moveIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>`;
const copyAnnIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="12" height="12"/><rect x="4" y="4" width="12" height="12"/></svg>`;
const arrayIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/></svg>`;
const trimIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 L20 4 M16 16 L4 4"/></svg>`;
const extendIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12h14M14 8l4 4-4 4M19 4v16" stroke-linecap="round"/></svg>`;
const pasteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="4" width="12" height="16"/><rect x="9" y="2" width="6" height="3"/></svg>`;
const cutIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 L20 4 M16 16 L4 4"/></svg>`;
const deleteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>`;
const tableIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/></svg>`;
const scaleRegionIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" stroke-dasharray="3 2"/><text x="12" y="16" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`;
const labelIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12l5-5h13v10H7z"/><circle cx="11" cy="12" r="1.5"/></svg>`;

function copySelected() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length === 0) return;
  if (sel.length > 1) copyAnnotations(sel);
  else copyAnnotation(sel[0]);
}

function pasteFromClipboard() {
  const ck = navigator.clipboard;
  // Use the same logic as the keyboard handler
  pasteAnnotations();
  pasteAnnotation();
}

function cutSelected() {
  const sel = getActiveDocument()?.selectedAnnotations || [];
  if (sel.length === 0) return;
  if (sel.length > 1) copyAnnotations(sel);
  else copyAnnotation(sel[0]);
  // Then delete via synthetic Delete event
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
}

function deleteSelected() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
}

function flipSelectedH() {
  const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
  if (!anns.length) return;
  const originals = anns.map(a => cloneAnnotation(a));
  for (const ann of anns) flipHorizontal(ann);
  recordBulkModify(anns, originals);
}

function flipSelectedV() {
  const anns = [...(getActiveDocument()?.selectedAnnotations || [])];
  if (!anns.length) return;
  const originals = anns.map(a => cloneAnnotation(a));
  for (const ann of anns) flipVertical(ann);
  recordBulkModify(anns, originals);
}

function moveSelected() {
  // Trigger G-key move (existing handler) on current selection
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
}

export default function DrawingTab() {
  const { t } = useTranslation('ribbon');
  const ro = () => noPdf() || isPdfAReadOnly();
  const cs = t('common.comingSoon') || 'Coming soon';

  return (
    <div class="ribbon-content active" id="tab-drawing">
      <AdaptiveGroups>

        {/* SELECTION */}
        <RibbonGroup label={t('drawing.selection')}>
          <RibbonButton id="dr-select" title={t('home.select')} icon={selectCommentsIcon} label={t('home.select')}
            disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => setTool('select')} />
          <RibbonButton id="dr-pan" title={t('home.handTool')} icon={handIcon} label={t('home.hand')}
            disabled={noPdf()} active={state.currentTool === 'hand'} onClick={() => setTool('hand')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-select-all" title={t('drawing.selectAll')} icon={selectCommentsIcon} label={t('drawing.selectAll')}
              disabled={noPdf()} onClick={() => selectAllOnPage()} />
            <RibbonButton size="small" id="dr-deselect" title={t('drawing.deselect')} icon={selectCommentsIcon} label={t('drawing.deselect')}
              disabled={noPdf()} onClick={() => clearSelection()} />
            <RibbonButton size="small" id="dr-find" title={t('drawing.findReplace')} icon={findIcon} label={t('drawing.findReplace')}
              disabled={noPdf()} onClick={() => toggleFindBar()} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* DRAW — uniform grid of small icon-only buttons (CAD toolbar style).
            All buttons are 26×26 size=small; the compact group's flex-wrap CSS
            arranges them into 2 rows × 7 cols. */}
        <RibbonGroup label={t('drawing.draw')} compact>
          {/* Row 1 */}
          <RibbonButton size="small" id="dr-line" title={t('comment.line')} icon={lineIcon}
            disabled={ro()} active={state.currentTool === 'line'} onClick={() => setTool('line')} />
          <RibbonButton size="small" id="dr-rect" title={t('comment.rectangle')} icon={rectIcon}
            disabled={ro()} active={state.currentTool === 'box'} onClick={() => setTool('box')} />
          <RibbonButton size="small" id="dr-arc" title="Arc" icon={arcIcon}
            disabled={ro()} active={state.currentTool === 'arc'} onClick={() => setTool('arc')} />
          <RibbonButton size="small" id="dr-polyline" title={t('comment.polylineTitle')} icon={polylineIcon}
            disabled={ro()} active={state.currentTool === 'polyline'} onClick={() => setTool('polyline')} />
          <RibbonButton size="small" id="dr-hatch" title={t('comment.filledArea')} icon={hatchIcon}
            disabled={ro()} active={state.currentTool === 'filledArea'} onClick={() => setTool('filledArea')} />
          <RibbonButton size="small" id="dr-text" title={t('comment.textBox')} icon={textboxIcon}
            disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton size="small" id="dr-note" title={t('comment.note')} icon={noteIcon}
            disabled={ro()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
          {/* Row 2 */}
          <RibbonButton size="small" id="dr-spline" title={t('comment.splineTitle')} icon={splineIcon}
            disabled={ro()} active={state.currentTool === 'spline'} onClick={() => setTool('spline')} />
          <RibbonButton size="small" id="dr-circle" title={t('comment.ellipse')} icon={ellipseIcon}
            disabled={ro()} active={state.currentTool === 'circle'} onClick={() => setTool('circle')} />
          <RibbonButton size="small" id="dr-ellipse" title={t('comment.ellipse')} icon={ellipseIcon}
            disabled={ro()} active={state.currentTool === 'circle'} onClick={() => setTool('circle')} />
          <RibbonButton size="small" id="dr-pattern-rect" title={cs} icon={placeholderIcon} disabled={true} />
          <RibbonButton size="small" id="dr-l-shape" title={cs} icon={placeholderIcon} disabled={true} />
          <RibbonButton size="small" id="dr-image" title={t('drawing.image')} icon={imageIcon}
            disabled={ro()} active={state.currentTool === 'image'} onClick={() => setTool('image')} />
          <RibbonButton size="small" id="dr-scale-region"
            title={t('comment.scaleRegion') || 'Scale region'}
            icon={scaleRegionIcon}
            disabled={ro()} active={state.currentTool === 'scaleRegion'}
            onClick={() => setTool('scaleRegion')} />
        </RibbonGroup>

        {/* ANNOTATE */}
        <RibbonGroup label={t('drawing.annotate')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-aligned" title={t('measure.measureDistance')} icon={measureDistanceIcon} label={t('drawing.aligned')}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="dr-linear" title={t('measure.measureDistance')} icon={measureDistanceIcon} label={t('drawing.linear')}
              disabled={ro()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="dr-angular" title={t('measure.measureAngle')} icon={measureAngleIcon} label={t('drawing.angular')}
              disabled={ro()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            {/* Spot Coord — placeholder icon, deferred */}
            <RibbonButton size="small" id="dr-spot-coord" title={cs} icon={placeholderIcon} label={t('drawing.spotCoord')}
              disabled={true} />
            {/* Radius — placeholder icon, deferred */}
            <RibbonButton size="small" id="dr-radius" title={cs} icon={placeholderIcon} label={t('drawing.radius')}
              disabled={true} />
            {/* Diameter — placeholder icon, deferred */}
            <RibbonButton size="small" id="dr-diameter" title={cs} icon={placeholderIcon} label={t('drawing.diameter')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-leader" title={t('comment.callout')} icon={calloutIcon} label={t('drawing.leader')}
              disabled={ro()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
            <RibbonButton size="small" id="dr-label" title={t('drawing.label')} icon={labelIcon} label={t('drawing.label')}
              disabled={ro()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
            {/* Table — no scheduleTable tool registered; deferred */}
            <RibbonButton size="small" id="dr-table" title={cs} icon={tableIcon} label={t('drawing.table')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-cloud" title={t('comment.cloud')} icon={cloudIcon} label={t('comment.cloud')}
              disabled={ro()} active={state.currentTool === 'cloud'} onClick={() => setTool('cloud')} />
            <RibbonButton size="small" id="dr-measure" title={t('measure.measurePerimeter')} icon={measurePerimeterIcon} label={t('drawing.measure')}
              disabled={ro()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* MODIFY */}
        <RibbonGroup label={t('drawing.modify')}>
          <RibbonButton id="dr-move" title={t('drawing.move')} icon={moveIcon} label={t('drawing.move')}
            disabled={ro()} onClick={moveSelected} />
          <RibbonButton id="dr-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
            disabled={ro()} onClick={() => duplicateAnnotation()} />
          <RibbonButtonStack>
            {/* Rotate — no batch rotate command exposed here; deferred (use Arrange tab for rotate) */}
            <RibbonButton size="small" id="dr-rotate" title={cs} icon={rotateCwIcon} label={t('drawing.rotate')}
              disabled={true} />
            <RibbonButton size="small" id="dr-mirror-h" title={t('arrange.flipHorizontally')} icon={flipHIcon} label={t('drawing.mirrorH')}
              disabled={ro()} onClick={flipSelectedH} />
            <RibbonButton size="small" id="dr-mirror-v" title={t('arrange.flipVertically')} icon={flipVIcon} label={t('drawing.mirrorV')}
              disabled={ro()} onClick={flipSelectedV} />
          </RibbonButtonStack>
          <RibbonButton id="dr-array" title={t('drawing.array')} icon={arrayIcon} label={t('drawing.array')}
            disabled={ro()} active={state.currentTool === 'array'} onClick={() => setTool('array')} />
        </RibbonGroup>

        {/* EDIT */}
        <RibbonGroup label={t('drawing.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-trim" title={t('drawing.trim')} icon={trimIcon} label={t('drawing.trim')}
              disabled={ro()} active={state.currentTool === 'trim'} onClick={() => setTool('trim')} />
            <RibbonButton size="small" id="dr-extend" title={t('drawing.extend')} icon={extendIcon} label={t('drawing.extend')}
              disabled={ro()} active={state.currentTool === 'extend'} onClick={() => setTool('extend')} />
            <RibbonButton size="small" id="dr-offset" title={cs} icon={placeholderIcon} label={t('drawing.offset')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-fillet" title={cs} icon={placeholderIcon} label={t('drawing.fillet')}
              disabled={true} />
            <RibbonButton size="small" id="dr-chamfer" title={cs} icon={placeholderIcon} label={t('drawing.chamfer')}
              disabled={true} />
            <RibbonButton size="small" id="dr-stretch" title={cs} icon={placeholderIcon} label={t('drawing.stretch')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-split" title={cs} icon={placeholderIcon} label={t('drawing.split')}
              disabled={true} />
            <RibbonButton size="small" id="dr-align" title={t('arrange.alignLeft')} icon={alignLeftIcon} label={t('drawing.align')}
              disabled={ro()} onClick={() => alignLeft()} />
            <RibbonButton size="small" id="dr-explode" title={cs} icon={placeholderIcon} label={t('drawing.explode')}
              disabled={true} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-break" title={cs} icon={placeholderIcon} label={t('drawing.break')}
              disabled={true} />
            <RibbonButton size="small" id="dr-join" title={cs} icon={placeholderIcon} label={t('drawing.join')}
              disabled={true} />
            <RibbonButton size="small" id="dr-lengthen" title={cs} icon={placeholderIcon} label={t('drawing.lengthen')}
              disabled={true} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* CLIPBOARD */}
        <RibbonGroup label={t('drawing.clipboard')}>
          <RibbonButton id="dr-paste" title={t('drawing.paste')} icon={pasteIcon} label={t('drawing.paste')}
            disabled={ro()} onClick={pasteFromClipboard} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-cut" title={t('drawing.cut')} icon={cutIcon} label={t('drawing.cut')}
              disabled={ro()} onClick={cutSelected} />
            <RibbonButton size="small" id="dr-clip-copy" title={t('drawing.copy')} icon={copyAnnIcon} label={t('drawing.copy')}
              disabled={ro()} onClick={copySelected} />
            <RibbonButton size="small" id="dr-delete" title={t('drawing.delete')} icon={deleteIcon} label={t('drawing.delete')}
              disabled={ro()} onClick={deleteSelected} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* COLLECTION */}
        <RibbonGroup label={t('drawing.collection')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="dr-coll-create" title={cs} icon={placeholderIcon} label={t('drawing.collectionCreate')}
              disabled={true} />
            <RibbonButton size="small" id="dr-coll-explode" title={cs} icon={placeholderIcon} label={t('drawing.collectionExplode')}
              disabled={true} />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* SETTINGS */}
        <RibbonGroup label={t('drawing.settings')}>
          <RibbonButton id="dr-settings" title={t('help.preferences')} icon={preferencesIcon} label={t('help.preferences')}
            onClick={() => showPreferencesDialog()} />
        </RibbonGroup>

      </AdaptiveGroups>
    </div>
  );
}
