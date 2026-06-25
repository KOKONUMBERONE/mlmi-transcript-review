import React from 'react'
import ReactDOM from 'react-dom/client'
import AppFull from './AppFull'
import AppStudy from './AppStudy'
import './index.css'

// Build-time shell selection. `vite --mode study` sets VITE_APP_MODE=study
// (see .env.study); the default build is the full/police shell.
const App = import.meta.env.VITE_APP_MODE === 'study' ? AppStudy : AppFull

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
