import { describe, expect, it } from "vitest";
import { DEFAULT_KAVENEGAR_WEBPUSH_APP_ID, kavenegarLoaderScript, kavenegarPageScriptUrl, kavenegarWebPushAppId } from "../kavenegar";

describe("Kavenegar web push", () => {
  it("uses the owner's app id when unset, turns off when empty or 'off'", () => {
    expect(kavenegarWebPushAppId(undefined)).toBe(DEFAULT_KAVENEGAR_WEBPUSH_APP_ID);
    expect(kavenegarWebPushAppId("")).toBeNull();
    expect(kavenegarWebPushAppId(" off ")).toBeNull();
    expect(kavenegarWebPushAppId("0669309A-4534-40FF-AE23-E73F63CDB0E9")).toBe("0669309a-4534-40ff-ae23-e73f63cdb0e9");
  });

  it("refuses anything that is not a UUID, so nothing else reaches the script URL", () => {
    for (const bad of ["x", `${DEFAULT_KAVENEGAR_WEBPUSH_APP_ID}&x=1`, '"};alert(1)//', `${DEFAULT_KAVENEGAR_WEBPUSH_APP_ID}</script>`]) expect(kavenegarWebPushAppId(bad)).toBeNull();
  });

  it("builds the SDK URL on Kavenegar's CDN", () => {
    expect(kavenegarPageScriptUrl(DEFAULT_KAVENEGAR_WEBPUSH_APP_ID)).toBe(`https://cdn.kavenegar.com/sdk/page.js?appId=${DEFAULT_KAVENEGAR_WEBPUSH_APP_ID}`);
  });

  it("loads the deferred tag into <head> only after the load event, once", () => {
    const js = kavenegarLoaderScript(DEFAULT_KAVENEGAR_WEBPUSH_APP_ID);
    expect(js).toContain('addEventListener("load"');
    expect(js).toContain("s.defer=true");
    expect(js).toContain('s.charset="utf-8"');
    expect(js).toContain("document.head.appendChild(s)");
    expect(js).toContain('getElementById("kvn-web-push")');
    expect(js).not.toContain("</");
  });
});
