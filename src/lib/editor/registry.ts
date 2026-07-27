import { detectSource } from '@/lib/context/sourceDetect'
import type { DocumentEditor } from './editor'
import { NotionApiEditor } from './notionApi'

// One editor per detected source. Reuses detectSource (the same URL→source map
// the UI gate uses) so there's no duplicated hostname logic. Notion (official
// API) is the only supported editor; everything else → null → the SW surfaces
// UNSUPPORTED_SITE. The editor is constructed per-call with the OAuth token the
// SW already read (it never touches storage itself).
export function getEditor(url: string, token: string): DocumentEditor | null {
  return detectSource(url) === 'notion' ? new NotionApiEditor(token) : null
}
