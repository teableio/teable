import { WidgetType } from '@codemirror/view';

export class FieldVariable extends WidgetType {
  constructor(
    readonly fieldId: string,
    readonly fieldName: string,
    readonly from: number,
    readonly to: number,
    readonly onDelete: (from: number, to: number) => void
  ) {
    super();
  }

  toDOM() {
    const container = document.createElement('span');
    container.className =
      'inline-flex h-5 items-center gap-1 rounded bg-violet-50 px-1.5 text-xs text-violet-500 cursor-default select-none hover:bg-violet-100 mx-1';
    container.dataset.fieldId = this.fieldId;
    container.dataset.fieldRange = `${this.from},${this.to}`;
    container.style.verticalAlign = 'middle';

    const textSpan = document.createElement('span');
    textSpan.textContent = this.fieldName;
    textSpan.className = 'max-w-[120px] truncate';
    container.appendChild(textSpan);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className =
      'inline-flex items-center justify-center size-3 hover:bg-violet-200 rounded-sm transition-colors';
    deleteButton.innerHTML = `
      <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    `;
    deleteButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onDelete(this.from, this.to);
    });
    container.appendChild(deleteButton);

    return container;
  }

  eq(other: FieldVariable) {
    return (
      this.fieldId === other.fieldId &&
      this.fieldName === other.fieldName &&
      this.from === other.from &&
      this.to === other.to
    );
  }
}
