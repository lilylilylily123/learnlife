/** Returns a Tailwind CSS class string for the given program code. */
export const programColor = (program: string): string =>
  program === "exp"
    ? "bg-rose-100 text-rose-800"
    : program === "cre"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-sky-100 text-sky-800";

/** Returns a short display label for the given program code. */
export const programLabel = (program: string | undefined): string =>
  program === "exp" ? "EXP" : program === "cre" ? "CRE" : "CHMK";
