import {
  AlertCircle,
  FileText,
  Loader2,
  Moon,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { DocumentOut } from "../lib/api";
import {
  useDeleteDocument,
  useDocuments,
  useUploadDocuments,
} from "../queries/documents";
import { useLangStore } from "../store/lang";
import { useThemeStore } from "../store/theme";
import { Logo } from "./Logo";
import { ViewSwitch } from "./ViewSwitch";

const ACCEPTED = [".pdf", ".docx", ".txt", ".md"];
const ACCEPT_ATTR = ACCEPTED.join(",");

function hasSupportedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED.some((ext) => lower.endsWith(ext));
}

function HeaderControls() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const lang = useLangStore((s) => s.lang);
  const toggleLang = useLangStore((s) => s.toggleLang);
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={toggleLang}
        aria-label={t("nav.switchLanguage")}
        className="flex h-8 items-center rounded-md px-2 font-mono text-xs uppercase text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {lang}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? t("nav.themeToLight") : t("nav.themeToDark")}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}

function DocumentRow({ doc }: { doc: DocumentOut }) {
  const { t } = useTranslation();
  const remove = useDeleteDocument();
  const isDeleting = remove.isPending;

  return (
    <li className="group flex items-center gap-2.5 rounded-lg border border-hairline bg-surface px-3 py-2.5 transition-colors hover:border-hairline-strong">
      <FileText className="h-4 w-4 shrink-0 text-fg-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-fg" title={doc.name}>
          {doc.name}
        </p>
        <p className="font-mono text-[11px] text-fg-faint">
          {t("sidebar.pages", { count: doc.pages })} ·{" "}
          {t("sidebar.chunks", { count: doc.chunks })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => remove.mutate(doc.doc_id)}
        disabled={isDeleting}
        aria-label={t("sidebar.delete", { name: doc.name })}
        className="shrink-0 rounded-md p-1.5 text-fg-faint opacity-0 transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100 disabled:opacity-100"
      >
        {isDeleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </li>
  );
}

export function DocumentSidebar() {
  const { t } = useTranslation();
  const { data: docs, isLoading, isError, error } = useDocuments();
  const upload = useUploadDocuments();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const valid = files.filter((f) => hasSupportedExt(f.name));
    const invalid = files.filter((f) => !hasSupportedExt(f.name));
    setRejected(
      invalid.length > 0
        ? t("sidebar.unsupported", { names: invalid.map((f) => f.name).join(", ") })
        : null,
    );
    if (valid.length > 0) upload.mutate(valid);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <aside className="flex min-h-0 w-full flex-col border-b border-hairline bg-canvas md:h-full md:w-80 md:border-b-0 md:border-r lg:w-96">
      <div className="space-y-4 border-b border-hairline px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label={t("common.appName")}>
            <Logo />
          </Link>
          <HeaderControls />
        </div>
        <ViewSwitch />
      </div>

      {/* Zone d'upload */}
      <div className="px-4 pt-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
            dragging
              ? "border-hairline-strong bg-surface"
              : "border-hairline hover:border-hairline-strong hover:bg-surface"
          }`}
        >
          {upload.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
          ) : (
            <Upload className="h-5 w-5 text-fg-faint" />
          )}
          <p className="text-[13px] text-fg-muted">
            {upload.isPending ? t("sidebar.indexing") : t("sidebar.dropzone")}
          </p>
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-faint">
            {t("sidebar.formats")}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {(rejected || upload.isError) && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-muted">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {rejected ??
                (upload.error instanceof Error
                  ? upload.error.message
                  : t("sidebar.uploadFailed"))}
            </span>
          </p>
        )}
      </div>

      {/* Liste des documents */}
      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <p className="mb-2.5 font-mono text-[11px] uppercase tracking-wider text-fg-faint">
          {t("sidebar.documents")}
          {docs ? ` · ${docs.length}` : ""}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-fg-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : isError ? (
            <div className="flex items-start gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 py-2.5 text-xs text-fg-muted">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {error instanceof Error
                  ? error.message
                  : t("sidebar.backendUnreachable")}
              </span>
            </div>
          ) : !docs || docs.length === 0 ? (
            <p className="px-1 py-3 text-[13px] text-fg-faint">{t("sidebar.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {docs.map((doc) => (
                <DocumentRow key={doc.doc_id} doc={doc} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
