// A need that names a gender hides what is clearly made for the other one; titles that name none stay (unknown, not wrong).
// Same rule as backend/app/services/text.py (fits_need).
import { normalize } from "./text";

const FEMALE = /دختر|زنانه|بانوان|مانتو|سرافون|مقنعه|روسری|شومیز|دامن|ساپورت/;
const MALE = /پسر|مردانه|آقایان/;
const genderOf = (need: string | null) => { const n = normalize(need ?? ""); return MALE.test(n) ? "m" : FEMALE.test(n) ? "f" : null; };

export function fitsNeed(title: string, need: string | null): boolean {
  const g = genderOf(need), t = normalize(title);
  return g === "m" ? !FEMALE.test(t) : g === "f" ? !MALE.test(t) : true;
}
