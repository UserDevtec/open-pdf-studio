import { Show, Switch, Match } from 'solid-js';
import RibbonTab from './RibbonTab.jsx';
import HomeTab from './HomeTab.jsx';
import CommentTab from './CommentTab.jsx';
import ViewTab from './ViewTab.jsx';
import OrganizeTab from './OrganizeTab.jsx';
import HelpTab from './HelpTab.jsx';
import FormatTab from './FormatTab.jsx';
import ArrangeTab from './ArrangeTab.jsx';
import { activeTab, setActiveTab, contextualTabsVisible } from '../../stores/ribbonStore.js';
import { openAppMenu } from '../../../ui/chrome/menus.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function Ribbon() {
  const { t } = useTranslation('ribbon');

  return (
    <>
      <div class="ribbon-tabs">
        <RibbonTab label={t('tabs.file')} isFileTab={true} id="file-tab"
          onClick={() => openAppMenu()} />
        <RibbonTab label={t('tabs.home')} dataTab="home"
          isActive={activeTab() === 'home'}
          onClick={() => setActiveTab('home')} />
        <RibbonTab label={t('tabs.comment')} dataTab="comment"
          isActive={activeTab() === 'comment'}
          onClick={() => setActiveTab('comment')} />
        <RibbonTab label={t('tabs.view')} dataTab="view"
          isActive={activeTab() === 'view'}
          onClick={() => setActiveTab('view')} />
        <RibbonTab label={t('tabs.organize')} dataTab="organize"
          isActive={activeTab() === 'organize'}
          onClick={() => setActiveTab('organize')} />
        <RibbonTab label={t('tabs.help')} dataTab="help"
          isActive={activeTab() === 'help'}
          onClick={() => setActiveTab('help')} />
        <Show when={contextualTabsVisible()}>
          <span class="ribbon-tab-separator contextual-tabs visible" id="contextual-tabs-separator"></span>
          <RibbonTab label={t('tabs.format')} dataTab="format" isContextual={true} id="tab-format-btn"
            isActive={activeTab() === 'format'}
            onClick={() => setActiveTab('format')} />
          <RibbonTab label={t('tabs.arrange')} dataTab="arrange" isContextual={true} id="tab-arrange-btn"
            isActive={activeTab() === 'arrange'}
            onClick={() => setActiveTab('arrange')} />
        </Show>
      </div>

      <Switch>
        <Match when={activeTab() === 'home'}><HomeTab /></Match>
        <Match when={activeTab() === 'comment'}><CommentTab /></Match>
        <Match when={activeTab() === 'view'}><ViewTab /></Match>
        <Match when={activeTab() === 'organize'}><OrganizeTab /></Match>
        <Match when={activeTab() === 'help'}><HelpTab /></Match>
        <Match when={activeTab() === 'format'}><FormatTab /></Match>
        <Match when={activeTab() === 'arrange'}><ArrangeTab /></Match>
      </Switch>
    </>
  );
}
