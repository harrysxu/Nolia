import { Mark, mergeAttributes } from "@tiptap/core";

export const Highlight = Mark.create({
  name: "highlight",

  parseHTML() {
    return [
      {
        tag: "mark"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  }
});
