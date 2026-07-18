export function renderWorkspaceTemplate(source: string, variables: { title: string; workspace: string; date: string; time: string }): string {
  return source.replace(/\{\{\s*(date|time|title|workspace)\s*\}\}/g, (_match, key: keyof typeof variables) => variables[key]);
}
