/**
 * Import du calque de fond (jalon 7) : plan de masse DXF (lecteur `@blondel/core/dxf` chargé à
 * la demande, unité `$INSUNITS` ou échelle demandée) et image PNG / JPEG enregistrée dans le
 * projet (réduite si besoin sous `UNDERLAY_IMAGE_MAX_CHARS`), puis réglages : placement,
 * opacité, retrait. Chaque modification passe par le store (validée, annulable). Les fichiers
 * choisis par le menu « Importer » de la barre d'outils arrivent par `store/importQueue.ts`.
 */
import {
  UNDERLAY_IMAGE_MAX_CHARS,
  withDxfUnderlay,
  withImageUnderlay,
  withUnderlayOpacity,
  type BBox,
  type DxfUnderlay,
  type ImageUnderlay,
  type Project,
  type UnderlayEntity,
} from "@blondel/core";
import { MessageError, errorMessage, isMessageError, msg, type Message } from "@blondel/i18n";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useStore } from "zustand";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { appStore, useApp } from "../store/appStore.js";
import { importQueue, takeUnderlayImport } from "../store/importQueue.js";
import {
  defaultDxfPlacement,
  defaultImagePlacement,
  IMAGE_MAX_SIDE_PX,
  UNIT_CHOICES,
} from "../views/planSiteGeometry.js";

/** Texte d'un avis : message traduit à l'affichage (il suit un changement de langue). */
type NoticeText = Message;

type Notice = { readonly kind: "info" | "error"; readonly text: NoticeText } | null;

/** Lecture DXF en attente d'une échelle (unité absente de l'en-tête). */
interface PendingDxf {
  readonly name: string;
  readonly text: string;
}

function commit(recipe: (p: Project) => Project): NoticeText | null {
  const r = appStore.getState().update(recipe);
  appStore.getState().endGroup();
  return r.ok ? null : (r.issues[0] ?? msg("ui.underlay.refused"));
}

function readFile(file: File, as: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new MessageError(msg("ui.underlay.error.read")));
    if (as === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new MessageError(msg("ui.underlay.error.image")));
    img.src = src;
  });
}

/**
 * Image prête pour le projet : data URL PNG / JPEG d'au plus `UNDERLAY_IMAGE_MAX_CHARS`
 * caractères ; au-delà (ou plus de `IMAGE_MAX_SIDE_PX` de côté), réduite et réencodée en JPEG.
 */
async function prepareImage(
  file: File,
): Promise<{ dataUrl: string; w: number; h: number; reduced: boolean }> {
  const original = await readFile(file, "dataUrl");
  const img = await decodeImage(original);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const acceptable = /^data:image\/(png|jpeg);base64,/.test(original);
  if (
    acceptable &&
    original.length <= UNDERLAY_IMAGE_MAX_CHARS &&
    Math.max(w0, h0) <= IMAGE_MAX_SIDE_PX
  ) {
    return { dataUrl: original, w: w0, h: h0, reduced: false };
  }
  let scale = Math.min(1, IMAGE_MAX_SIDE_PX / Math.max(w0, h0));
  for (let i = 0; i < 8; i++) {
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MessageError(msg("ui.underlay.error.canvas"));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length <= UNDERLAY_IMAGE_MAX_CHARS) return { dataUrl, w, h, reduced: true };
    scale *= 0.75;
  }
  throw new MessageError(msg("ui.underlay.error.tooLarge"));
}

