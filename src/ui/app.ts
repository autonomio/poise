// Placeholder for the redesigned interface (#556). PR 7 replaces this module
// with the new interface; until then choosing it falls back to classic with
// a visible notice naming this failure.
export function mount(): void {
  throw new Error('the new interface is not part of this build yet')
}
