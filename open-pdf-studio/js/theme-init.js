try {
  const p = JSON.parse(localStorage.getItem('pdfEditorPreferences') || '{}');
  if (p.theme) {
    let t = p.theme;
    if (t === 'system') {
      try { t = window.__TAURI__?.window?.getCurrentWindow()?.theme() === 'dark' ? 'dark' : 'light'; }
      catch(e2) { t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    }
    document.documentElement.setAttribute('data-theme', t);
  }
} catch(e) {}
