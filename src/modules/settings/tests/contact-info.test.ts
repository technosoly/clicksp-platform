import { describe, expect, it } from "vitest";
import { EMPTY_CONTACT, embedSrc, hasContactDetails, isGoogleEmbed, isMapLink, normalizePhone, parseContactInput, readContactInfo, type ContactInput } from "../domain/contact-info";

const blank: ContactInput = { addressFa: "", addressEn: "", hoursFa: "", hoursEn: "", phones: ["", "", ""], email: "", google: "", neshan: "", balad: "", googleEmbed: "" };

describe("contact details", () => {
  it("accepts an empty form: nothing is set", () => {
    expect(parseContactInput(blank)).toEqual({ value: EMPTY_CONTACT });
    expect(hasContactDetails(EMPTY_CONTACT)).toBe(false);
  });

  it("normalizes phone numbers to digits and drops duplicates", () => {
    expect(normalizePhone("۰۲۱-۱۲۳۴ ۵۶۷۸")).toBe("02112345678");
    expect(normalizePhone(" +98 912 000 0000 ")).toBe("+989120000000");
    const parsed = parseContactInput({ ...blank, addressFa: "TEST نشانی", phones: ["021 1234 5678", "02112345678", ""] });
    expect(parsed).toMatchObject({ value: { phones: ["02112345678"] } });
    expect("value" in parsed && hasContactDetails(parsed.value)).toBe(true);
  });

  it("refuses bad phone numbers and email addresses", () => {
    expect(parseContactInput({ ...blank, phones: ["12", "", ""] })).toEqual({ field: "phone_invalid" });
    expect(parseContactInput({ ...blank, phones: ["021 call me", "", ""] })).toEqual({ field: "phone_invalid" });
    expect(parseContactInput({ ...blank, email: "not-an-email" })).toEqual({ field: "email_invalid" });
    expect(parseContactInput({ ...blank, phones: ["0211", "0212", "0213", "0214"] })).toEqual({ field: "phones_too_many" });
  });

  it("needs the Persian address before an English one, and strips control and bidi-override characters", () => {
    expect(parseContactInput({ ...blank, addressEn: "Tehran" })).toEqual({ field: "address_fa_required" });
    expect(parseContactInput({ ...blank, addressFa: "TEST‮ نشاني\u0007" })).toMatchObject({ value: { address: { fa: "TEST نشانی" } } });
  });

  it("accepts map links only from each provider's own https hosts", () => {
    expect(isMapLink("google", "https://maps.app.goo.gl/abc")).toBe(true);
    expect(isMapLink("google", "https://www.google.com/maps/place/x")).toBe(true);
    expect(isMapLink("google", "https://www.google.com/maps")).toBe(true);
    expect(isMapLink("google", "http://maps.app.goo.gl/abc")).toBe(false);
    expect(isMapLink("google", "https://www.google.com/url?q=https://evil.test")).toBe(false);
    expect(isMapLink("google", "https://www.google.com/mapsx")).toBe(false);
    expect(isMapLink("google", "https://goo.gl/abc")).toBe(false);
    expect(isMapLink("google", "https://maps.app.goo.gl.evil.test/abc")).toBe(false);
    expect(isMapLink("google", "javascript:alert(1)")).toBe(false);
    expect(isMapLink("google", "https://user@maps.app.goo.gl/abc")).toBe(false);
    expect(isMapLink("neshan", "https://nshn.ir/abc")).toBe(true);
    expect(isMapLink("neshan", "https://balad.ir/p/abc")).toBe(false);
    expect(isMapLink("balad", "https://balad.ir/p/abc")).toBe(true);
    expect(parseContactInput({ ...blank, neshan: "https://evil.test/x" })).toEqual({ field: "map_neshan_invalid" });
  });

  it("takes the src of a pasted Google embed snippet, and only Google's embed endpoint", () => {
    const src = "https://www.google.com/maps/embed?pb=!1m18!1m12";
    expect(embedSrc(`<iframe src="${src}&amp;x=1" width="600" style="border:0;" allowfullscreen=""></iframe>`)).toBe(`${src}&x=1`);
    expect(isGoogleEmbed(src)).toBe(true);
    expect(isGoogleEmbed("https://www.google.com/maps/place/x")).toBe(false);
    expect(isGoogleEmbed("https://evil.test/maps/embed?pb=1")).toBe(false);
    expect(parseContactInput({ ...blank, googleEmbed: `<iframe src="${src}"></iframe>` })).toMatchObject({ value: { maps: { googleEmbed: src } } });
    expect(parseContactInput({ ...blank, googleEmbed: '<iframe src="https://evil.test/x"></iframe>' })).toEqual({ field: "map_googleEmbed_invalid" });
  });

  it("reads a stored value that no longer matches the schema as not set", () => {
    expect(readContactInfo({ phones: "x" })).toEqual(EMPTY_CONTACT);
    expect(readContactInfo(undefined)).toEqual(EMPTY_CONTACT);
  });
});
