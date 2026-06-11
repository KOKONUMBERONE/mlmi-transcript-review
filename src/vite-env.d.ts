/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 'study' selects AppStudy; anything else (incl. undefined) selects AppFull.
  readonly VITE_APP_MODE?: 'full' | 'study'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
