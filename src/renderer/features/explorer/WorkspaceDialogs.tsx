import type { RenameReferencePreview } from "../../../shared/types";
import type { TagRenamePreview, WorkspaceProbeResult } from "../../../shared/contracts";
import { useRendererI18n } from "../../app/i18n";
import type { MoveDialogState, NewItemKind, RenameTarget } from "../../app/types";

interface NewNoteDialogProps {
  open: boolean;
  kind: NewItemKind;
  value: string;
  parentPath: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function NewNoteDialog(props: NewNoteDialogProps) {
  const { tr } = useRendererI18n();
  if (!props.open) {
    return null;
  }
  const title = props.kind === "directory" ? tr("新建文件夹") : tr("新建笔记");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-label={props.kind === "directory" ? tr("取消新建文件夹") : tr("取消新建笔记")} onClick={props.onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <div className="modal-copy">
          <strong>{title}</strong>
          {props.parentPath ? <p>{props.parentPath}</p> : null}
        </div>
        <label className="modal-field">
          <span>{props.kind === "directory" ? tr("文件夹名称") : tr("笔记名称")}</span>
          <input value={props.value} autoFocus onChange={(event) => props.onChange(event.target.value)} />
        </label>
        <DialogActions cancelLabel={tr("取消")} confirmLabel={tr("创建")} onCancel={props.onCancel} />
      </form>
    </div>
  );
}

interface RenameDialogProps {
  target?: RenameTarget;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RenameDialog(props: RenameDialogProps) {
  const { tr } = useRendererI18n();
  if (!props.target) {
    return null;
  }
  const title = props.target.kind === "directory" ? tr("重命名文件夹") : props.target.kind === "resource" ? tr("重命名资源") : tr("重命名笔记");
  const fieldLabel = props.target.kind === "directory" ? tr("文件夹名称") : props.target.kind === "resource" ? tr("资源名称") : tr("笔记名称");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-label={tr("取消重命名")} onClick={props.onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <div className="modal-copy">
          <strong>{title}</strong>
          <p>{props.target.pathRel}</p>
        </div>
        <label className="modal-field">
          <span>{fieldLabel}</span>
          <input value={props.value} autoFocus onChange={(event) => props.onChange(event.target.value)} />
        </label>
        <DialogActions cancelLabel={tr("取消")} confirmLabel={tr("保存")} onCancel={props.onCancel} />
      </form>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { tr } = useRendererI18n();
  if (!props.open) {
    return null;
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={props.title}>
      <button type="button" className="modal-backdrop" aria-label={tr("取消")} onClick={props.onCancel} />
      <div className="modal-surface">
        <div className="modal-copy">
          <strong>{props.title}</strong>
          <p>{props.message}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={props.onCancel}>{tr("取消")}</button>
          <button type="button" className="primary-button" onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

interface RenameReferenceDialogProps {
  pending?: { target: RenameTarget; targetPathRel: string; preview: RenameReferencePreview };
  onCancel: () => void;
  onConfirm: () => void;
}

export function RenameReferenceDialog(props: RenameReferenceDialogProps) {
  if (!props.pending) {
    return null;
  }
  const replacements = props.pending.preview.changes.reduce((sum, change) => sum + change.replacements, 0);
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="rename-reference-title">
      <button type="button" className="modal-backdrop" aria-label="取消" onClick={props.onCancel} />
      <div className="modal-surface rename-reference-dialog">
        <div className="modal-copy"><strong id="rename-reference-title">重命名并更新 {replacements} 处引用？</strong><p>{props.pending.target.pathRel} → {props.pending.targetPathRel}</p></div>
        <div className="rename-reference-list">{props.pending.preview.changes.map((change) => <div key={change.pathRel}><strong>{change.pathRel}</strong><span>{change.replacements} 处引用</span></div>)}</div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={props.onCancel}>返回检查</button><button type="button" className="primary-button" onClick={props.onConfirm}>重命名并更新引用</button></div>
      </div>
    </div>
  );
}

export function TagRenameDialog({ pending, onCancel, onConfirm }: { pending?: TagRenamePreview; onCancel: () => void; onConfirm: () => void }) {
  if (!pending) {
    return null;
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="tag-rename-title">
      <button type="button" className="modal-backdrop" aria-label="取消" onClick={onCancel} />
      <div className="modal-surface rename-reference-dialog">
        <div className="modal-copy"><strong id="tag-rename-title">重命名标签并更新 {pending.replacements} 处？</strong><p>#{pending.sourceTag} → #{pending.targetTag}</p></div>
        <div className="rename-reference-list">{pending.changes.map((change) => <div key={change.pathRel}><strong>{change.pathRel}</strong><span>{change.replacements} 处标签</span></div>)}</div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>返回检查</button><button type="button" className="primary-button" onClick={onConfirm}>重命名并更新标签</button></div>
      </div>
    </div>
  );
}

export function WorkspaceProbeDialog({ probe, onCancel, onConfirm }: { probe?: WorkspaceProbeResult; onCancel: () => void; onConfirm: () => void }) {
  if (!probe) {
    return null;
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="workspace-probe-title">
      <button type="button" className="modal-backdrop" aria-label="取消" onClick={onCancel} />
      <div className="modal-surface">
        <div className="modal-copy"><strong id="workspace-probe-title">初始化 {probe.name}？</strong><p>{probe.path}</p><p>发现 {probe.markdownCount} 个 Markdown 文件。Nolia 将创建 `.nolia`，正文文件不会被移动或转换。</p></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="primary-button" onClick={onConfirm}>初始化并打开</button></div>
      </div>
    </div>
  );
}

interface MoveDialogProps {
  dialog?: MoveDialogState;
  folders: Array<{ pathRel: string; label: string }>;
  onChangeDestination: (pathRel: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function MoveDialog(props: MoveDialogProps) {
  const { tr } = useRendererI18n();
  if (!props.dialog) {
    return null;
  }
  const title = props.dialog.target.kind === "directory" ? tr("移动文件夹") : props.dialog.target.kind === "resource" ? tr("移动资源") : tr("移动文件");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-label={tr("取消移动")} onClick={props.onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <div className="modal-copy"><strong>{title}</strong><p>{props.dialog.target.pathRel}</p></div>
        <label className="modal-field">
          <span>{tr("目标文件夹")}</span>
          <select value={props.dialog.destinationPath} autoFocus onChange={(event) => props.onChangeDestination(event.target.value)}>
            {props.folders.map((folder) => <option key={folder.pathRel || "__root__"} value={folder.pathRel}>{folder.label}</option>)}
          </select>
        </label>
        <DialogActions cancelLabel={tr("取消")} confirmLabel={tr("移动")} onCancel={props.onCancel} />
      </form>
    </div>
  );
}

function DialogActions({ cancelLabel, confirmLabel, onCancel }: { cancelLabel: string; confirmLabel: string; onCancel: () => void }) {
  return (
    <div className="modal-actions">
      <button type="button" className="secondary-button" onClick={onCancel}>{cancelLabel}</button>
      <button type="submit" className="primary-button">{confirmLabel}</button>
    </div>
  );
}
