import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { QuestionEditorDialog } from "./QuestionEditorDialog.js";
import { ToastMessage } from "./ToastMessage.js";

export const GlobalOverlays = {
  name: "GlobalOverlays",
  components: { ConfirmDeleteDialog, QuestionEditorDialog, ToastMessage },
  template: `
    <ToastMessage />
    <ConfirmDeleteDialog />
    <QuestionEditorDialog />
  `,
};
