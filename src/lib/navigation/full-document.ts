export function replaceDocument(path: string): void {
  window.location.replace(path);
}

export function navigateDocument(path: string): void {
  window.location.assign(path);
}
