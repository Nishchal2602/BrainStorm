import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Pocket PM',
  version: pkg.version,
  description: pkg.description,
  // Opens the side panel when the toolbar icon is clicked (also wired in the SW).
  action: {
    default_title: 'Pocket PM',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'index.html',
  },
  // 'identity' powers the Notion OAuth connect flow (chrome.identity.launchWebAuthFlow).
  // NOTE: launchWebAuthFlow's redirect URL is chrome.identity.getRedirectURL() —
  // https://<extension-id>.chromiumapp.org/notion. The extension id (and thus that
  // URL) is stable for a published build; for unpacked dev it changes per install
  // unless a "key" is pinned here — register the current getRedirectURL() output in
  // the Notion integration, or pin "key" for a constant id.
  permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'identity'],
  // Broad host access is required because the extension injects its page reader
  // (chrome.scripting.executeScript) into whatever tab you're viewing. activeTab
  // alone is unreliable with a side panel (openPanelOnActionClick doesn't reliably
  // grant it, and it never covers tab switches), so we declare page hosts here.
  // https://*/* also covers the model/API hosts (Gemini, Anthropic, the Worker
  // proxy) — an MV3 service worker may fetch any listed host with no CORS issue.
  host_permissions: ['http://*/*', 'https://*/*'],
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
})
