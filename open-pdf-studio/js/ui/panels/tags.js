import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { setTagTree as setTree, setTagCountText as setCountText, setTagEmptyMessage as setEmptyMessage } from '../../bridge.js';

function countNodes(node) {
  let count = 1;
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

export async function updateTagsList() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    setTree([]);
    setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.noDocumentOpen'));
    return;
  }

  setEmptyMessage(i18next.t('loading'));

  try {
    const pdfDoc = activeDoc.pdfDoc;
    const numPages = pdfDoc.numPages;
    const collectedTrees = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);

      if (typeof page.getStructTree !== 'function') {
        break;
      }

      try {
        const structTree = await page.getStructTree();
        if (structTree && structTree.children && structTree.children.length > 0) {
          collectedTrees.push(structTree);
        }
      } catch {
        // Page may not have structure tree
      }
    }

    if (collectedTrees.length === 0) {
      setTree([]);
      setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
      setEmptyMessage(i18next.t('leftPanel.noTags'));
      return;
    }

    let totalTagCount = 0;
    for (const tree of collectedTrees) {
      totalTagCount += countNodes(tree);
    }

    setEmptyMessage(null);
    setTree(collectedTrees);
    setCountText(i18next.t('leftPanel.tagsCount', { count: totalTagCount }));
  } catch (e) {
    console.warn('Failed to load tags:', e);
    setTree([]);
    setCountText(i18next.t('leftPanel.tagsCount', { count: 0 }));
    setEmptyMessage(i18next.t('leftPanel.couldNotLoadTags'));
  }
}
