// types/index.ts

export interface RentRollRow {
  asset: string;
  tenant: string;
  am: string;
  city: string;
  present: "am" | "pm" | "both";
  gla_am: number;
  gla_pm: number;
  rent_am: number;
  rent_pm: number;
  walt_am: number;
  walt_pm: number;
}