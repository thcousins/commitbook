// The note editor: TipTap with Markdown in and out.

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { Sheet } from './sheet-node.js';

export function createEditor({ element, markdown = '', editable = true, onChange, onSelection }) {
  const editor = new Editor({
    element,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,          // not part of standard Markdown
        link: { openOnClick: !editable, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
        codeBlock: { HTMLAttributes: { class: 'cb-code' } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing… Type # for a heading, - for a list, [ ] for a checklist.' }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Sheet,
    ],
    content: markdown,
    contentType: 'markdown',
    onUpdate: () => onChange?.(),
    onSelectionUpdate: () => onSelection?.(),
    onTransaction: () => onSelection?.(),
  });
  return editor;
}

export function getMarkdown(editor) {
  return editor.getMarkdown().replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Toolbar actions. */
export const COMMANDS = {
  undo: e => e.chain().focus().undo().run(),
  redo: e => e.chain().focus().redo().run(),
  bold: e => e.chain().focus().toggleBold().run(),
  italic: e => e.chain().focus().toggleItalic().run(),
  strike: e => e.chain().focus().toggleStrike().run(),
  code: e => e.chain().focus().toggleCode().run(),
  h1: e => e.chain().focus().toggleHeading({ level: 1 }).run(),
  h2: e => e.chain().focus().toggleHeading({ level: 2 }).run(),
  h3: e => e.chain().focus().toggleHeading({ level: 3 }).run(),
  bullets: e => e.chain().focus().toggleBulletList().run(),
  numbers: e => e.chain().focus().toggleOrderedList().run(),
  checklist: e => e.chain().focus().toggleTaskList().run(),
  quote: e => e.chain().focus().toggleBlockquote().run(),
  codeBlock: e => e.chain().focus().toggleCodeBlock().run(),
  sheet: e => e.chain().focus().insertSheet().run(),
};

export function activeStates(e) {
  return {
    undo: e.can().undo(),
    redo: e.can().redo(),
    bold: e.isActive('bold'),
    italic: e.isActive('italic'),
    strike: e.isActive('strike'),
    code: e.isActive('code'),
    h1: e.isActive('heading', { level: 1 }),
    h2: e.isActive('heading', { level: 2 }),
    h3: e.isActive('heading', { level: 3 }),
    bullets: e.isActive('bulletList'),
    numbers: e.isActive('orderedList'),
    checklist: e.isActive('taskList'),
    quote: e.isActive('blockquote'),
    codeBlock: e.isActive('codeBlock'),
  };
}
