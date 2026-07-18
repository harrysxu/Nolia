import { Button, Dialog, Heading, Input, Label, Modal, TextArea, TextField } from "react-aria-components";

interface QuickCaptureDialogProps {
  open: boolean;
  saving: boolean;
  target: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: { title: string; body: string }) => void;
}

export function QuickCaptureDialog({ open, saving, target, onOpenChange, onSubmit }: QuickCaptureDialogProps) {
  return (
      <Modal className="nolia-modal" isOpen={open} onOpenChange={onOpenChange} isDismissable={!saving}>
        <Dialog className="nolia-dialog quick-capture-dialog">
          {({ close }) => (
            <form onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              onSubmit({ title: String(data.get("title") || ""), body: String(data.get("body") || "") });
            }}>
              <Heading slot="title">快速捕获</Heading>
              <TextField name="title"><Label>标题</Label><Input placeholder="可选" /></TextField>
              <TextField name="body" isRequired><Label>正文</Label><TextArea autoFocus rows={7} /></TextField>
              <p className="capture-target">保存到 {target}</p>
              <div className="dialog-actions"><Button type="button" onPress={close} isDisabled={saving}>取消</Button><Button type="submit" className="is-primary" isDisabled={saving}>{saving ? "正在捕获" : "捕获"}</Button></div>
            </form>
          )}
        </Dialog>
      </Modal>
  );
}
