# Page document schema (v1)

```ts
const LocalizedText = z.object({ fa: z.string().max(500), en: z.string().max(500).optional() })
const SafeHref = z.string().max(500).refine(isRelativeOrAllowListedHttps, 'unsafe_url')
const ImageRef = z.object({ mediaId: z.string().uuid(), alt: LocalizedText })
const Visibility = z.object({
  breakpoints: z.array(z.enum(['mobile', 'tablet', 'desktop'])).min(1),
  locales: z.array(z.enum(['fa', 'en'])).min(1),
})

const Section = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('hero'), visibility: Visibility,
    props: z.object({ title: LocalizedText, subtitle: LocalizedText.optional(), image: ImageRef,
      cta: z.object({ label: LocalizedText, href: SafeHref }).optional(),
      tone: z.enum(['light', 'dark', 'brand']) }) }),
  z.object({ id: z.string(), type: z.literal('bannerCarousel'), visibility: Visibility,
    props: z.object({ bannerIds: z.array(z.string().uuid()).max(10) }) }),
  z.object({ id: z.string(), type: z.literal('categoryGrid'), visibility: Visibility,
    props: z.object({ title: LocalizedText, categoryIds: z.array(z.string().uuid()).max(24) }) }),
  z.object({ id: z.string(), type: z.literal('productRail'), visibility: Visibility,
    props: z.object({ title: LocalizedText,
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('manual'), productIds: z.array(z.string().uuid()).max(24) }),
        z.object({ kind: z.literal('category'), categoryId: z.string().uuid(), sort: z.enum(['newest', 'bestselling', 'price_asc']) }),
      ]), limit: z.number().int().min(4).max(24) }) }),
  z.object({ id: z.string(), type: z.literal('richText'), visibility: Visibility,
    props: z.object({ content: z.object({ fa: RichTextDoc, en: RichTextDoc.optional() }) }) }),
  z.object({ id: z.string(), type: z.literal('vehicleSelector'), visibility: Visibility,
    props: z.object({ title: LocalizedText }) }),
])

export const PageDocument = z.object({ version: z.literal(1), sections: z.array(Section).max(40) })
```

Header/footer documents use the same mechanism with their own section unions (`menu`, `contactBlock`, `trustBadges`, `socialLinks`).
Schema changes bump `version` and ship a migration function `migrate(doc_v1) → doc_v2` with tests.
