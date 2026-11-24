import mammoth from 'mammoth';
import TurndownService from 'turndown';

/**
 * Client-Side Document Import Service
 *  1. importGoogleDoc(url)            — Calls server-side `/api/import-gdoc`
 *  2. convertDocxFileToMarkdown(file) — Converts `.docx` -> HTML (mammoth) -> Markdown (turndown)
 */

const GDOC_IMPORT_ENDPOINT = '/api/import-gdoc';

export async function importGoogleDoc(url) {
  let response;
  try {
    response = await fetch(GDOC_IMPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: String(url || '').trim() }),
    });
  } catch {
    throw new Error('Network error reaching /api/import-gdoc. Ensure the server is running.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const err = new Error(
      data?.error || `Failed to import Google Doc (HTTP ${response.status}).`
    );
    if (data?.code) err.code = data.code;
    err.status = response.status;
    throw err;
  }

  return {
    title: data?.title || 'Imported Google Doc',
    markdown: data?.markdown || '',
    format: data?.format || 'md',
  };
}

export async function convertDocxFileToMarkdown(file) {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Preserve simple HTML tables as GFM tables
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows.map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) =>
          (cell.textContent || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
        )
      );
      const colCount = Math.max(...matrix.map((r) => r.length), 1);
      const padRow = (r) => Array.from({ length: colCount }, (_, idx) => r[idx] || '');
      const header = padRow(matrix[0]);
      const sep = header.map(() => '---');
      const bodyRows = matrix.slice(1).map(padRow);
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
      ];
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });

  const baseName = file.name.replace(/\.docx$/i, '').trim() || 'Imported Word Document';
  const markdown = turndown.turndown(html || '').replace(/\n{3,}/g, '\n\n').trim();
  const content = markdown.startsWith('#') ? markdown : `# ${baseName}\n\n${markdown}`;

  return {
    title: baseName,
    content,
  };
}
