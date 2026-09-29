/**
 * Barème de coût de l'atelier (jalon 3c, CHALLENGE P2, C §5.3 et §5.4).
 *
 * C §5.4 (point 6) : le temps d'atelier est « l'entrée la plus incertaine » ; Blondel l'expose
 * comme **paramètres calibrables par l'atelier** (minutes par coupe, par pli, par mètre de
 * cordon, par gabarit), **sans valeur par défaut non sourcée**. Les fourchettes de C §5.1
 * (taux horaire 45 à 70 € HT, acier 1,20 à 1,80 €/kg…) sont des ordres de grandeur de marché,
 * pas des coûts de revient : elles ne sont **pas** reprises comme défauts. Sans barème complet,
 * le comparateur de variantes n'affiche pas d'euros (`null`).
 */
import { z } from "zod";

const nonNeg = z.number().nonnegative();

/** Barème (tous les champs facultatifs, aucun défaut). */
export const CostRatesSchema = z.object({
  /** Taux horaire atelier, € HT / h. */
  hourlyRate: nonNeg.optional(),
  /** Temps par coupe (sciage, découpe d'un contour), min. */
  minutesPerCut: nonNeg.optional(),
  /** Temps par mètre de cordon de soudure, min / m. */
  minutesPerWeldMeter: nonNeg.optional(),
  /** Temps par pli, min. */
  minutesPerBend: nonNeg.optional(),
  /** Temps par perçage, min. */
  minutesPerHole: nonNeg.optional(),
  /** Temps par pièce unique (gabarit, programme, référence distincte), min. */
  minutesPerUniquePart: nonNeg.optional(),
  /** Prix de l'acier, € HT / kg. */
  steelPricePerKg: nonNeg.optional(),
  /** Prix du bois brut (volume de débit), € HT / m³. */
  woodPricePerM3: nonNeg.optional(),
  /** Finition (thermolaquage, vernis…), € HT / m² de surface traitée. */
  finishPricePerM2: nonNeg.optional(),
});
export type CostRates = z.output<typeof CostRatesSchema>;

/** Champs de temps indispensables à un chiffrage (en plus du taux horaire). */
export const COST_TIME_FIELDS = [
  "minutesPerCut",
  "minutesPerWeldMeter",
  "minutesPerBend",
  "minutesPerHole",
  "minutesPerUniquePart",
] as const satisfies readonly (keyof CostRates)[];
