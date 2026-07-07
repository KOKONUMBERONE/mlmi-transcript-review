/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 'study' selects AppStudy, 'sentence' selects AppSentence; anything else
  // (incl. undefined) selects AppFull.
  readonly VITE_APP_MODE?: 'full' | 'study' | 'sentence'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
