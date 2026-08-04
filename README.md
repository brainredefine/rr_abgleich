Rent roll AM (Tabula) vs PM (3PM) comparison.

## Updating the data

Drop the raw export in `public/data/SourceRR.xlsx` — no manual pre-processing.
The file must contain these sheets:

| Sheet     | Columns                                             |
| --------- | --------------------------------------------------- |
| `3PM`     | Asset ID, Name, Key, GLA, WALT, RENT                |
| `Tabula`  | Asset ID, Name, Key, GLA, WALT, RENT, City          |
| `Mapping` | Unit ID (Tabula), Tenant ID (3PM)                   |
| `AM`      | *optional* — Asset ID, AM (asset-manager initials)  |

How it is turned into rows (`lib/source.ts`):

- 3PM is aggregated per **(Asset ID, Key)** — GLA and RENT summed, WALT taken from
  the line with the largest GLA. The Key alone is not unique, the same id shows up
  under two Asset IDs when a property exists twice.
- A Tabula unit is matched to a 3PM tenancy **only through the Mapping sheet**
  (empty `Tenant ID (3PM)` = no counterpart). No fuzzy name matching.
- The match is **n:n**. Repeat a unit on several Mapping rows when 3PM splits it over
  several leases (`AA128 - 1` → `754.10001.01` *and* `754.40001.01`); point several
  units at the same lease when 3PM merges them (`AA56 - 1` / `AA56 - 2`). Units and
  leases linked this way form one row, each side summed once.
- Tabula unit without a 3PM tenancy → `missing PM`; 3PM tenancy without a Tabula
  unit → `missing AM`.
- **Ampova / Amperio / Climova** are folded into a single `Ampova (Amperio/Climova)`
  row per asset — 3PM labels them a dozen different ways and sometimes merges both
  entities into one tenancy. See `AMPOVA_RE` / `AMPOVA_LABEL` in `lib/source.ts`.
- Asset-manager initials come from `lib/assetManagers.json`; add an `AM` sheet to
  the workbook to override or fill in new assets.
- Vacancies (`AVAILABLE`, `Leerstand …`) are produced but hidden in the UI —
  see `isHidden` in `app/page.tsx`.

Comments live in Supabase and are keyed on `ASSET@@normalized tenant`, so they
survive a data refresh.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
