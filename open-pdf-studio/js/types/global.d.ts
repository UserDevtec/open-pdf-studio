declare global {
  interface Window {
    __TAURI__?: {
      window?: typeof import('@tauri-apps/api/window');
      core?: typeof import('@tauri-apps/api/core');
      event?: typeof import('@tauri-apps/api/event');
      dialog?: any;
      fs?: any;
      shell?: any;
      os?: any;
      app?: typeof import('@tauri-apps/api/app');
    };
    __devMode?: boolean;
    shiftKeyPressed: boolean;
  }

  const __APP_VERSION__: string;
}

export {};
