import { expect, test } from "@playwright/test";

/**
 * The home page header slider is always visible (banners from the admin
 * panel, or the built-in brand slides while none is live), works in both
 * directions and on phones and desktops, and can be paused.
 */
for (const locale of ["fa", "en"] as const) {
  test(`the home slider shows and moves (${locale})`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}`);
    const slider = page.getByTestId("home-slider");
    await expect(slider).toBeVisible();
    const box = await slider.boundingBox();
    expect(box!.height).toBeGreaterThan(200);
    const slides = slider.getByTestId("home-slide");
    const count = await slides.count();
    expect(count).toBeGreaterThan(0);
    await expect(slides.first()).toBeInViewport({ ratio: 0.9 });
    if (count < 2) return;

    const current = slider.locator('[data-testid="home-slider-dot"][aria-current="true"]');
    await expect(slider.getByTestId("home-slider-dot")).toHaveCount(count);
    await expect(current).toHaveAttribute("aria-label", /1/);

    if (testInfo.project.name === "desktop") {
      await slider.getByTestId("home-slider-next").click();
      await expect(slides.nth(1)).toBeInViewport({ ratio: 0.9 });
      // Wraps around: back from the first slide shows the last.
      await slider.getByTestId("home-slider-previous").click();
      await expect(slides.first()).toBeInViewport({ ratio: 0.9 });
      await slider.getByTestId("home-slider-previous").click();
      await expect(slides.nth(count - 1)).toBeInViewport({ ratio: 0.9 });
    } else {
      // Phones: arrows are hidden; dots move the slider (swiping is native scrolling).
      await expect(slider.getByTestId("home-slider-next")).toBeHidden();
      await slider.getByTestId("home-slider-dot").nth(1).click();
      await expect(slides.nth(1)).toBeInViewport({ ratio: 0.9 });
    }

    const pause = slider.getByTestId("home-slider-pause");
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "false");
  });
}
