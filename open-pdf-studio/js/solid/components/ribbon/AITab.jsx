import { createSignal, Show } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { getActiveDocument, noPdf } from '../../../core/state.js';
import {
  aiPanelVisible, setAiPanelVisible, isAuthenticated, requireSignIn,
  signInHint, sendAction,
} from '../../stores/aiStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { setTool } from '../../../tools/manager.js';
import { setHoverTargetLang, getHoverTargetLang, clearHoverCache } from '../../../tools/tools/hover-translate-tool.js';

const icons = {
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9 17h6"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>',
  qa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 1 1 3.5 2.95V14"/><circle cx="12" cy="17" r="0.5"/></svg>',
  translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 10M11 8L5 18M2 12h14M7 5h4M12 2l7 20M16.5 12L19 18l2.5-6"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  rewrite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  extract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  hover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
};

const LANGUAGES = [
  'Arabic', 'Bengali', 'Bulgarian', 'Catalan', 'Chinese', 'Croatian', 'Czech',
  'Danish', 'Dutch', 'English', 'Finnish', 'French', 'German', 'Greek',
  'Hebrew', 'Hindi', 'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Korean',
  'Malay', 'Norwegian', 'Persian', 'Polish', 'Portuguese', 'Romanian', 'Russian',
  'Serbian', 'Slovak', 'Spanish', 'Swahili', 'Swedish', 'Tamil', 'Thai',
  'Turkish', 'Ukrainian', 'Urdu', 'Vietnamese',
];

function extractPageText() {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return Promise.resolve('');
  return doc.pdfDoc.getPage(doc.currentPage)
    .then(page => page.getTextContent())
    .then(tc => tc.items.map(i => i.str).join(' '));
}

function extractAllText() {
  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return Promise.resolve('');
  const n = Math.min(doc.pdfDoc.numPages, 20);
  const promises = [];
  for (let i = 1; i <= n; i++) {
    promises.push(
      doc.pdfDoc.getPage(i)
        .then(page => page.getTextContent())
        .then(tc => '[Page ' + i + ']\n' + tc.items.map(item => item.str).join(' '))
    );
  }
  return Promise.all(promises).then(parts => parts.join('\n\n'));
}

async function requireAuth(fn) {
  if (!(await requireSignIn())) return;
  setAiPanelVisible(true);
  try { await fn(); } catch (err) { console.error('[AI]', err); }
}

export default function AITab() {
  const { t } = useTranslation('ribbon');
  const [hoverLang, setHoverLang] = createSignal(getHoverTargetLang());

  async function handleHoverToggle() {
    if (!(await requireSignIn())) return;
    if (state.currentTool === 'hoverTranslate') {
      setTool('hand');
    } else {
      setTool('hoverTranslate');
    }
  }


  async function handleSignIn() {
    await requireSignIn();
  }

  return (
    <div class="ribbon-content active" id="tab-ai">
      <Show when={!isAuthenticated()}>
        <div class="ribbon-signin-prompt">
          <div class="ribbon-signin-icon" innerHTML={icons.ai} />
          <div class="ribbon-signin-text">
            <div class="ribbon-signin-title">{t('ai.signInToUseAI') || 'Sign in to use AI features'}</div>
            <div class="ribbon-signin-sub">{t('ai.signInSub') || 'PDF editing works offline. AI features (summarize, translate, Q&A, chat) use your Impertio account.'}</div>
          </div>
          <button class="ribbon-signin-btn" onClick={handleSignIn}>
            {t('ai.signIn') || 'Sign in'}
          </button>
          <Show when={signInHint() === 'cancelled'}>
            <div class="ribbon-signin-hint">{t('ai.signInCancelled') || 'Sign-in cancelled.'}</div>
          </Show>
        </div>
      </Show>

      <Show when={isAuthenticated()}>
      <AdaptiveGroups>
        <RibbonGroup label={t('ai.panel') || 'Panel'}>
          <RibbonButton id="btn-ai-panel" title={t('ai.openPanel') || 'AI Assistant'}
            icon={icons.ai} label={t('ai.assistant') || 'AI Assistant'}
            active={aiPanelVisible()}
            onClick={async () => {
              if (!(await requireSignIn())) return;
              setAiPanelVisible(!aiPanelVisible());
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('ai.document') || 'Document'}>
          <RibbonButton id="btn-ai-summarize" title={t('ai.summarizeDoc') || 'Summarize document'}
            icon={icons.summarize} label={t('ai.summarize') || 'Summarize'}
            disabled={noPdf()}
            onClick={() => requireAuth(() => extractAllText().then(text => { if (text) sendAction('summarize', text); }))} />
          <RibbonButton id="btn-ai-explain" title={t('ai.explainDoc') || 'Explain this page'}
            icon={icons.explain} label={t('ai.explain') || 'Explain'}
            disabled={noPdf()}
            onClick={() => requireAuth(() => extractPageText().then(text => { if (text) sendAction('explain', text); }))} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="btn-ai-extract" title={t('ai.extractData') || 'Extract data'}
              icon={icons.extract} label={t('ai.extract') || 'Extract'}
              disabled={noPdf()}
              onClick={() => requireAuth(() => extractAllText().then(text => { if (text) sendAction('extract', text); }))} />
            <RibbonButton size="small" id="btn-ai-translate" title={t('ai.translateDoc') || 'Translate PDF'}
              icon={icons.translate} label={t('ai.translate') || 'Translate'}
              disabled={noPdf()}
              onClick={async () => {
                if (!(await requireSignIn())) return;
                openDialog('ai-translate', { scope: 'page' });
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('ai.liveTranslate') || 'Live Translate'}>
          <RibbonButton id="btn-ai-hover" title={t('ai.hoverTranslate') || 'Hover to translate text'}
            icon={icons.hover} label={t('ai.hoverTranslate') || 'Hover'}
            disabled={noPdf()}
            active={state.currentTool === 'hoverTranslate'}
            onClick={handleHoverToggle} />
          <div class="ai-lang-picker">
            <label class="ai-lang-label">{t('ai.targetLang') || 'To'}:</label>
            <PrefSelect
              value={hoverLang}
              setValue={(val) => { setHoverLang(val); setHoverTargetLang(val); clearHoverCache(); }}
              options={LANGUAGES.map(lang => ({ value: lang, label: lang }))}
              style={{ width: '90px' }}
            />
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('ai.text') || 'Text'}>
          <RibbonButton id="btn-ai-rewrite" title={t('ai.rewriteText') || 'Rewrite selected text'}
            icon={icons.rewrite} label={t('ai.rewrite') || 'Rewrite'}
            disabled={noPdf()}
            onClick={() => requireAuth(() => extractPageText().then(text => { if (text) sendAction('rewrite', text); }))} />
          <RibbonButton id="btn-ai-qa" title={t('ai.askQuestion') || 'Ask a question'}
            icon={icons.qa} label={t('ai.ask') || 'Ask'}
            disabled={noPdf()}
            onClick={() => requireAuth(() => {})} />
        </RibbonGroup>

        <RibbonGroup label={t('ai.chat') || 'Chat'}>
          <RibbonButton id="btn-ai-chat" title={t('ai.openChat') || 'Open AI chat'}
            icon={icons.chat} label={t('ai.chat') || 'Chat'}
            onClick={async () => {
              if (!(await requireSignIn())) return;
              setAiPanelVisible(true);
            }} />
        </RibbonGroup>
      </AdaptiveGroups>
      </Show>
    </div>
  );
}