export function UnderlayImport({
  stairBounds,
}: {
  /** Emprise de l'escalier et de la trémie (recentrage d'un plan lointain, image initiale). */
  readonly stairBounds: BBox | null;
}) {
  const id = useId();
  const t = useT();
  const underlay = useApp((s) => s.project.site.underlay);
  const dxfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<PendingDxf | null>(null);
  const [scale, setScale] = useState("1000");
  const [busy, setBusy] = useState(false);

  const loadDxf = async (name: string, text: string, unitScale?: number): Promise<void> => {
    setBusy(true);
    try {
      const { readDxfUnderlay, describeSkipped } = await import("@blondel/core/dxf");
      const r = readDxfUnderlay(text, unitScale !== undefined ? { unitScale } : {});
      if (r.needsScale) {
        setPending({ name, text });
        setNotice({ kind: "info", text: msg("ui.underlay.dxf.needsScale", { name }) });
        return;
      }
      setPending(null);
      if (r.entities.length === 0) {
        setNotice({ kind: "error", text: msg("ui.underlay.dxf.empty", { name }) });
        return;
      }
      const dxf: DxfUnderlay = {
        name: name.slice(0, 200),
        unitScale: r.unitScale,
        placement: defaultDxfPlacement(r.bounds, stairBounds),
        entities: r.entities as UnderlayEntity[],
      };
      const error = commit((p) => withDxfUnderlay(p, dxf));
      // Entités ignorées détaillées par famille (textes, cotes, hachures…), lues dans le cœur.
      const skipped = describeSkipped(r.skipped);
      let summary = msg("ui.underlay.dxf.imported", {
        name,
        entities: msg("ui.underlay.dxf.entities", { count: r.entities.length }),
        scale: r.unitName
          ? msg("ui.underlay.dxf.unit", { unit: r.unitName })
          : msg("ui.underlay.dxf.scale", { scale: String(r.unitScale) }),
      });
      if (skipped !== null) {
        summary = msg("ui.underlay.dxf.detail", {
          text: summary,
          detail: msg("ui.underlay.dxf.skipped", { list: skipped }),
        });
      }
      if (r.truncated) {
        summary = msg("ui.underlay.dxf.detail", {
          text: summary,
          detail: msg("ui.underlay.dxf.truncated"),
        });
      }
      setNotice(
        error
          ? { kind: "error", text: error }
          : { kind: "info", text: msg("ui.underlay.dxf.sentence", { text: summary }) },
      );
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const importDxfFile = async (file: File): Promise<void> => {
    try {
      await loadDxf(file.name, await readFile(file, "text"));
    } catch (err) {
      setNotice({
        kind: "error",
        text: msg("ui.underlay.readFailed", {
          name: file.name,
          error: isMessageError(err) ? err.msg : String(err),
        }),
      });
    }
  };

  const onDxf = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await importDxfFile(file);
  };

  const onImage = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await importImageFile(file);
  };

  // Fichier choisi par le menu « Importer » de la barre d'outils.
  const queued = useStore(importQueue, (s) => s.pending);
  useEffect(() => {
    if (!queued) return;
    takeUnderlayImport(queued);
    void (queued.kind === "dxf" ? importDxfFile(queued.file) : importImageFile(queued.file));
    // Une seule prise en charge par demande (numéro `seq`) : dépend de la seule demande.
  }, [queued]);

  async function importImageFile(file: File): Promise<void> {
    setBusy(true);
    try {
      const { dataUrl, w, h, reduced } = await prepareImage(file);
      const { mmPerPx, placement } = defaultImagePlacement(w, h, stairBounds);
      const image: ImageUnderlay = {
        name: file.name.slice(0, 200),
        dataUrl,
        widthPx: w,
        heightPx: h,
        mmPerPx,
        placement,
      };
      const error = commit((p) => withImageUnderlay(p, image));
      setNotice(
        error
          ? { kind: "error", text: error }
          : {
              kind: "info",
              text: reduced
                ? msg("ui.underlay.image.importedReduced", { name: file.name })
                : msg("ui.underlay.image.imported", { name: file.name }),
            },
      );
    } catch (err) {
      setNotice({
        kind: "error",
        text: msg("ui.underlay.image.failed", { name: file.name, error: errorMessage(err) }),
      });
    } finally {
      setBusy(false);
    }
  }

  const setPlacement = (field: "x" | "y" | "rotation", text: string): void => {
    const dxf = underlay?.dxf;
    const v = Number(text.replace(",", "."));
    if (!dxf || !Number.isFinite(v)) return;
    const placement =
      field === "rotation"
        ? { ...dxf.placement, rotation: v }
        : { ...dxf.placement, origin: { ...dxf.placement.origin, [field]: v } };
    const error = commit((p) => withDxfUnderlay(p, { ...dxf, placement }));
    if (error) setNotice({ kind: "error", text: error });
  };

  const opacity = underlay?.opacity ?? 1;

  return (
    <details className="plan-site__group" open>
      <summary>{t.t("ui.underlay.title")}</summary>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => dxfInput.current?.click()}>
          {t.t("ui.underlay.importDxf")}
        </button>
        <button type="button" disabled={busy} onClick={() => imageInput.current?.click()}>
          {t.t("ui.underlay.importImage")}
        </button>
        <input
          ref={dxfInput}
          type="file"
          accept=".dxf,application/dxf,image/vnd.dxf"
          hidden
          aria-label={t.t("ui.underlay.dxfFile")}
          onChange={(e) => void onDxf(e)}
        />
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          aria-label={t.t("ui.underlay.imageFile")}
          onChange={(e) => void onImage(e)}
        />
      </div>
      {pending ? (
        <div className="plan-site__scale">
          <div className="field">
            <label htmlFor={`${id}-scale`}>{t.t("ui.underlay.scale.label")}</label>
            <select
              id={`${id}-scale-choice`}
              aria-label={t.t("ui.underlay.scale.unit")}
              value={UNIT_CHOICES.some((u) => String(u.mm) === scale) ? scale : ""}
              onChange={(e) => e.target.value && setScale(e.target.value)}
            >
              <option value="">{t.t("ui.underlay.scale.other")}</option>
              {UNIT_CHOICES.map((u) => (
                <option key={u.mm} value={String(u.mm)}>
                  {t.t(u.key)}
                </option>
              ))}
            </select>
            <input
              id={`${id}-scale`}
              type="text"
              inputMode="decimal"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
            />
          </div>
          <div className="button-row">
            <button
              type="button"
              disabled={busy || !(Number(scale.replace(",", ".")) > 0)}
              onClick={() =>
                void loadDxf(pending.name, pending.text, Number(scale.replace(",", ".")))
              }
            >
              {t.t("ui.underlay.scale.import")}
            </button>
            <button type="button" onClick={() => setPending(null)}>
              {t.t("ui.underlay.scale.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p
          className={`notice ${notice.kind === "error" ? "notice--error" : "notice--info"}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {t.t(notice.text)}
        </p>
      ) : null}
      {underlay?.dxf ? (
        <fieldset className="grid-2">
          <legend>
            {t.t("ui.underlay.dxf.legend", {
              name: underlay.dxf.name || t.t("ui.underlay.unnamed"),
              count: underlay.dxf.entities.length,
            })}
          </legend>
          <PlacementInput
            label={t.t("ui.underlay.originX")}
            value={underlay.dxf.placement.origin.x}
            onCommit={(v) => setPlacement("x", v)}
          />
          <PlacementInput
            label={t.t("ui.underlay.originY")}
            value={underlay.dxf.placement.origin.y}
            onCommit={(v) => setPlacement("y", v)}
          />
          <PlacementInput
            label={t.t("ui.underlay.rotation")}
            value={underlay.dxf.placement.rotation}
            onCommit={(v) => setPlacement("rotation", v)}
          />
          <div className="button-row">
            <button type="button" onClick={() => commit((p) => withDxfUnderlay(p, undefined))}>
              {t.t("ui.underlay.removeDxf")}
            </button>
          </div>
        </fieldset>
      ) : null}
      {underlay?.image ? (
        <fieldset>
          <legend>
            {t.t("ui.underlay.image.legend", {
              name: underlay.image.name || t.t("ui.underlay.unnamed"),
            })}
          </legend>
          <p className="muted">
            {underlay.image.calibration
              ? t.t("ui.underlay.image.calibrated", {
                  value: formatNumber(t.locale, underlay.image.mmPerPx, {
                    maximumFractionDigits: 3,
                  }),
                })
              : t.t("ui.underlay.image.notCalibrated")}
          </p>
          <div className="button-row">
            <button type="button" onClick={() => commit((p) => withImageUnderlay(p, undefined))}>
              {t.t("ui.underlay.removeImage")}
            </button>
          </div>
        </fieldset>
      ) : null}
      {underlay ? (
        <div className="field">
          <label htmlFor={`${id}-opacity`}>{t.t("ui.underlay.opacity")}</label>
          <select
            id={`${id}-opacity`}
            value={String(Math.round(opacity * 100))}
            onChange={(e) => commit((p) => withUnderlayOpacity(p, Number(e.target.value) / 100))}
          >
            {[25, 50, 75, 100].map((v) => (
              <option key={v} value={String(v)}>
                {t.t("ui.underlay.percent", { value: String(v) })}
              </option>
            ))}
            {[25, 50, 75, 100].includes(Math.round(opacity * 100)) ? null : (
              <option value={String(Math.round(opacity * 100))}>
                {t.t("ui.underlay.percent", { value: String(Math.round(opacity * 100)) })}
              </option>
            )}
          </select>
        </div>
      ) : null}
    </details>
  );
}

/** Champ numérique appliqué à la validation (Entrée ou perte de focus). */
function PlacementInput({
  label,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (text: string) => void;
}) {
  const id = useId();
  const shown = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState<string | null>(null);
  const done = (): void => {
    if (draft !== null && draft !== shown) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          else if (e.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}
