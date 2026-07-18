import { extractText, getDocumentProxy } from 'unpdf'

const PDF_MAGIC = '%PDF-'

/** Does this file look like a PDF? The magic number is authoritative; the
 *  declared MIME type / filename extension are fallbacks (e.g. empty magic). */
function looksLikePdf(bytes: Buffer, mimeType?: string, fileName?: string): boolean {
  if (bytes.subarray(0, 5).toString('latin1') === PDF_MAGIC) return true
  if (mimeType?.toLowerCase().includes('pdf')) return true
  if (fileName?.toLowerCase().endsWith('.pdf')) return true
  return false
}

/**
 * Turn an uploaded PRD file into review-able text. Markdown / plain-text files
 * are decoded as UTF-8 (unchanged behavior); PDFs are run through unpdf (pdf.js,
 * serverless build) so the agents receive the real document instead of raw PDF
 * bytes — the platform used to `bytes.toString('utf8')` a PDF and feed the
 * agents its binary structure. Provider-agnostic: this runs before the text ever
 * reaches Gemini/Anthropic, so it fixes PDF review on either backend.
 */
export async function extractDocumentText(
  bytes: Buffer,
  meta?: { mimeType?: string; fileName?: string },
): Promise<string> {
  if (!looksLikePdf(bytes, meta?.mimeType, meta?.fileName)) {
    // Markdown / plain text — decode as before.
    return bytes.toString('utf8')
  }
  let text: string
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    ;({ text } = await extractText(pdf, { mergePages: true }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not extract text from the PDF: ${msg}`)
  }
  const clean = text.trim()
  if (!clean) {
    throw new Error(
      'This PDF has no extractable text (it looks scanned or image-only). ' +
        'Upload a text-based PDF, or paste the PRD as Markdown / plain text.',
    )
  }
  return clean
}
